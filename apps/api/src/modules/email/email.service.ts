import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository, type SelectQueryBuilder } from 'typeorm';
import {
  PERMISSIONS,
  type ConnectImapAccountPayload,
  type EmailAccountDto,
  type EmailFolder,
  type EmailMessageDto,
  type EmailThreadDetailDto,
  type EmailThreadDto,
  type EmailThreadQuery,
  type PaginatedResult,
  type SendEmailPayload,
} from '@saas/shared';
import type { AuthenticatedUser } from '@/common/types/authenticated-user';
import { TenantContextService } from '@/common/context/tenant-context.service';
import {
  EmailAccount,
  EmailProviderType,
  EmailSyncStatus,
} from './entities/email-account.entity';
import { EmailAttachment } from './entities/email-attachment.entity';
import {
  EmailDirection,
  EmailMessage,
  EmailMessageStatus,
} from './entities/email-message.entity';
import {
  EmailThread,
  EmailFolder as EmailFolderEntity,
} from './entities/email-thread.entity';
import { EmailIngestService } from './email-ingest.service';
import { EmailSyncService } from './email-sync.service';
import { GmailClientService } from './gmail/gmail-client.service';
import { GoogleOAuthService } from './gmail/google-oauth.service';
import { ImapAuthError, ImapClientService } from './imap/imap-client.service';
import { subjectThreadKey } from './imap/imap-mime';
import { composeRfc822, toBase64Url } from './gmail/mime';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  constructor(
    @InjectRepository(EmailAccount)
    private readonly accounts: Repository<EmailAccount>,
    @InjectRepository(EmailThread)
    private readonly threads: Repository<EmailThread>,
    @InjectRepository(EmailMessage)
    private readonly messages: Repository<EmailMessage>,
    @InjectRepository(EmailAttachment)
    private readonly attachments: Repository<EmailAttachment>,
    private readonly oauth: GoogleOAuthService,
    private readonly gmail: GmailClientService,
    private readonly imap: ImapClientService,
    private readonly ingest: EmailIngestService,
    private readonly sync: EmailSyncService,
    private readonly tenantContext: TenantContextService,
  ) {}

  /* -------------------------------------------------------------- accounts */

  private canSeeAll(actor: AuthenticatedUser): boolean {
    return (
      actor.isOwner ||
      actor.permissions.includes(PERMISSIONS.EMAIL_READ_ALL) ||
      actor.permissions.includes(PERMISSIONS.EMAIL_MANAGE)
    );
  }

  private canManage(actor: AuthenticatedUser): boolean {
    return (
      actor.isOwner || actor.permissions.includes(PERMISSIONS.EMAIL_MANAGE)
    );
  }

  /** Query every account the actor may read: their own plus shared ones. */
  private visibleAccounts(
    actor: AuthenticatedUser,
  ): SelectQueryBuilder<EmailAccount> {
    const qb = this.accounts
      .createQueryBuilder('account')
      .where('account.tenantId = :tenantId', {
        tenantId: actor.organizationId,
      });
    if (!this.canSeeAll(actor)) {
      qb.andWhere('(account.userId = :uid OR account.isShared = true)', {
        uid: actor.id,
      });
    }
    return qb;
  }

  private async visibleAccount(
    actor: AuthenticatedUser,
    accountId: string,
  ): Promise<EmailAccount> {
    const account = await this.visibleAccounts(actor)
      .andWhere('account.id = :id', { id: accountId })
      .getOne();
    if (!account) throw new NotFoundException('Email account not found');
    return account;
  }

  async listAccounts(actor: AuthenticatedUser): Promise<EmailAccountDto[]> {
    const rows = await this.visibleAccounts(actor)
      .orderBy('account.createdAt', 'ASC')
      .getMany();
    return rows.map((a) => this.accountDto(actor, a));
  }

  private accountDto(
    actor: AuthenticatedUser,
    a: EmailAccount,
  ): EmailAccountDto {
    return {
      id: a.id,
      emailAddress: a.emailAddress,
      name: a.name,
      providerType: a.providerType,
      isShared: a.isShared,
      isMine: a.userId === actor.id,
      syncStatus: a.syncStatus,
      syncError: a.syncError,
      lastSyncedAt: a.lastSyncedAt?.toISOString() ?? null,
      createdAt: a.createdAt.toISOString(),
    };
  }

  googleAuthUrl(actor: AuthenticatedUser): { url: string } {
    return { url: this.oauth.buildAuthUrl(actor) };
  }

  /**
   * Completes the OAuth round trip: verify state → swap code → store the
   * mailbox → kick off its first sync in the background so the browser can
   * be redirected home immediately.
   */
  async completeGoogleConnect(
    state: string,
    code: string,
  ): Promise<{ emailAddress: string }> {
    const { userId, organizationId } = this.oauth.verifyState(state);
    const tokens = await this.oauth.exchangeCode(code);
    const identity = await this.oauth.fetchIdentity(tokens.accessToken);
    if (!identity.emailAddress) {
      throw new Error('Google did not return an email address');
    }

    return this.tenantContext.runWithTenant(organizationId, async () => {
      let account = await this.accounts.findOne({
        where: {
          tenantId: organizationId,
          userId,
          emailAddress: identity.emailAddress.toLowerCase(),
        },
      });
      if (!account) {
        account = this.accounts.create({
          tenantId: organizationId,
          userId,
          emailAddress: identity.emailAddress.toLowerCase(),
        });
      }
      account.name = identity.name;
      account.providerType = EmailProviderType.GMAIL_OAUTH;
      account.syncCursor = null; // force a fresh initial sync
      account.syncStatus = EmailSyncStatus.ACTIVE;
      account.syncError = null;
      account.encryptedCredentials = this.gmail.persistTokens(account, tokens);
      const saved = await this.accounts.save(account);

      // Best-effort — a failed first sync is retried by the cron anyway.
      void this.sync
        .syncAccount(saved)
        .catch((err) =>
          this.logger.warn(
            `Initial sync for ${saved.emailAddress} failed: ${String(err)}`,
          ),
        );
      return { emailAddress: saved.emailAddress };
    });
  }

  /**
   * App-password connect — the path for customers on their own Workspace
   * domain (or plain Gmail) where our OAuth client cannot consent. The
   * password is verified against Gmail before anything is stored, then kept
   * encrypted exactly like the OAuth tokens.
   */
  async connectImap(
    actor: AuthenticatedUser,
    payload: ConnectImapAccountPayload,
  ): Promise<EmailAccountDto> {
    const emailAddress = payload.emailAddress.toLowerCase();
    // Google renders app passwords as four space-separated groups.
    const appPassword = payload.appPassword.replace(/\s+/g, '');
    try {
      await this.imap.verifyCredentials(emailAddress, appPassword);
    } catch (err) {
      if (err instanceof ImapAuthError) {
        throw new BadRequestException(err.message);
      }
      throw new BadRequestException(
        'Could not reach Gmail to verify the password — try again',
      );
    }

    let account = await this.accounts.findOne({
      where: {
        tenantId: actor.organizationId,
        userId: actor.id,
        emailAddress,
      },
    });
    if (!account) {
      account = this.accounts.create({
        tenantId: actor.organizationId,
        userId: actor.id,
        emailAddress,
      });
    }
    account.providerType = EmailProviderType.IMAP_SMTP;
    account.name = '';
    account.isShared = payload.isShared;
    account.syncCursor = null;
    account.syncStatus = EmailSyncStatus.ACTIVE;
    account.syncError = null;
    account.encryptedCredentials = this.imap.writeCredentials({
      username: emailAddress,
      appPassword,
    });
    const saved = await this.accounts.save(account);

    void this.sync
      .syncAccount(saved)
      .catch((err) =>
        this.logger.warn(
          `Initial sync for ${saved.emailAddress} failed: ${String(err)}`,
        ),
      );
    return this.accountDto(actor, saved);
  }

  async disconnect(actor: AuthenticatedUser, accountId: string): Promise<void> {
    const account = await this.visibleAccount(actor, accountId);
    if (account.userId !== actor.id && !this.canManage(actor)) {
      throw new ForbiddenException(
        'Only the owner or an admin can disconnect this account',
      );
    }
    await this.accounts.remove(account);
  }

  async setShared(
    actor: AuthenticatedUser,
    accountId: string,
    isShared: boolean,
  ): Promise<EmailAccountDto> {
    const account = await this.accounts.findOne({
      where: { id: accountId, tenantId: actor.organizationId },
    });
    if (!account) throw new NotFoundException('Email account not found');
    if (account.userId !== actor.id && !this.canManage(actor)) {
      throw new ForbiddenException(
        'Only the owner or an admin can share this account',
      );
    }
    account.isShared = isShared;
    return this.accountDto(actor, await this.accounts.save(account));
  }

  async syncNow(
    actor: AuthenticatedUser,
    accountId: string,
  ): Promise<{ ok: boolean }> {
    const account = await this.visibleAccount(actor, accountId);
    await this.sync.syncAccount(account);
    return { ok: true };
  }

  /* --------------------------------------------------------------- threads */

  async listThreads(
    actor: AuthenticatedUser,
    query: EmailThreadQuery,
  ): Promise<PaginatedResult<EmailThreadDto>> {
    const accountIds = (
      await this.visibleAccounts(actor).select('account.id').getMany()
    ).map((a) => a.id);
    if (accountIds.length === 0) {
      return {
        items: [],
        meta: {
          total: 0,
          page: query.page,
          limit: query.limit,
          totalPages: 1,
          hasNextPage: false,
          hasPreviousPage: false,
        },
      };
    }

    const qb = this.threads
      .createQueryBuilder('thread')
      .leftJoinAndMapOne(
        'thread.emailAccount',
        EmailAccount,
        'account',
        'account.id = thread.emailAccountId',
      )
      .where('thread.tenantId = :tenantId', { tenantId: actor.organizationId })
      .andWhere('thread.emailAccountId IN (:...accountIds)', { accountIds });

    if (query.accountId) {
      if (!accountIds.includes(query.accountId)) {
        throw new NotFoundException('Email account not found');
      }
      qb.andWhere('thread.emailAccountId = :accountId', {
        accountId: query.accountId,
      });
    }
    if (query.folder) {
      qb.andWhere('thread.folder = :folder', { folder: query.folder });
    }
    if (query.contactId) {
      qb.andWhere('thread.contactId = :contactId', {
        contactId: query.contactId,
      });
    }
    if (query.search) {
      const term = `%${query.search.toLowerCase()}%`;
      qb.andWhere(
        '(LOWER(thread.subject) LIKE :term OR LOWER(thread.snippet) LIKE :term)',
        { term },
      );
    }

    const [items, total] = await qb
      .orderBy('thread.lastMessageAt', 'DESC')
      .skip((query.page - 1) * query.limit)
      .take(query.limit)
      .getManyAndCount();

    return {
      items: items.map((t) => this.threadDto(t)),
      meta: {
        total,
        page: query.page,
        limit: query.limit,
        totalPages: Math.max(1, Math.ceil(total / query.limit)),
        hasNextPage: query.page * query.limit < total,
        hasPreviousPage: query.page > 1,
      },
    };
  }

  private threadDto(t: EmailThread): EmailThreadDto {
    return {
      id: t.id,
      emailAccountId: t.emailAccountId,
      accountEmail: t.emailAccount?.emailAddress ?? '',
      contactId: t.contactId,
      subject: t.subject,
      snippet: t.snippet,
      folder: t.folder,
      isRead: t.isRead,
      isStarred: t.isStarred,
      participants: t.participants,
      lastMessageAt: t.lastMessageAt.toISOString(),
      messageCount: t.messageCount,
    };
  }

  private async scopedThread(
    actor: AuthenticatedUser,
    threadId: string,
  ): Promise<EmailThread> {
    const thread = await this.threads.findOne({
      where: { id: threadId, tenantId: actor.organizationId },
      relations: { emailAccount: true },
    });
    if (!thread) throw new NotFoundException('Thread not found');
    await this.visibleAccount(actor, thread.emailAccountId); // throws 404
    return thread;
  }

  async getThread(
    actor: AuthenticatedUser,
    threadId: string,
  ): Promise<EmailThreadDetailDto> {
    const thread = await this.scopedThread(actor, threadId);
    const messages = await this.messages.find({
      where: { threadId },
      order: { sentAt: 'ASC' },
    });
    const attachments = messages.length
      ? await this.attachments.find({
          where: { emailMessageId: In(messages.map((m) => m.id)) },
        })
      : [];
    return {
      ...this.threadDto(thread),
      messages: messages.map((m) => this.messageDto(m, attachments)),
    };
  }

  private messageDto(
    m: EmailMessage,
    attachments: EmailAttachment[] = [],
  ): EmailMessageDto {
    return {
      id: m.id,
      threadId: m.threadId,
      direction: m.direction,
      fromEmail: m.fromEmail,
      fromName: m.fromName,
      toEmails: m.toEmails,
      ccEmails: m.ccEmails,
      bccEmails: m.bccEmails,
      subject: m.subject,
      bodyText: m.bodyText,
      bodyHtml: m.bodyHtml,
      hasAttachments: m.hasAttachments,
      attachments: attachments
        .filter((a) => a.emailMessageId === m.id)
        .map((a) => ({
          id: a.id,
          filename: a.filename,
          mimeType: a.mimeType,
          sizeBytes: a.sizeBytes,
        })),
      sentAt: m.sentAt.toISOString(),
    };
  }

  /* ------------------------------------------------------------ mutations */

  async updateThread(
    actor: AuthenticatedUser,
    threadId: string,
    patch: { isRead?: boolean; isStarred?: boolean; folder?: EmailFolder },
  ): Promise<EmailThreadDto> {
    const thread = await this.scopedThread(actor, threadId);
    const updates: Partial<EmailThread> = {};
    if (patch.isRead !== undefined) updates.isRead = patch.isRead;
    if (patch.isStarred !== undefined) updates.isStarred = patch.isStarred;
    if (patch.folder !== undefined)
      updates.folder = patch.folder as EmailFolderEntity;
    await this.threads.update(thread.id, updates);

    // Best-effort push upstream — the next sync reconciles regardless.
    void this.pushPatchToProvider(thread, patch).catch((err) =>
      this.logger.debug(
        `Provider push failed for thread ${thread.id}: ${String(err)}`,
      ),
    );

    const fresh = await this.threads.findOneOrFail({
      where: { id: thread.id },
      relations: { emailAccount: true },
    });
    return this.threadDto(fresh);
  }

  private async pushPatchToProvider(
    thread: EmailThread,
    patch: { isRead?: boolean; isStarred?: boolean; folder?: EmailFolder },
  ): Promise<void> {
    const account = await this.accounts.findOneByOrFail({
      id: thread.emailAccountId,
    });
    const messages = await this.messages.find({
      where: { threadId: thread.id },
    });

    if (account.providerType === EmailProviderType.IMAP_SMTP) {
      for (const message of messages) {
        await this.imap.applyPatch(account, message.providerMessageId, {
          isRead: patch.isRead,
          isStarred: patch.isStarred,
          folder: patch.folder,
        });
      }
      return;
    }

    const add: string[] = [];
    const remove: string[] = [];
    if (patch.isRead === true) remove.push('UNREAD');
    if (patch.isRead === false) add.push('UNREAD');
    if (patch.isStarred === true) add.push('STARRED');
    if (patch.isStarred === false) remove.push('STARRED');
    if (patch.folder === 'ARCHIVE') remove.push('INBOX');
    if (patch.folder === 'INBOX') add.push('INBOX');
    if (patch.folder === 'TRASH') add.push('TRASH');
    if (patch.folder === 'SPAM') add.push('SPAM');
    if (add.length === 0 && remove.length === 0) return;

    for (const message of messages) {
      await this.gmail.modifyMessage(
        account,
        message.providerMessageId,
        add,
        remove,
      );
    }
  }

  /** Sending requires ownership — a shared mailbox is readable, not sendable-as. */
  async send(actor: AuthenticatedUser, payload: SendEmailPayload) {
    const account = await this.visibleAccount(actor, payload.accountId);
    if (account.userId !== actor.id && !this.canManage(actor)) {
      throw new ForbiddenException(
        'You can only send from your own connected mailbox',
      );
    }

    let thread: EmailThread | null = null;
    if (payload.threadId) {
      thread = await this.scopedThread(actor, payload.threadId);
      if (thread.emailAccountId !== account.id) {
        throw new ForbiddenException(
          'That thread belongs to a different mailbox',
        );
      }
    }

    // Threading headers so the reply lands in the same Gmail conversation.
    let inReplyTo: string | null = null;
    let references: string[] = [];
    if (thread) {
      const last = await this.messages.findOne({
        where: { threadId: thread.id },
        order: { sentAt: 'DESC' },
      });
      inReplyTo = last?.messageIdHeader ?? null;
      references = last?.messageIdHeader ? [last.messageIdHeader] : [];
    }

    if (account.providerType === EmailProviderType.IMAP_SMTP) {
      return this.sendViaSmtp(account, payload, thread, {
        inReplyTo,
        references,
      });
    }

    const raw = composeRfc822({
      fromEmail: account.emailAddress,
      fromName: account.name || undefined,
      to: payload.to,
      cc: payload.cc,
      bcc: payload.bcc,
      subject: payload.subject,
      bodyText: payload.bodyText,
      bodyHtml: payload.bodyHtml,
      inReplyTo,
      references,
    });

    const sent = await this.gmail.sendMessage(
      account,
      toBase64Url(raw),
      thread?.providerThreadId,
    );

    // Store immediately so the UI can show it; dedupe keeps the cron's copy.
    const full = await this.gmail.getMessage(account, sent.id);
    await this.ingest.store(account, full);

    const stored = await this.messages.findOneOrFail({
      where: { emailAccountId: account.id, providerMessageId: sent.id },
    });
    return {
      threadId: stored.threadId,
      message: this.messageDto(stored),
    };
  }

  /**
   * SMTP send for app-password accounts. The row is stored optimistically
   * under a `sent:` id; Gmail files the real copy into Sent, and the next
   * sync re-keys this row by Message-ID instead of duplicating.
   */
  private async sendViaSmtp(
    account: EmailAccount,
    payload: SendEmailPayload,
    thread: EmailThread | null,
    threading: { inReplyTo: string | null; references: string[] },
  ) {
    const { messageId } = await this.imap.send(account, {
      fromEmail: account.emailAddress,
      fromName: account.name || undefined,
      to: payload.to,
      cc: payload.cc,
      bcc: payload.bcc,
      subject: payload.subject,
      bodyText: payload.bodyText,
      bodyHtml: payload.bodyHtml,
      inReplyTo: threading.inReplyTo,
      references: threading.references,
    });

    const stored = await this.ingest.storeNormalized(account, {
      providerMessageId: `sent:${messageId || Date.now()}`,
      providerThreadId:
        thread?.providerThreadId ?? subjectThreadKey(payload.subject),
      labelIds: ['SENT'],
      messageIdHeader: messageId || null,
      inReplyToHeader: threading.inReplyTo,
      direction: EmailDirection.OUTBOUND,
      status: EmailMessageStatus.SENT,
      fromEmail: account.emailAddress,
      fromName: account.name || null,
      toEmails: payload.to.map((email) => ({ email })),
      ccEmails: payload.cc.map((email) => ({ email })),
      bccEmails: payload.bcc.map((email) => ({ email })),
      subject: payload.subject,
      bodyText: payload.bodyText,
      bodyHtml: payload.bodyHtml ?? '',
      attachments: [],
      sentAt: new Date(),
    });
    return {
      threadId: stored.threadId,
      message: this.messageDto(stored),
    };
  }

  async downloadAttachment(
    actor: AuthenticatedUser,
    messageId: string,
    attachmentId: string,
  ): Promise<{ filename: string; mimeType: string; data: Buffer }> {
    const message = await this.messages.findOne({
      where: { id: messageId, tenantId: actor.organizationId },
    });
    if (!message) throw new NotFoundException('Message not found');
    await this.scopedThread(actor, message.threadId);

    const attachment = await this.attachments.findOne({
      where: { id: attachmentId, emailMessageId: messageId },
    });
    if (!attachment) throw new NotFoundException('Attachment not found');

    const account = await this.accounts.findOneByOrFail({
      id: message.emailAccountId,
    });
    if (account.providerType === EmailProviderType.IMAP_SMTP) {
      const file = await this.imap.fetchAttachment(
        account,
        attachment.providerAttachmentId,
      );
      if (!file) throw new NotFoundException('Attachment not found upstream');
      return {
        filename: attachment.filename,
        mimeType: attachment.mimeType,
        data: file.data,
      };
    }
    const res = await this.gmail.getAttachment(
      account,
      message.providerMessageId,
      attachment.providerAttachmentId,
    );
    return {
      filename: attachment.filename,
      mimeType: attachment.mimeType,
      data: Buffer.from(res.data, 'base64'),
    };
  }
}
