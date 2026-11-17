import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DataSource, type EntityManager } from 'typeorm';
import {
  CHANNEL_SKILLS,
  type ApprovalNoticeEvent,
  type NotificationChannel,
} from '@saas/shared';
import type { AppConfig } from '@/config/configuration';
import { TenantContextService } from '@/common/context/tenant-context.service';
import {
  EventOutboxService,
  type OutboxMessage,
} from '@/common/events/event-outbox.service';
import { MailService } from '../mail/mail.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ChannelsService } from '../channels/channels.service';
import { ChannelProviderType } from '../channels/entities/channel-config.entity';
import { ApprovalRequest } from './entities/approval-request.entity';
import { ApprovalDelivery } from './entities/approval-delivery.entity';
import { NotificationPreference } from './entities/notification-preference.entity';
import {
  APPROVAL_NOTICE_OUTBOX_KIND,
  type ApprovalNoticePayload,
} from './approval-notifier.service';
import {
  activeUserInTenant,
  approvalRecipients,
  itemStillPending,
} from './approval-recipients';
import {
  channelsFor,
  chatBody,
  chatReplyable,
  deferredByQuietHours,
  effectivePreferences,
  emailFor,
  noticeText,
  quietUntil,
} from './approval-notice.logic';

/** Chats that can carry a staff notice; email channels are customer-facing. */
const CHAT_PROVIDERS = [
  ChannelProviderType.TELEGRAM,
  ChannelProviderType.WHATSAPP_META,
];
/** A reply to a chat notice is accepted for a day. */
const CHAT_PROMPT_TTL_MS = 24 * 60 * 60 * 1000;
/** Skill name on prompt rows the command layer hands to ApprovalReplyService. */
export const APPROVAL_REPLY_SKILL = 'approval.reply';
import { APPROVAL_PROMPT_SLOT } from '../channels/services/approval-reply.service';
export const APPROVAL_SLOT = APPROVAL_PROMPT_SLOT;

const CLAIM_DELIVERY = `
INSERT INTO "approval_deliveries" ("tenant_id", "request_id", "user_id", "event", "channel", "status", "attempts")
VALUES ($1, $2, $3, $4, $5, 'SENDING', 1)
ON CONFLICT ("request_id", "user_id", "event", "channel") DO UPDATE
   SET "status" = 'SENDING', "attempts" = "approval_deliveries"."attempts" + 1, "updated_at" = now()
 WHERE "approval_deliveries"."status" = 'FAILED'
    OR ("approval_deliveries"."status" = 'SENDING' AND "approval_deliveries"."updated_at" < now() - interval '5 minutes')
RETURNING "id"`;

/** One statement: a due request is claimed and its reminder queued together. */
const QUEUE_DUE_REMINDERS = `
WITH due AS (
  UPDATE "approval_requests" SET "reminded_at" = now()
   WHERE "id" IN (
     SELECT "id" FROM "approval_requests"
      WHERE "status" = 'PENDING' AND "reminded_at" IS NULL AND "remind_at" <= now()
      ORDER BY "remind_at"
      LIMIT 200
      FOR UPDATE SKIP LOCKED)
     AND "reminded_at" IS NULL
  RETURNING "id", "tenant_id")
INSERT INTO "crm_event_outbox" ("id", "tenant_id", "kind", "event_type", "payload")
SELECT gen_random_uuid(), "tenant_id", '${APPROVAL_NOTICE_OUTBOX_KIND}', 'approval.reminder', jsonb_build_object('requestId', "id")
  FROM due
RETURNING "id"`;

const CLAIM_DEFERRED = `
UPDATE "approval_deliveries" SET "status" = 'SENDING', "attempts" = "attempts" + 1, "updated_at" = now()
 WHERE "id" IN (
   SELECT "id" FROM "approval_deliveries"
    WHERE "status" = 'DEFERRED' AND "due_at" <= now()
    ORDER BY "due_at"
    LIMIT 200
    FOR UPDATE SKIP LOCKED)
RETURNING "id", "tenant_id", "request_id", "user_id", "event", "channel"`;

type SendResult = 'SENT' | 'SKIPPED';

export const DECIDED_EVENT: Record<string, ApprovalNoticeEvent> = {
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
};

/**
 * Delivers approval notices from the outbox: the bell, email and the
 * approver's own linked chat, per their preferences. Each (request, person,
 * event, channel) is claimed once in approval_deliveries, so a redelivered
 * outbox message sends nothing twice; a failed channel is retried by the
 * outbox without repeating the channels that worked.
 */
@Injectable()
export class ApprovalNoticeDispatcherService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(ApprovalNoticeDispatcherService.name);
  private unregister?: () => void;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly outbox: EventOutboxService,
    private readonly tenantContext: TenantContextService,
    private readonly mail: MailService,
    private readonly notifications: NotificationsService,
    private readonly channels: ChannelsService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  onModuleInit(): void {
    this.unregister = this.outbox.registerHandler(
      APPROVAL_NOTICE_OUTBOX_KIND,
      (message) => this.handle(message as OutboxMessage<ApprovalNoticePayload>),
    );
  }

  onModuleDestroy(): void {
    this.unregister?.();
  }

  async handle(message: OutboxMessage<ApprovalNoticePayload>): Promise<void> {
    const m = this.dataSource.manager;
    const request = await m.findOne(ApprovalRequest, {
      where: { id: message.payload.requestId, tenantId: message.tenantId },
    });
    if (!request) return;

    if (message.eventType === 'approval.decided') {
      // The approvers' bell items are done with.
      await this.notifications.resolve(request.tenantId, request.itemId);
      const event = DECIDED_EVENT[request.status];
      const requester = request.requestedByUserId;
      if (!event || !requester || requester === request.decidedByUserId) return;
      if (!(await activeUserInTenant(m, request.tenantId, requester))) return;
      await this.deliverAll(request, [requester], event);
      return;
    }

    const event: ApprovalNoticeEvent =
      message.eventType === 'approval.reminder' ? 'REMINDER' : 'REQUESTED';
    if (event === 'REQUESTED' && !request.notifyNow) return;
    if (!(await this.stillWaiting(m, request))) return;
    await this.deliverAll(request, await this.recipientsOf(m, request), event);
  }

  /** Who may decide, as of now: permissions can change while it waits. */
  async recipientsOf(
    m: Pick<EntityManager, 'query'>,
    request: ApprovalRequest,
  ): Promise<string[]> {
    if (request.recipientUserId) {
      return (await activeUserInTenant(
        m,
        request.tenantId,
        request.recipientUserId,
      ))
        ? [request.recipientUserId]
        : [];
    }
    return approvalRecipients(
      m,
      request.tenantId,
      request.permissions,
      request.requestedByUserId,
    );
  }

  private async stillWaiting(
    m: EntityManager,
    request: ApprovalRequest,
  ): Promise<boolean> {
    const fresh = await m.findOne(ApprovalRequest, {
      where: { id: request.id, tenantId: request.tenantId },
    });
    if (fresh?.status !== 'PENDING') return false;
    if (
      await itemStillPending(
        m,
        request.tenantId,
        request.itemType,
        request.itemId,
      )
    ) {
      return true;
    }
    // Decided or withdrawn some other way: stop reminding.
    await m.update(
      ApprovalRequest,
      { id: request.id, tenantId: request.tenantId, status: 'PENDING' },
      { status: 'CLOSED', decidedAt: new Date() },
    );
    return false;
  }

  private async deliverAll(
    request: ApprovalRequest,
    userIds: string[],
    event: ApprovalNoticeEvent,
  ): Promise<void> {
    const failures: string[] = [];
    for (const userId of userIds) {
      const prefs = await this.preferencesFor(request.tenantId, userId);
      const quiet = quietUntil(prefs, new Date());
      for (const channel of channelsFor(prefs, event)) {
        const deliveryId = await this.claim(request, userId, event, channel);
        if (!deliveryId) continue;
        if (quiet && deferredByQuietHours(channel)) {
          await this.dataSource.manager.update(ApprovalDelivery, deliveryId, {
            status: 'DEFERRED',
            dueAt: quiet,
          });
          continue;
        }
        const failed = await this.sendClaimed(
          deliveryId,
          request,
          userId,
          event,
          channel,
        );
        if (failed) failures.push(failed);
      }
    }
    // Thrown last, so the outbox retries only what failed.
    if (failures.length) throw new Error(failures.join('; '));
  }

  private async claim(
    request: ApprovalRequest,
    userId: string,
    event: ApprovalNoticeEvent,
    channel: NotificationChannel,
  ): Promise<string | null> {
    const rows: Array<{ id: string }> = await this.dataSource.query(
      CLAIM_DELIVERY,
      [request.tenantId, request.id, userId, event, channel],
    );
    return rows[0]?.id ?? null;
  }

  /** Sends one claimed delivery and records the result; returns an error or null. */
  private async sendClaimed(
    deliveryId: string,
    request: ApprovalRequest,
    userId: string,
    event: ApprovalNoticeEvent,
    channel: NotificationChannel,
  ): Promise<string | null> {
    try {
      const result = await this.send(request, userId, event, channel);
      await this.dataSource.manager.update(ApprovalDelivery, deliveryId, {
        status: result,
        sentAt: result === 'SENT' ? new Date() : null,
        lastError: null,
      });
      return null;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      await this.dataSource.manager.update(ApprovalDelivery, deliveryId, {
        status: 'FAILED',
        lastError: msg.slice(0, 1000),
      });
      this.logger.warn(
        `Approval notice ${channel} to ${userId} failed: ${msg}`,
      );
      return `${channel}: ${msg}`;
    }
  }

  private async send(
    request: ApprovalRequest,
    userId: string,
    event: ApprovalNoticeEvent,
    channel: NotificationChannel,
  ): Promise<SendResult> {
    const text = noticeText(request, event);
    switch (channel) {
      case 'BELL':
        await this.dataSource.query(
          `INSERT INTO "notifications" ("tenant_id", "user_id", "type", "title", "body", "link", "entity_type", "entity_id")
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT DO NOTHING`,
          [
            request.tenantId,
            userId,
            text.type,
            text.title,
            text.body,
            request.link,
            request.itemType,
            request.itemId,
          ],
        );
        return 'SENT';
      case 'EMAIL': {
        const rows: Array<{ email: string | null }> =
          await this.dataSource.query(
            `SELECT "email" FROM "users" WHERE "id" = $1 AND "tenant_id" = $2`,
            [userId, request.tenantId],
          );
        const to = rows[0]?.email;
        if (!to) return 'SKIPPED';
        await this.mail.sendMail({
          to,
          ...emailFor(text, this.absolute(request.link)),
        });
        return 'SENT';
      }
      case 'CHAT':
        return this.sendChat(request, userId, event, text);
    }
  }

  /**
   * To the approver's own linked staff chat, never a customer thread: the
   * recipient is the identifier they linked with a one-time code. A request
   * also opens a reply prompt, unless they are in the middle of a command.
   */
  private async sendChat(
    request: ApprovalRequest,
    userId: string,
    event: ApprovalNoticeEvent,
    text: ReturnType<typeof noticeText>,
  ): Promise<SendResult> {
    const identities: Array<{
      provider: ChannelProviderType;
      identifier: string;
    }> = await this.dataSource.query(
      `SELECT i."provider", i."identifier"
           FROM "staff_channel_identities" i
           JOIN "channel_configs" c
             ON c."organizationId" = i."organizationId" AND c."provider"::text = i."provider"::text
          WHERE i."organizationId" = $1 AND i."userId" = $2
            AND i."provider"::text = ANY($3::text[]) AND c."isEnabled"`,
      [request.tenantId, userId, CHAT_PROVIDERS],
    );
    if (!identities.length) return 'SKIPPED';

    let sent = false;
    for (const identity of identities) {
      const replyable =
        chatReplyable(request, event) &&
        (await this.openReplyPrompt(request, userId, identity));
      await this.channels.sendMessage(request.tenantId, userId, {
        provider: identity.provider,
        recipient: identity.identifier,
        body: chatBody(text, this.absolute(request.link), replyable),
      });
      sent = true;
    }
    return sent ? 'SENT' : 'SKIPPED';
  }

  /**
   * Opens the conversation a YES/NO reply lands in. A quote uses the quote
   * approval skill's own confirmation, so YES runs exactly what "approve
   * QT-…" would. Returns false when the person is mid-command: that is not
   * clobbered, and the message just links to the app.
   */
  private async openReplyPrompt(
    request: ApprovalRequest,
    userId: string,
    identity: { provider: ChannelProviderType; identifier: string },
  ): Promise<boolean> {
    const live: Array<{
      id: string;
      skill_name: string;
      slots: Record<string, unknown>;
    }> = await this.dataSource.query(
      `SELECT "id", "skill_name", "slots" FROM "channel_conversations"
          WHERE "organization_id" = $1 AND "provider"::text = $2 AND "sender_identifier" = $3
            AND "status"::text IN ('COLLECTING', 'AWAITING_CONFIRM') AND "expires_at" > now()`,
      [request.tenantId, identity.provider, identity.identifier],
    );
    if (live.some((row) => !row.slots?.[APPROVAL_SLOT])) return false;

    const resolved =
      request.itemType === 'QUOTE' ? (request.meta?.quote ?? null) : null;
    if (request.itemType === 'QUOTE' && !resolved) return false;

    await this.dataSource.transaction(async (m) => {
      await m.query(
        `UPDATE "channel_conversations" SET "status" = 'EXPIRED', "resolved_at" = now()
          WHERE "organization_id" = $1 AND "provider"::text = $2 AND "sender_identifier" = $3
            AND "status"::text IN ('COLLECTING', 'AWAITING_CONFIRM')`,
        [request.tenantId, identity.provider, identity.identifier],
      );
      await m.query(
        `INSERT INTO "channel_conversations"
           ("organization_id", "user_id", "provider", "sender_identifier", "skill_name", "slots", "status", "pending_question", "expires_at")
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, 'AWAITING_CONFIRM', $7, $8)`,
        [
          request.tenantId,
          userId,
          identity.provider,
          identity.identifier,
          request.itemType === 'QUOTE'
            ? CHANNEL_SKILLS.QUOTE_APPROVE
            : APPROVAL_REPLY_SKILL,
          JSON.stringify({
            ...(resolved ? { _resolved: resolved } : {}),
            [APPROVAL_SLOT]: {
              requestId: request.id,
              itemType: request.itemType,
              itemId: request.itemId,
              title: request.title,
              ...(request.meta?.toolCallId
                ? { toolCallId: request.meta.toolCallId }
                : {}),
            },
          }),
          request.title,
          new Date(Date.now() + CHAT_PROMPT_TTL_MS),
        ],
      );
    });
    return true;
  }

  private absolute(link: string | null): string | null {
    if (!link) return null;
    if (/^https?:\/\//.test(link)) return link;
    return `${this.config.get('publicWebUrl', { infer: true })}${link}`;
  }

  async preferencesFor(tenantId: string, userId: string) {
    const rows = await this.dataSource.manager
      .createQueryBuilder(NotificationPreference, 'p')
      .where('p.tenant_id = :tenantId', { tenantId })
      .andWhere('(p.user_id = :userId OR p.user_id IS NULL)', { userId })
      .getMany();
    return effectivePreferences(
      rows.find((r) => r.userId === userId),
      rows.find((r) => r.userId === null),
    );
  }

  /** Queues the one reminder for every request whose time has come. */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async queueDueReminders(): Promise<number> {
    try {
      const rows: unknown = await this.tenantContext.runAsSystem(() =>
        this.dataSource.query(QUEUE_DUE_REMINDERS),
      );
      return Array.isArray(rows) ? rows.length : 0;
    } catch (err: unknown) {
      this.logger.warn(
        `Approval reminders not queued: ${err instanceof Error ? err.message : String(err)}`,
      );
      return 0;
    }
  }

  /** Sends what quiet hours held back, if it is still worth sending. */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async sendDeferred(): Promise<number> {
    let claimed: Array<{
      id: string;
      tenant_id: string;
      request_id: string;
      user_id: string;
      event: ApprovalNoticeEvent;
      channel: NotificationChannel;
    }> = [];
    try {
      const result: unknown = await this.tenantContext.runAsSystem(() =>
        this.dataSource.query(CLAIM_DEFERRED),
      );
      claimed = (
        Array.isArray(result) && Array.isArray(result[0]) ? result[0] : result
      ) as typeof claimed;
    } catch (err: unknown) {
      this.logger.warn(
        `Deferred approval notices not claimed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return 0;
    }
    for (const row of claimed) {
      await this.tenantContext
        .runWithTenant(row.tenant_id, async () => {
          const m = this.dataSource.manager;
          const request = await m.findOne(ApprovalRequest, {
            where: { id: row.request_id, tenantId: row.tenant_id },
          });
          const stale =
            !request ||
            ((row.event === 'REQUESTED' || row.event === 'REMINDER') &&
              !(await this.stillWaiting(m, request)));
          if (stale) {
            await m.update(ApprovalDelivery, row.id, { status: 'SKIPPED' });
            return;
          }
          await this.sendClaimed(
            row.id,
            request,
            row.user_id,
            row.event,
            row.channel,
          );
        })
        .catch((err: unknown) =>
          this.logger.warn(
            `Deferred approval notice ${row.id} failed: ${err instanceof Error ? err.message : String(err)}`,
          ),
        );
    }
    return claimed.length;
  }
}
