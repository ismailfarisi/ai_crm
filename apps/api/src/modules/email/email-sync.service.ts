import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { TenantContextService } from '@/common/context/tenant-context.service';
import { EmailAccount, EmailSyncStatus } from './entities/email-account.entity';
import { EmailIngestService } from './email-ingest.service';
import {
  GmailApiError,
  GmailAuthError,
  GmailClientService,
} from './gmail/gmail-client.service';

/** How far back the first sync reaches — keeps onboarding quick. */
const INITIAL_SYNC_MAX = 100;
/** Cap on history pages per pass so a busy mailbox cannot starve others. */
const MAX_HISTORY_PAGES = 5;

/**
 * Polls every connected mailbox for changes. Gmail offers push notifications
 * via Pub/Sub (`users.watch`), which needs a public endpoint plus a GCP topic
 * — polling `history.list` every minute is the dependency-free version and
 * costs one request per account when nothing changed.
 */
@Injectable()
export class EmailSyncService {
  private readonly logger = new Logger(EmailSyncService.name);
  private running = false;

  constructor(
    @InjectRepository(EmailAccount)
    private readonly accounts: Repository<EmailAccount>,
    private readonly gmail: GmailClientService,
    private readonly ingest: EmailIngestService,
    private readonly tenantContext: TenantContextService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async cron(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const due = await this.tenantContext.runAsSystem(() =>
        this.accounts.find({
          where: {
            syncStatus: In([EmailSyncStatus.ACTIVE, EmailSyncStatus.ERROR]),
          },
        }),
      );
      for (const account of due) {
        try {
          await this.tenantContext.runWithTenant(account.tenantId, () =>
            this.syncAccount(account),
          );
        } catch (err) {
          this.logger.warn(
            `Sync failed for ${account.emailAddress}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    } finally {
      this.running = false;
    }
  }

  /**
   * Syncs one mailbox. The caller supplies the tenant context — the cron
   * supplies it per account, `syncNow` reuses the request's context.
   */
  async syncAccount(account: EmailAccount): Promise<void> {
    try {
      if (!account.historyId) {
        await this.initialSync(account);
      } else {
        await this.incrementalSync(account);
      }
      await this.accounts.update(account.id, {
        syncStatus: EmailSyncStatus.ACTIVE,
        syncError: null,
        lastSyncedAt: new Date(),
      });
    } catch (err) {
      if (err instanceof GmailAuthError) {
        await this.accounts.update(account.id, {
          syncStatus: EmailSyncStatus.ERROR,
          syncError: err.message,
        });
        return;
      }
      throw err;
    }
  }

  /** First connect (or a lapsed history cursor): recent mail + a fresh cursor. */
  private async initialSync(account: EmailAccount): Promise<void> {
    const profile = await this.gmail.getProfile(account);
    let pageToken: string | undefined;
    let ingested = 0;
    do {
      const page = await this.gmail.listMessages(account, {
        maxResults: INITIAL_SYNC_MAX,
        pageToken,
      });
      for (const stub of page.messages ?? []) {
        await this.ingest.ingest(account, stub.id);
        ingested++;
      }
      pageToken = page.nextPageToken;
      // One page is enough for onboarding; the history cursor picks up the
      // rest as it changes instead of paying for a full backfill now.
    } while (pageToken && ingested < INITIAL_SYNC_MAX);

    await this.accounts.update(account.id, {
      historyId: profile.historyId ?? null,
    });
  }

  private async incrementalSync(account: EmailAccount): Promise<void> {
    let pageToken: string | undefined;
    let pages = 0;
    let newestHistoryId: string | undefined;

    do {
      let page;
      try {
        page = await this.gmail.listHistory(
          account,
          account.historyId!,
          pageToken,
        );
      } catch (err) {
        // HTTP 404 = the cursor is older than Gmail keeps — fall back to a
        // fresh list sync rather than failing forever.
        if (err instanceof GmailApiError && err.status === 404) {
          await this.accounts.update(account.id, { historyId: null });
          await this.initialSync(account);
          return;
        }
        throw err;
      }

      const added = new Set<string>();
      const deleted = new Set<string>();
      const relabelled = new Set<string>();
      for (const record of page.history ?? []) {
        record.messagesAdded?.forEach((m) => added.add(m.message.id));
        record.messagesDeleted?.forEach((m) => deleted.add(m.message.id));
        record.labelsAdded?.forEach((m) => relabelled.add(m.message.id));
        record.labelsRemoved?.forEach((m) => relabelled.add(m.message.id));
      }

      for (const id of added) {
        await this.ingest.ingest(account, id);
        deleted.delete(id);
        relabelled.delete(id);
      }
      for (const id of relabelled) {
        // Re-fetch the labels only — ingest is idempotent and cheaper than
        // diffing which flags moved.
        await this.ingest.ingest(account, id);
      }
      for (const id of deleted) {
        await this.ingest.removeMessage(account, id);
      }

      newestHistoryId = page.historyId ?? newestHistoryId;
      pageToken = page.nextPageToken;
      pages++;
    } while (pageToken && pages < MAX_HISTORY_PAGES);

    if (newestHistoryId) {
      await this.accounts.update(account.id, {
        historyId: newestHistoryId,
      });
    }
  }
}
