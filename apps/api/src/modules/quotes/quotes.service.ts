import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import {
  calculateQuoteTotals,
  CreateQuotePayload,
  PERMISSIONS,
  validateBillingSchedule,
  type BillingStage,
  UpdateQuotePayload,
  type GuardrailViolation,
  type Permission,
  type QuoteLineItem,
} from '@saas/shared';
import { Quote, QuoteCreatedBy, QuoteStatus } from './entities/quote.entity';
import { Invoice } from './entities/invoice.entity';
import { InvoicesService } from './invoices.service';
import { TemporalService } from '../temporal/temporal.service';
import { quoteWorkflow } from './workflows/quote.workflow';
import {
  approveQuoteSignal,
  manualOverrideSignal,
  rejectQuoteSignal,
} from './workflows/interfaces';
import { AutomationEventBridgeService } from '../automations/services/automation-event-bridge.service';
import { CostingService } from '../catalog/costing.service';
import { RbacService } from '../rbac/rbac.service';
import { TaxService } from '../tax/tax.service';
import { fxRateFor } from '../finance/fx';
import { NotificationsService } from '../notifications/notifications.service';
import {
  allocateNextSequenceValue,
  formatSequenceNumber,
  peekNextSequenceValue,
} from '../../database/tenant-sequence.util';

@Injectable()
export class QuotesService {
  private readonly logger = new Logger(QuotesService.name);

  constructor(
    @InjectRepository(Quote)
    private readonly quoteRepository: Repository<Quote>,
    @InjectRepository(Invoice)
    private readonly invoiceRepository: Repository<Invoice>,
    private readonly temporalService: TemporalService,
    private readonly invoicesService: InvoicesService,
    private readonly automationEventBridgeService: AutomationEventBridgeService,
    private readonly costingService: CostingService,
    private readonly rbacService: RbacService,
    private readonly taxService: TaxService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Re-prices every line from the catalog and checks the tenant's floors.
   *
   * Called on the way in for both create and update, so a client-supplied
   * `cost` never reaches the database. The browser can send whatever it likes;
   * only what the catalog says survives.
   */
  private async recost(
    tenantId: string,
    items: QuoteLineItem[],
    customerId: string | null,
  ): Promise<{ items: QuoteLineItem[]; violations: GuardrailViolation[] }> {
    const {
      items: costed,
      violations,
      staleLineIds,
    } = await this.costingService.recostLines(tenantId, items);
    // Tax after cost: the customer's address picks the code, and the rate on
    // each line follows it. Margin is on the untaxed subtotal, so the
    // violations computed above do not change.
    const recosted = await this.taxService.applyToLines(
      tenantId,
      costed,
      customerId,
    );

    if (staleLineIds.length) {
      this.logger.warn(
        `Quote lines no longer cost against the catalog and were marked manual: ${staleLineIds.join(', ')}`,
      );
    }

    return { items: recosted, violations };
  }

  /**
   * Enforced here rather than in the controller, and against the actor's own
   * effective permissions rather than their role — the same reasoning as
   * `assertActorCanGrant`. A role-level check would sweep in anyone senior
   * enough to *look* like an approver without actually holding the override.
   */
  private async assertActorMayApprove(
    tenantId: string,
    actorUserId: string | undefined,
    violations: GuardrailViolation[],
  ): Promise<void> {
    if (!violations.length) return;

    const permissions: Permission[] = actorUserId
      ? (await this.rbacService.resolveAccess(actorUserId, tenantId))
          .permissions
      : // No actor means an automated path. A bot must never be the thing
        // that waives a margin floor.
        [];

    if (permissions.includes(PERMISSIONS.QUOTE_APPROVE_BELOW_MARGIN)) return;

    throw new ForbiddenException({
      statusCode: 403,
      error: 'Forbidden',
      message:
        violations.length === 1
          ? violations[0].message
          : `This quote breaks ${violations.length} commercial rules`,
      violations,
    });
  }

  /** Non-mutating preview for the "new quote" UI — must not burn a sequence value. */
  async peekNextQuoteNumber(tenantId: string): Promise<string> {
    const value = await peekNextSequenceValue(
      this.quoteRepository.manager,
      tenantId,
      'quote_number',
    );
    return formatSequenceNumber('QT', value);
  }

  /** Atomically allocates the next quote number — call only when actually creating a quote. */
  async generateNextQuoteNumber(tenantId: string): Promise<string> {
    const value = await allocateNextSequenceValue(
      this.quoteRepository.manager,
      tenantId,
      'quote_number',
    );
    return formatSequenceNumber('QT', value);
  }

  async createQuote(
    tenantId: string,
    payload: CreateQuotePayload,
  ): Promise<Quote> {
    const quoteNumber =
      payload.quoteNumber || (await this.generateNextQuoteNumber(tenantId));
    const { items } = await this.recost(
      tenantId,
      payload.items || [],
      payload.customerId || null,
    );
    const totals = calculateQuoteTotals(items);
    const mode = payload.createdBy || QuoteCreatedBy.HUMAN;

    const quote = this.quoteRepository.create({
      tenantId,
      quoteNumber,
      customerId: payload.customerId || null,
      customerName: payload.customerName || 'General Customer',
      customerEmail: payload.customerEmail || null,
      createdBy: mode as QuoteCreatedBy,
      title: payload.title || 'Untitled Quote',
      validUntil: payload.validUntil ? new Date(payload.validUntil) : null,
      paymentTerms: payload.paymentTerms || 'immediate',
      currency: payload.currency || 'USD',
      prompt: payload.prompt || null,
      items,
      subtotalAmount: totals.subtotalAmount,
      discountAmount: totals.discountAmount,
      taxAmount: totals.taxAmount,
      totalAmount: totals.totalAmount,
      termsAndConditions: payload.termsAndConditions || null,
      notes: payload.notes || null,
      billingSchedule: normaliseSchedule(payload.billingSchedule),
      status: QuoteStatus.DRAFT,
    });

    const savedQuote = await this.quoteRepository.save(quote);
    const workflowId = `quote-${savedQuote.id}`;

    try {
      const client = this.temporalService.getClient();
      const handle = await client.workflow.start(quoteWorkflow, {
        taskQueue: 'quotes-queue',
        workflowId,
        args: [
          {
            quoteId: savedQuote.id,
            tenantId,
            mode: (mode as string) === 'AI' ? 'AI' : 'HUMAN',
            prompt: savedQuote.prompt ?? undefined,
            title: savedQuote.title,
            items: savedQuote.items,
            totalAmount: Number(savedQuote.totalAmount),
          },
        ],
      });
      savedQuote.workflowId = handle.workflowId;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Temporal workflow start deferred/failed: ${msg}`);
      savedQuote.workflowId = workflowId;
    }

    return await this.quoteRepository.save(savedQuote);
  }

  async updateQuote(
    tenantId: string,
    id: string,
    payload: UpdateQuotePayload,
  ): Promise<Quote> {
    const quote = await this.findQuoteById(tenantId, id);

    if (quote.supersededAt) {
      throw new BadRequestException(
        `${quote.quoteNumber ?? 'This quote'} has been replaced by version ${quote.version + 1}. Edit the latest version instead.`,
      );
    }
    // What the customer agrees to. Once they have accepted, changing it would
    // leave an acceptance on record for terms they never saw; before that, a
    // change kills the outstanding link so they cannot accept the old terms.
    const commercialChange = changesCommercialTerms(quote, payload);
    if (commercialChange && quote.acceptedAt) {
      throw new BadRequestException(
        `The customer accepted ${quote.quoteNumber ?? 'this quote'} as it stands. Create a revision to change it.`,
      );
    }
    if (commercialChange) {
      quote.acceptanceTokenHash = null;
      quote.acceptanceExpiresAt = null;
    }

    if (payload.billingSchedule !== undefined) {
      if (await this.orderExists(quote.id)) {
        throw new BadRequestException(
          'This quote already has a sales order; change billing on the order instead',
        );
      }
      quote.billingSchedule = normaliseSchedule(payload.billingSchedule);
    }

    if (payload.title !== undefined) {
      quote.title = payload.title;
    }
    if (payload.quoteNumber !== undefined) {
      quote.quoteNumber = payload.quoteNumber;
    }
    if (payload.customerId !== undefined) {
      quote.customerId = payload.customerId;
    }
    if (payload.customerName !== undefined) {
      quote.customerName = payload.customerName;
    }
    if (payload.customerEmail !== undefined) {
      quote.customerEmail = payload.customerEmail;
    }
    if (payload.validUntil !== undefined) {
      quote.validUntil = payload.validUntil
        ? new Date(payload.validUntil)
        : null;
    }
    if (payload.paymentTerms !== undefined) {
      quote.paymentTerms = payload.paymentTerms;
    }
    if (payload.currency !== undefined) {
      quote.currency = payload.currency;
    }
    if (payload.termsAndConditions !== undefined) {
      quote.termsAndConditions = payload.termsAndConditions;
    }
    if (payload.notes !== undefined) {
      quote.notes = payload.notes;
    }
    if (payload.prompt !== undefined) {
      quote.prompt = payload.prompt;
    }
    const submittedForApproval =
      payload.status === QuoteStatus.AWAITING_APPROVAL &&
      quote.status !== QuoteStatus.AWAITING_APPROVAL;
    if (payload.status !== undefined) {
      quote.status = payload.status as QuoteStatus;
    }
    // A new customer can mean a new tax treatment, so the lines are re-taxed
    // even when the items themselves were not sent.
    if (payload.items !== undefined || payload.customerId !== undefined) {
      const { items } = await this.recost(
        tenantId,
        payload.items ?? quote.items ?? [],
        quote.customerId,
      );
      quote.items = items;
      const totals = calculateQuoteTotals(items);
      quote.subtotalAmount = totals.subtotalAmount;
      quote.discountAmount = totals.discountAmount;
      quote.taxAmount = totals.taxAmount;
      quote.totalAmount = totals.totalAmount;
    }

    const saved = await this.quoteRepository.save(quote);
    if (submittedForApproval) {
      await this.notifications.notifyHolders(
        tenantId,
        PERMISSIONS.QUOTE_APPROVE,
        {
          type: 'QUOTE_AWAITING_APPROVAL',
          title: `${saved.quoteNumber ?? 'A quote'} is waiting for approval`,
          body: `${saved.customerName} · ${Number(saved.totalAmount).toFixed(2)} ${saved.currency}`,
          link: `/quotes/${saved.id}`,
          entityType: 'QUOTE',
          entityId: saved.id,
        },
      );
    }
    return saved;
  }

  async sendSignal(
    tenantId: string,
    quoteId: string,
    action: 'APPROVE' | 'REJECT' | 'OVERRIDE',
    payload?: any,
    actorUserId?: string,
  ): Promise<Quote> {
    const quote = await this.findQuoteById(tenantId, quoteId);
    const workflowId = quote.workflowId || `quote-${quote.id}`;

    if (action !== 'APPROVE' && action !== 'REJECT' && action !== 'OVERRIDE') {
      throw new BadRequestException(`Invalid signal action: ${action}`);
    }

    // Approval is the commitment, so it is where the floors bite. Saving a
    // thin draft stays possible — the rep needs to see the number before they
    // can fix it. Re-cost from the catalog first so the check runs on what
    // the job actually costs today, not on what was stored when it was drafted.
    if (action === 'APPROVE') {
      const { items, violations } = await this.recost(
        tenantId,
        quote.items || [],
        quote.customerId,
      );
      quote.items = items;
      const totals = calculateQuoteTotals(items);
      quote.subtotalAmount = totals.subtotalAmount;
      quote.discountAmount = totals.discountAmount;
      quote.taxAmount = totals.taxAmount;
      quote.totalAmount = totals.totalAmount;

      await this.assertActorMayApprove(tenantId, actorUserId, violations);

      if (quote.supersededAt) {
        throw new BadRequestException(
          `${quote.quoteNumber ?? 'This quote'} has been replaced by a newer revision and cannot be approved`,
        );
      }
      // Checked here, before anything is committed, so a bad schedule is a
      // clear refusal rather than an approved quote with no order behind it.
      const problems = quote.billingSchedule?.length
        ? validateBillingSchedule(quote.billingSchedule)
        : [];
      if (problems.length) {
        throw new BadRequestException(
          `Fix the billing schedule before approving: ${problems.join(' ')}`,
        );
      }

      // The invoice this approval raises is booked at today's rate. Checked
      // now, so a missing rate refuses the approval instead of approving a
      // quote whose invoice then silently fails to appear.
      await fxRateFor(
        this.quoteRepository.manager,
        tenantId,
        quote.currency,
        new Date(),
      );

      // Persist the re-costed lines before signalling. The Temporal activity
      // builds the order from the stored quote, and can run before this
      // request finishes; it must not see the pre-recost totals.
      await this.quoteRepository.save(quote);
    }

    try {
      const client = this.temporalService.getClient();
      const handle = client.workflow.getHandle(workflowId);

      switch (action) {
        case 'APPROVE':
          await handle.signal(approveQuoteSignal);
          quote.status = QuoteStatus.APPROVED;
          break;
        case 'REJECT':
          await handle.signal(
            rejectQuoteSignal,
            typeof payload === 'string' ? payload : payload?.reason || '',
          );
          quote.status = QuoteStatus.REJECTED;
          break;
        case 'OVERRIDE':
          await handle.signal(manualOverrideSignal, payload);
          break;
      }
    } catch (err: unknown) {
      if (err instanceof BadRequestException) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `Failed to send signal to workflow ${workflowId}: ${msg}`,
      );
      if (action === 'APPROVE') {
        quote.status = QuoteStatus.APPROVED;
      } else if (action === 'REJECT') {
        quote.status = QuoteStatus.REJECTED;
      }
    }

    const savedQuote = await this.quoteRepository.save(quote);
    if (
      savedQuote.status === QuoteStatus.APPROVED ||
      savedQuote.status === QuoteStatus.REJECTED
    ) {
      // Decided: nobody else needs to be asked.
      await this.notifications.resolve(tenantId, savedQuote.id);
    }

    // Guarantees the order (and whatever its schedule invoices on approval)
    // exists even if Temporal never picks up the signal, or hasn't finished
    // `generateInvoiceActivity` by the time this request returns. Both run
    // the same idempotent provisioning, so whichever gets there first wins.
    if (savedQuote.status === QuoteStatus.APPROVED) {
      try {
        const { invoicesRaised } = await this.invoicesService.createFromQuote(
          tenantId,
          savedQuote,
        );
        for (const invoice of invoicesRaised) {
          try {
            await this.automationEventBridgeService.handleCrmEvent({
              tenantId,
              eventType: 'invoice.issued',
              entityId: invoice.id,
              data: {
                invoiceId: invoice.id,
                invoiceNumber: invoice.invoiceNumber,
                quoteId: savedQuote.id,
                amount: invoice.amount,
                dueDate: invoice.dueDate,
                customerId: invoice.customerId,
                customerEmail: invoice.customerEmail,
              },
            });
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            this.logger.warn(
              `Failed to emit invoice.issued for invoice ${invoice.id}: ${msg}`,
            );
          }
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(
          `Failed to create invoice for quote ${quoteId}: ${msg}`,
        );
      }
    }

    return savedQuote;
  }

  /**
   * What the approve button should say before it is pressed: the quote's
   * margin as the catalog prices it today, and anything blocking approval.
   */
  async evaluateQuote(
    tenantId: string,
    quoteId: string,
  ): Promise<{
    violations: GuardrailViolation[];
    totals: ReturnType<typeof calculateQuoteTotals>;
  }> {
    const quote = await this.findQuoteById(tenantId, quoteId);
    const { items, violations } = await this.recost(
      tenantId,
      quote.items || [],
      quote.customerId,
    );
    return { violations, totals: calculateQuoteTotals(items) };
  }

  /**
   * Creates the next version of a quote for a customer who wants changes.
   *
   * The original is kept, marked superseded, and its acceptance link stops
   * working — a customer must never be able to accept terms that have since
   * been replaced. Refused once an order exists: at that point the deal is
   * done and a change is a change to the order, not a new quote.
   */
  async reviseQuote(tenantId: string, id: string): Promise<Quote> {
    return this.quoteRepository.manager
      .transaction(async (manager) => {
        const repo = manager.getRepository(Quote);
        const original = await repo
          .createQueryBuilder('q')
          .setLock('pessimistic_write')
          .where('q.id = :id', { id })
          .andWhere('q.tenant_id = :tenantId', { tenantId })
          .getOne();
        if (!original)
          throw new NotFoundException(`Quote with ID ${id} not found`);
        if (original.supersededAt) {
          throw new BadRequestException(
            `${original.quoteNumber ?? 'This quote'} has already been revised`,
          );
        }
        if (await this.orderExists(original.id, manager)) {
          throw new BadRequestException(
            `${original.quoteNumber ?? 'This quote'} already has a sales order and cannot be revised`,
          );
        }

        // The link keeps its hash so that opening it tells the customer this
        // version was replaced, rather than that the link is invalid. Acceptance
        // itself is refused on `superseded_at`, not on the token.
        original.supersededAt = new Date();
        await repo.update(
          { id: original.id },
          { supersededAt: original.supersededAt },
        );

        const baseNumber = (original.quoteNumber ?? '').replace(/-R\d+$/, '');
        const revision = repo.create({
          tenantId,
          quoteNumber: baseNumber ? `${baseNumber}-R${original.version}` : null,
          customerId: original.customerId,
          customerName: original.customerName,
          customerEmail: original.customerEmail,
          createdBy: QuoteCreatedBy.HUMAN,
          title: original.title,
          validUntil: original.validUntil,
          paymentTerms: original.paymentTerms,
          currency: original.currency,
          prompt: original.prompt,
          items: original.items,
          subtotalAmount: original.subtotalAmount,
          discountAmount: original.discountAmount,
          taxAmount: original.taxAmount,
          totalAmount: original.totalAmount,
          termsAndConditions: original.termsAndConditions,
          notes: original.notes,
          billingSchedule: original.billingSchedule,
          version: original.version + 1,
          parentQuoteId: original.id,
          status: QuoteStatus.DRAFT,
          workflowId: null,
        });
        const saved = await repo.save(revision);
        saved.workflowId = `quote-${saved.id}`;
        await repo.save(saved);
        return saved;
      })
      .then(async (saved) => {
        // Outside the transaction: a workflow that starts for a revision that
        // then rolls back would wait for a signal forever.
        await this.startWorkflow(saved);
        return saved;
      });
  }

  private async startWorkflow(quote: Quote): Promise<void> {
    try {
      await this.temporalService.getClient().workflow.start(quoteWorkflow, {
        taskQueue: 'quotes-queue',
        workflowId: quote.workflowId ?? `quote-${quote.id}`,
        args: [
          {
            quoteId: quote.id,
            tenantId: quote.tenantId,
            mode: 'HUMAN',
            title: quote.title,
            items: quote.items,
            totalAmount: Number(quote.totalAmount),
          },
        ],
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Temporal workflow start deferred/failed: ${msg}`);
    }
  }

  private async orderExists(
    quoteId: string,
    manager = this.quoteRepository.manager,
  ): Promise<boolean> {
    const rows: unknown[] = await manager.query(
      `SELECT 1 FROM "sales_orders" WHERE "quote_id" = $1 LIMIT 1`,
      [quoteId],
    );
    return rows.length > 0;
  }

  async findAllQuotes(tenantId: string): Promise<Quote[]> {
    return this.quoteRepository.find({
      where: { tenantId },
      order: { createdAt: 'DESC' },
    });
  }

  async findQuoteById(tenantId: string, id: string): Promise<Quote> {
    const quote = await this.quoteRepository.findOne({
      where: { id, tenantId },
    });

    if (!quote) {
      throw new NotFoundException(`Quote with ID ${id} not found`);
    }

    return quote;
  }

  async findAllInvoices(tenantId: string): Promise<Invoice[]> {
    const invoices = await this.invoiceRepository.find({
      where: { tenantId },
      order: { issuedAt: 'DESC' },
    });
    return this.withQuoteNumbers(tenantId, invoices);
  }

  /**
   * Fills in each invoice's `quoteNumber` from the quote it was raised off.
   *
   * One query for the whole page rather than a relation on the entity, which
   * would drag the quote's line items and cost model into every invoice list.
   */
  private async withQuoteNumbers(
    tenantId: string,
    invoices: Invoice[],
  ): Promise<Invoice[]> {
    const quoteIds = [...new Set(invoices.map((i) => i.quoteId).filter(Boolean))];
    if (quoteIds.length === 0) return invoices;

    const quotes = await this.quoteRepository.find({
      where: { tenantId, id: In(quoteIds) },
      select: { id: true, quoteNumber: true },
    });
    const numbers = new Map(quotes.map((q) => [q.id, q.quoteNumber]));

    for (const invoice of invoices) {
      invoice.quoteNumber = numbers.get(invoice.quoteId) ?? null;
    }
    return invoices;
  }
}

/**
 * Whether an update alters what the customer would be agreeing to.
 *
 * Compared by value, not by presence: the editor sends every field on every
 * save, and a save that changes nothing must not lock an accepted quote or
 * kill a link the customer is about to use. Cost is ignored — it is re-derived
 * from the catalog on every save and is never shown to the customer.
 */
export function changesCommercialTerms(
  quote: Quote,
  payload: UpdateQuotePayload,
): boolean {
  const differs = (next: unknown, current: unknown) =>
    next !== undefined &&
    JSON.stringify(next ?? null) !== JSON.stringify(current ?? null);
  const customerView = (items: QuoteLineItem[] | null | undefined) =>
    (items ?? []).map((item) => [
      item.type ?? 'product',
      item.description ?? '',
      Number(item.quantity) || 0,
      item.uom ?? null,
      Number(item.unitPrice) || 0,
      Number(item.discount) || 0,
      Number(item.taxRate) || 0,
    ]);
  const day = (value: string | Date | null | undefined) =>
    value ? new Date(value).toISOString().slice(0, 10) : null;

  return (
    (payload.items !== undefined &&
      differs(customerView(payload.items), customerView(quote.items))) ||
    (payload.billingSchedule !== undefined &&
      differs(
        normaliseScheduleForCompare(payload.billingSchedule),
        quote.billingSchedule,
      )) ||
    differs(payload.currency, quote.currency) ||
    differs(payload.paymentTerms, quote.paymentTerms) ||
    (payload.validUntil !== undefined &&
      day(payload.validUntil) !== day(quote.validUntil)) ||
    differs(payload.termsAndConditions, quote.termsAndConditions) ||
    differs(payload.customerId, quote.customerId) ||
    differs(payload.customerName, quote.customerName)
  );
}

function normaliseScheduleForCompare(
  stages: BillingStage[] | null | undefined,
): BillingStage[] | null {
  try {
    return normaliseSchedule(stages);
  } catch {
    // Invalid input is a change; the save itself will then refuse it.
    return [] as BillingStage[];
  }
}

/**
 * A schedule of exactly the default is stored as null, so "no schedule" has
 * one representation and old quotes and new ones read the same. Anything else
 * must be valid on the way in; approval checks again, since the request that
 * saved it may have come from an older client.
 */
function normaliseSchedule(
  stages: BillingStage[] | null | undefined,
): BillingStage[] | null {
  if (!stages || stages.length === 0) return null;
  const cleaned = stages.map((stage) => ({
    kind: stage.kind,
    label:
      String(stage.label ?? '')
        .trim()
        .slice(0, 120) || 'Stage',
    percent: Math.round(Number(stage.percent) * 1000) / 1000,
    trigger: (['ON_APPROVAL', 'MANUAL', 'ON_DELIVERY'] as const).includes(
      stage.trigger,
    )
      ? stage.trigger
      : 'MANUAL',
  })) as BillingStage[];

  const problems = validateBillingSchedule(cleaned);
  if (
    cleaned.some((s) => !['DEPOSIT', 'MILESTONE', 'FINAL'].includes(s.kind))
  ) {
    problems.push(
      'Each stage must be a deposit, a milestone or the final stage.',
    );
  }
  if (problems.length) {
    throw new BadRequestException(problems.join(' '));
  }
  if (
    cleaned.length === 1 &&
    cleaned[0].percent === 100 &&
    cleaned[0].trigger === 'ON_APPROVAL'
  ) {
    return null;
  }
  return cleaned;
}
