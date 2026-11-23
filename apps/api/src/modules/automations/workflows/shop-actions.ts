import { ApplicationFailure } from '@temporalio/activity';
import { HttpException } from '@nestjs/common';
import { In, IsNull, LessThan, Not, type DataSource } from 'typeorm';
import {
  AUTOMATION_MESSAGE_CHANNELS,
  PERMISSIONS,
  findNotifyGroup,
  invoicePosition,
  lookupSampleForTest,
  needsReorder,
  type Permission,
} from '@saas/shared';
import { z } from 'zod';
import type { AuditService } from '@/modules/audit/audit.service';
import type { ChannelsService } from '@/modules/channels/channels.service';
import type {
  NotificationInput,
  NotificationsService,
} from '@/modules/notifications/notifications.service';
import {
  ChannelMessage,
  MessageDirection,
} from '@/modules/channels/entities/channel-message.entity';
import { ChannelThread } from '@/modules/channels/entities/channel-thread.entity';
import { ChannelProviderType } from '@/modules/channels/entities/channel-config.entity';
import { StaffChannelIdentity } from '@/modules/channels/entities/staff-channel-identity.entity';
import { User } from '@/modules/users/entities/user.entity';
import { Organization } from '@/modules/organizations/entities/organization.entity';
import { Quote, QuoteStatus } from '@/modules/quotes/entities/quote.entity';
import { QuoteProof } from '@/modules/quotes/entities/quote-proof.entity';
import {
  Invoice,
  InvoiceStatus,
} from '@/modules/quotes/entities/invoice.entity';
import { InvoicePayment } from '@/modules/quotes/entities/invoice-payment.entity';
import { SalesOrder } from '@/modules/orders/entities/sales-order.entity';
import { WorkOrder } from '@/modules/production/entities/work-order.entity';
import { PurchaseOrder } from '@/modules/purchasing/entities/purchase-order.entity';
import { StockItem } from '@/modules/inventory/entities/stock-item.entity';
import type { AuthenticatedUser } from '@/common/types/authenticated-user';
import {
  asText,
  ownerCannot,
  resolveOwner,
  type AutomationActionDeps,
} from './automation-actions';
import type {
  AutomationActionContext,
  ChannelMessageActivityConfig,
  ChannelMessageActivityResult,
  RecordLookupActivityConfig,
  StaffNotificationActivityConfig,
  StaffNotificationActivityResult,
} from './interfaces';

const MAX_RECIPIENTS = 10;

/**
 * Events Kerf raises its own bell alert for, with the type and record that
 * alert is filed under. The bell holds one unread alert per person, type and
 * record, so an automation's alert filed the same way joins the built-in one.
 */
const BUILT_IN_ALERTS: Record<
  string,
  { type: NotificationInput['type']; entityType: string }
> = {
  'stock.low': { type: 'LOW_STOCK', entityType: 'STOCK_ITEM' },
  'quote.changes_requested': {
    type: 'QUOTE_CUSTOMER_RESPONSE',
    entityType: 'QUOTE',
  },
  'quote.declined': { type: 'QUOTE_CUSTOMER_RESPONSE', entityType: 'QUOTE' },
  'proof.approved': { type: 'QUOTE_PROOF_RESPONSE', entityType: 'QUOTE' },
  'proof.changes_requested': {
    type: 'QUOTE_PROOF_RESPONSE',
    entityType: 'QUOTE',
  },
  'conversation.handover': {
    type: 'CONVERSATION_HANDOVER',
    entityType: 'channel_thread',
  },
};
const MAX_MESSAGE_LENGTH = 4000;
const emailSchema = z.string().email();
const recordIdSchema = z.string().uuid();

export const AI_CHAT_REFUSAL =
  'An automation never sends AI-written text to a customer on WhatsApp, Telegram or Slack. Write the message yourself in this step, or send the AI text to your team instead.';

export interface ShopActionDeps extends Pick<
  AutomationActionDeps,
  'users' | 'rbac' | 'audit' | 'tenantContext' | 'idempotency'
> {
  dataSource: Pick<DataSource, 'getRepository'>;
  channels: Pick<ChannelsService, 'sendMessage'>;
  notifications: Pick<NotificationsService, 'notifyHolders' | 'notifyUsers'>;
  audit: Pick<AuditService, 'record'>;
}

type Row = Record<string, string | number | boolean | null>;

function refuse(message: string): never {
  throw ApplicationFailure.nonRetryable(message);
}

function channelLabel(channel: string): string {
  return (
    AUTOMATION_MESSAGE_CHANNELS.find((c) => c.value === channel)?.label ??
    channel
  );
}

function splitList(value: unknown): string[] {
  return [
    ...new Set(
      asText(value)
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ];
}

function requirePermission(
  owner: AuthenticatedUser,
  permission: Permission,
  actionLabel: string,
): void {
  if (!owner.permissions.includes(permission)) {
    throw ownerCannot(owner.email, actionLabel, permission);
  }
}

function iso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function money(amount: number, currency: string): string {
  return `${currency} ${amount.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** A WhatsApp address is the number's digits; other channels are used as typed. */
function normaliseAddress(channel: string, address: string): string {
  return channel === 'WHATSAPP_META' ? address.replace(/\D/g, '') : address;
}

/**
 * The steps a shop's recipes need beyond email: a chat message, the bell, and
 * read-only lookups. Like every automation step they run as the person who
 * turned the automation on, with that person's permissions resolved now.
 */
export function createShopActions(deps: ShopActionDeps) {
  async function staffByEmail(
    tenantId: string,
    emails: string[],
    stepName: string,
  ): Promise<User[]> {
    for (const email of emails) {
      if (!emailSchema.safeParse(email).success) {
        refuse(
          `${stepName}: "${email}" is not an email address. Enter the email your colleague signs in with.`,
        );
      }
    }
    const wanted = emails.map((email) => email.toLowerCase());
    const users = await deps.dataSource
      .getRepository(User)
      .find({ where: { tenantId, email: In(wanted), isActive: true } });
    const found = new Set(users.map((user) => user.email.toLowerCase()));
    const missing = wanted.filter((email) => !found.has(email));
    if (missing.length) {
      refuse(
        `${stepName}: ${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} not an active member of your team.`,
      );
    }
    return users;
  }

  /** Where each recipient is reached, and the contact a customer message belongs to. */
  async function resolveRecipients(
    config: ChannelMessageActivityConfig,
    ctx: AutomationActionContext,
  ): Promise<{ address: string; contactId: string | null; name: string }[]> {
    const channel = config.channel;
    const label = channelLabel(channel);
    const targets = splitList(config.to);
    if (targets.length === 0) refuse('Send message has nobody to send to');
    if (targets.length > MAX_RECIPIENTS) {
      refuse(
        `Send message supports at most ${MAX_RECIPIENTS} recipients, got ${targets.length}`,
      );
    }

    if (config.audience === 'staff') {
      // A Slack channel is the team's own room: no personal link needed.
      const rooms =
        channel === 'SLACK'
          ? targets.filter((t) => /^[CG][A-Z0-9]+$/.test(t))
          : [];
      const emails = targets.filter((t) => !rooms.includes(t));
      const users = emails.length
        ? await staffByEmail(ctx.tenantId, emails, 'Send message')
        : [];
      const identities = users.length
        ? await deps.dataSource.getRepository(StaffChannelIdentity).find({
            where: {
              organizationId: ctx.tenantId,
              provider: channel as ChannelProviderType,
              userId: In(users.map((user) => user.id)),
            },
          })
        : [];
      const unlinked = users.filter(
        (user) => !identities.some((identity) => identity.userId === user.id),
      );
      if (unlinked.length) {
        refuse(
          `${unlinked.map((user) => user.email).join(', ')} ${unlinked.length === 1 ? 'has' : 'have'} not linked ${label} to Kerf yet, so there is nowhere to send this. They can link it from their profile, or use an "Alert the team in Kerf" step to reach them in the app.`,
        );
      }
      return [
        ...rooms.map((room) => ({
          address: room,
          contactId: null,
          name: room,
        })),
        ...users.map((user) => ({
          address: identities.find((identity) => identity.userId === user.id)!
            .identifier,
          contactId: null,
          name: user.email,
        })),
      ];
    }

    // A customer. AI-written chat text needs a person's approval; a step
    // cannot give one, and no setting turns this off.
    if (ctx.aiWritten) refuse(AI_CHAT_REFUSAL);

    const resolved: {
      address: string;
      contactId: string | null;
      name: string;
    }[] = [];
    for (const target of targets) {
      const address = normaliseAddress(channel, target);
      // Only someone who has written to the shop on this channel: that is
      // the one address known to be theirs, and the only one WhatsApp will
      // deliver ordinary text to.
      const last = address
        ? await deps.dataSource.getRepository(ChannelMessage).findOne({
            where: {
              organizationId: ctx.tenantId,
              provider: channel as ChannelProviderType,
              direction: MessageDirection.INBOUND,
              sender: address,
            },
            order: { createdAt: 'DESC' },
          })
        : null;
      if (!last) {
        refuse(
          `"${target}" has never messaged you on ${label}, so this was not sent. A chat message can only go to a customer who has written to you on that channel first; use "Send email" for everyone else.`,
        );
      }
      resolved.push({ address, contactId: last.contactId, name: target });
    }
    return resolved;
  }

  async function quoteLookup(tenantId: string, id: string): Promise<Row> {
    const quote = await deps.dataSource
      .getRepository(Quote)
      .findOne({ where: { id, tenantId } });
    if (!quote) refuse('Look up a quote: that quote no longer exists');
    // The link's hash is never loaded with a quote (select: false), so whether
    // the quote was sent is asked of the database.
    const sent =
      (await deps.dataSource.getRepository(Quote).count({
        where: { id, tenantId, acceptanceTokenHash: Not(IsNull()) },
      })) > 0;
    const expired = Boolean(
      quote.acceptanceExpiresAt && quote.acceptanceExpiresAt < new Date(),
    );
    return {
      quoteId: quote.id,
      quoteNumber: quote.quoteNumber ?? null,
      title: quote.title,
      customerName: quote.customerName,
      customerEmail: quote.customerEmail ?? null,
      totalAmount: Number(quote.totalAmount),
      currency: quote.currency,
      status: quote.status,
      accepted: Boolean(quote.acceptedAt),
      customerResponse: quote.customerResponse ?? null,
      validUntil: iso(quote.validUntil),
      // Sent, still open, and the customer has said nothing yet.
      awaitingCustomer:
        quote.status === QuoteStatus.APPROVED &&
        sent &&
        !quote.acceptedAt &&
        !quote.supersededAt &&
        !quote.customerResponse &&
        !expired,
    };
  }

  async function proofLookup(tenantId: string, id: string): Promise<Row> {
    const proof = await deps.dataSource
      .getRepository(QuoteProof)
      .findOne({ where: { id, tenantId } });
    if (!proof) refuse('Look up an artwork proof: that proof no longer exists');
    const quote = await deps.dataSource
      .getRepository(Quote)
      .findOne({ where: { id: proof.quoteId, tenantId } });
    const replaced = Boolean(proof.supersededAt);
    return {
      proofId: proof.id,
      proofVersion: proof.version,
      quoteNumber: quote?.quoteNumber ?? null,
      title: quote?.title ?? null,
      customerName: quote?.customerName ?? null,
      customerEmail: quote?.customerEmail ?? null,
      status: proof.status,
      replaced,
      awaitingCustomer: proof.status === 'PENDING' && !replaced,
    };
  }

  async function invoiceLookup(tenantId: string, id: string): Promise<Row> {
    const invoice = await deps.dataSource
      .getRepository(Invoice)
      .findOne({ where: { id, tenantId } });
    if (!invoice) refuse('Look up an invoice: that invoice no longer exists');
    const balance = invoicePosition({
      amount: Number(invoice.amount),
      paidAmount: Number(invoice.paidAmount ?? 0),
      creditedAmount: Number(invoice.creditedAmount ?? 0),
      refundedAmount: Number(invoice.refundedAmount ?? 0),
    }).balance;
    return {
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      customerName: invoice.customerName,
      customerEmail: invoice.customerEmail ?? null,
      amount: Number(invoice.amount),
      paidAmount: Number(invoice.paidAmount ?? 0),
      balance,
      currency: invoice.currency,
      status: invoice.status,
      dueDate: iso(invoice.dueDate),
      unpaid:
        balance > 0 &&
        (invoice.status === InvoiceStatus.ISSUED ||
          invoice.status === InvoiceStatus.PARTIALLY_PAID),
    };
  }

  /** Counts only what the owner may see; anything else is left out as zero. */
  async function dailySummary(
    tenantId: string,
    owner: AuthenticatedUser,
  ): Promise<Row> {
    const can = (permission: Permission) =>
      owner.permissions.includes(permission);
    const repo: DataSource['getRepository'] = (entity) =>
      deps.dataSource.getRepository(entity);
    const now = new Date();
    const today = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );
    const tomorrow = new Date(today.getTime() + 86_400_000);
    const yesterday = new Date(today.getTime() - 86_400_000);
    const liveJobs = In(['PLANNED', 'RELEASED', 'IN_PROGRESS']);

    const organization = await repo(Organization).findOne({
      where: { id: tenantId },
    });
    const currency = organization?.baseCurrency ?? 'AED';

    const quotesAwaitingCustomer = can(PERMISSIONS.QUOTE_READ)
      ? await repo(Quote).count({
          where: {
            tenantId,
            status: QuoteStatus.APPROVED,
            acceptedAt: IsNull(),
            supersededAt: IsNull(),
            customerResponse: IsNull(),
            acceptanceTokenHash: Not(IsNull()),
          },
        })
      : 0;
    const proofsAwaitingCustomer = can(PERMISSIONS.QUOTE_READ)
      ? await repo(QuoteProof).count({
          where: { tenantId, status: 'PENDING', supersededAt: IsNull() },
        })
      : 0;
    const ordersInProduction = can(PERMISSIONS.SALES_ORDER_READ)
      ? await repo(SalesOrder).count({
          where: { tenantId, status: 'IN_PRODUCTION' },
        })
      : 0;
    const dueJobs = can(PERMISSIONS.WORK_ORDER_READ)
      ? await repo(WorkOrder).find({
          where: { tenantId, status: liveJobs, dueDate: LessThan(tomorrow) },
          select: { id: true, dueDate: true },
        })
      : [];
    const jobsLate = dueJobs.filter(
      (job) => job.dueDate && new Date(job.dueDate) < today,
    ).length;
    const jobsDueToday = dueJobs.length - jobsLate;

    const overdue = can(PERMISSIONS.INVOICE_READ)
      ? await repo(Invoice).find({
          where: {
            tenantId,
            status: In([InvoiceStatus.ISSUED, InvoiceStatus.PARTIALLY_PAID]),
            dueDate: LessThan(now),
          },
        })
      : [];
    const overdueAmount =
      Math.round(
        overdue.reduce(
          (sum, invoice) =>
            sum +
            invoicePosition({
              amount: Number(invoice.amount),
              paidAmount: Number(invoice.paidAmount ?? 0),
              creditedAmount: Number(invoice.creditedAmount ?? 0),
              refundedAmount: Number(invoice.refundedAmount ?? 0),
            }).balance,
          0,
        ) * 100,
      ) / 100;
    const paid = can(PERMISSIONS.INVOICE_READ)
      ? await repo(InvoicePayment)
          .createQueryBuilder('p')
          .select('COALESCE(SUM(p.amount), 0)', 'sum')
          .where('p.tenantId = :tenantId', { tenantId })
          .andWhere('p.paidAt >= :from AND p.paidAt < :to', {
            from: yesterday,
            to: today,
          })
          .getRawOne<{ sum: string }>()
      : null;
    const paymentsYesterday = Math.round(Number(paid?.sum ?? 0) * 100) / 100;

    const stock = can(PERMISSIONS.INVENTORY_READ)
      ? await repo(StockItem).find({
          where: { tenantId, reorderPoint: Not(IsNull()) },
        })
      : [];
    const stockItemsLow = stock.filter((item) => needsReorder(item)).length;
    const purchaseOrdersAwaitingApproval = can(PERMISSIONS.PURCHASE_ORDER_READ)
      ? await repo(PurchaseOrder).count({
          where: { tenantId, status: 'AWAITING_APPROVAL' },
        })
      : 0;
    const conversationsWaiting = can(PERMISSIONS.CHANNEL_READ)
      ? await repo(ChannelThread).count({
          where: { organizationId: tenantId, state: 'NEEDS_HUMAN' },
        })
      : 0;

    const summaryText = [
      `Quotes waiting on customers: ${quotesAwaitingCustomer}`,
      `Proofs waiting on customers: ${proofsAwaitingCustomer}`,
      `Orders in production: ${ordersInProduction}`,
      `Jobs due today: ${jobsDueToday}${jobsLate ? ` (${jobsLate} late)` : ''}`,
      `Overdue invoices: ${overdue.length}${overdue.length ? ` (${money(overdueAmount, currency)})` : ''}`,
      `Payments received yesterday: ${money(paymentsYesterday, currency)}`,
      `Materials at or below minimum: ${stockItemsLow}`,
      `Purchase orders waiting for approval: ${purchaseOrdersAwaitingApproval}`,
      `Customer conversations waiting for a person: ${conversationsWaiting}`,
    ].join('\n');

    return {
      date: today.toISOString().slice(0, 10),
      quotesAwaitingCustomer,
      proofsAwaitingCustomer,
      ordersInProduction,
      jobsDueToday,
      jobsLate,
      invoicesOverdue: overdue.length,
      overdueAmount,
      paymentsYesterday,
      currency,
      stockItemsLow,
      purchaseOrdersAwaitingApproval,
      conversationsWaiting,
      summaryText,
    };
  }

  return {
    async executeChannelMessageActivity(
      config: ChannelMessageActivityConfig,
      ctx: AutomationActionContext,
    ): Promise<ChannelMessageActivityResult> {
      return deps.tenantContext.runAsAutomation(
        ctx.tenantId,
        ctx.executionId,
        async () => {
          const owner = await resolveOwner(deps, ctx, 'send messages');
          requirePermission(owner, PERMISSIONS.CHANNEL_SEND, 'send messages');

          const channel = asText(config.channel);
          if (!AUTOMATION_MESSAGE_CHANNELS.some((c) => c.value === channel)) {
            refuse(
              'Send message: choose WhatsApp, Telegram or Slack. Use "Send email" for email.',
            );
          }
          const audience = config.audience === 'staff' ? 'staff' : 'customer';
          const body = asText(config.body).trim();
          if (!body) refuse('Send message has no text to send');
          if (body.length > MAX_MESSAGE_LENGTH) {
            refuse(
              `Send message: the text is ${body.length} characters; the limit is ${MAX_MESSAGE_LENGTH}`,
            );
          }

          // Everyone is resolved before anything is sent.
          const recipients = await resolveRecipients(
            { ...config, channel: channel as never, audience },
            ctx,
          );

          for (const recipient of recipients) {
            try {
              // Per-recipient key: a retry after a partial send skips the
              // ones that already went out.
              await deps.idempotency.runOnce(
                ctx.tenantId,
                `automation:${ctx.executionId}:${ctx.nodeId}:msg:${recipient.address}`,
                async () => {
                  const message = await deps.channels.sendMessage(
                    ctx.tenantId,
                    owner.id,
                    {
                      provider: channel as ChannelProviderType,
                      recipient: recipient.address,
                      body,
                      ...(recipient.contactId
                        ? { contactId: recipient.contactId }
                        : {}),
                    },
                  );
                  await deps.audit.record({
                    tenantId: ctx.tenantId,
                    action: 'automation.message.send',
                    subjectType: 'channel_message',
                    subjectId: message.id,
                    actorId: owner.id,
                    actorName:
                      [owner.firstName, owner.lastName]
                        .filter(Boolean)
                        .join(' ')
                        .trim() || owner.email,
                    origin: 'HUMAN',
                    channel: 'SYSTEM',
                    messageId: `automation:${ctx.executionId}:${ctx.nodeId}`,
                    summary: `Automation "${ctx.workflowName}" sent a ${channelLabel(channel)} message to ${audience === 'staff' ? 'staff' : 'a customer'} (${recipient.name})`,
                    after: { provider: channel, audience, body },
                  });
                  return { sent: true };
                },
              );
            } catch (err) {
              // Channel not connected or switched off: fixing it is the
              // owner's job, and a retry would get the same answer.
              if (err instanceof HttpException && err.getStatus() < 500) {
                refuse(
                  `${channelLabel(channel)} is not connected, so the message was not sent. Connect it under Settings → Channels.`,
                );
              }
              throw err;
            }
          }
          return {
            channel,
            audience,
            sent: recipients.map((recipient) => recipient.name),
          };
        },
      );
    },

    async executeStaffNotificationActivity(
      config: StaffNotificationActivityConfig,
      ctx: AutomationActionContext,
    ): Promise<StaffNotificationActivityResult> {
      return deps.tenantContext.runAsAutomation(
        ctx.tenantId,
        ctx.executionId,
        async () => {
          await resolveOwner(deps, ctx, 'notify staff');

          // The bell's title column holds 200 characters.
          const title = asText(config.title).trim().slice(0, 200);
          if (!title) refuse('Notify staff has no title');
          const body = asText(config.body).trim() || null;
          const rawLink = asText(config.link).trim();
          // Only a page inside the app: never somewhere else.
          if (rawLink && !/^\/(?!\/)/.test(rawLink)) {
            refuse(
              'Notify staff: the link must be a page in Kerf, such as /production',
            );
          }
          // Kerf already alerts people about some events itself. An alert
          // about the same record joins that one, so nobody is told twice.
          const builtIn =
            ctx.startedBy &&
            recordIdSchema.safeParse(ctx.startedBy.entityId).success
              ? new Map(Object.entries(BUILT_IN_ALERTS)).get(
                  ctx.startedBy.eventType,
                )
              : undefined;
          const input: NotificationInput = {
            type: builtIn?.type ?? 'AUTOMATION',
            title,
            body,
            link: rawLink || '/notifications',
            ...(builtIn && ctx.startedBy
              ? {
                  entityType: builtIn.entityType,
                  entityId: ctx.startedBy.entityId,
                }
              : {}),
          };

          return deps.idempotency.runOnce(
            ctx.tenantId,
            `automation:${ctx.executionId}:${ctx.nodeId}:notify`,
            async (): Promise<StaffNotificationActivityResult> => {
              if (config.audience === 'person') {
                const emails = splitList(config.to);
                if (emails.length === 0) {
                  refuse('Notify staff has nobody to notify');
                }
                if (emails.length > MAX_RECIPIENTS) {
                  refuse(
                    `Notify staff supports at most ${MAX_RECIPIENTS} people, got ${emails.length}`,
                  );
                }
                const users = await staffByEmail(
                  ctx.tenantId,
                  emails,
                  'Notify staff',
                );
                const notified = await deps.notifications.notifyUsers(
                  ctx.tenantId,
                  users.map((user) => user.id),
                  input,
                );
                return { notified };
              }
              const group = findNotifyGroup(config.group);
              if (!group) {
                refuse('Notify staff: choose who should be notified');
              }
              const notified = await deps.notifications.notifyHolders(
                ctx.tenantId,
                group.permission,
                input,
                { refresh: true },
              );
              return { notified };
            },
          );
        },
      );
    },

    /** Read-only: nothing is changed, so there is no audit row or once-only key. */
    async executeRecordLookupActivity(
      config: RecordLookupActivityConfig,
      ctx: AutomationActionContext,
    ): Promise<Row> {
      return deps.tenantContext.runAsAutomation(
        ctx.tenantId,
        ctx.executionId,
        async () => {
          const entity = asText(config.entity);
          const owner = await resolveOwner(deps, ctx, 'look up records');
          if (entity === 'summary') return dailySummary(ctx.tenantId, owner);

          // A test run starts from an invented record, which is not in the
          // database: hand back its invented details instead of failing.
          const invented = ctx.testRun ? lookupSampleForTest(config) : null;
          if (invented) return { ...invented, sampleRecord: true };

          const recordId = asText(config.recordId).trim();
          if (!recordIdSchema.safeParse(recordId).success) {
            refuse(
              `Look up ${entity === 'invoice' ? 'an' : 'a'} ${entity}: "${recordId}" is not a valid record ID`,
            );
          }
          if (entity === 'quote') {
            requirePermission(owner, PERMISSIONS.QUOTE_READ, 'view quotes');
            return quoteLookup(ctx.tenantId, recordId);
          }
          if (entity === 'proof') {
            requirePermission(owner, PERMISSIONS.QUOTE_READ, 'view quotes');
            return proofLookup(ctx.tenantId, recordId);
          }
          if (entity === 'invoice') {
            requirePermission(owner, PERMISSIONS.INVOICE_READ, 'view invoices');
            return invoiceLookup(ctx.tenantId, recordId);
          }
          return refuse(`The Kerf record step cannot look up "${entity}"`);
        },
      );
    },
  };
}
