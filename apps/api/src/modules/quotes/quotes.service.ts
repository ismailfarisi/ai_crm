import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, Repository } from 'typeorm';
import { CrmEventBusService } from '@/common/events';
import {
  calculateQuoteTotals,
  CreateQuotePayload,
  DEFAULT_DOCUMENT_TEMPLATE_CONFIG,
  formatOrganizationAddress,
  PERMISSIONS,
  quoteDocumentTaxes,
  UniversalDocumentData,
  validateBillingSchedule,
  type BillingStage,
  UpdateQuotePayload,
  type GuardrailViolation,
  type Permission,
  type QuoteLineItem,
} from '@saas/shared';
import { Quote, QuoteCreatedBy, QuoteStatus } from './entities/quote.entity';
import { Invoice } from './entities/invoice.entity';
import { Organization } from '../organizations/entities/organization.entity';
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
import { DocumentTemplatesService } from '../document-templates/document-templates.service';
import { DocumentPdfRendererService } from '../document-templates/document-pdf-renderer.service';
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
    @InjectRepository(Organization)
    private readonly organizationRepository?: Repository<Organization>,
    private readonly documentTemplatesService?: DocumentTemplatesService,
    private readonly pdfRenderer?: DocumentPdfRendererService,
    @Optional()
    private readonly eventBus?: CrmEventBusService,
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
    automated = false,
  ): Promise<void> {
    if (!violations.length) return;

    // No actor, or an automation acting as its owner, is an automated path.
    // A bot must never be the thing that waives a margin floor — not even
    // one whose owner could.
    const permissions: Permission[] =
      actorUserId && !automated
        ? (await this.rbacService.resolveAccess(actorUserId, tenantId))
            .permissions
        : [];

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

  /**
   * The quote number always comes from the tenant sequence. A number in the
   * payload is ignored: the editor posts back the number it *previewed*,
   * which another user may have taken since, and a hand-typed number can
   * collide with one the sequence hands out later. `uq_quotes_tenant_number`
   * backs this up; a collision with an old hand-typed number moves on to the
   * next value instead of failing the request.
   */
  async createQuote(
    tenantId: string,
    payload: CreateQuotePayload,
  ): Promise<Quote> {
    const { items } = await this.recost(
      tenantId,
      payload.items || [],
      payload.customerId || null,
    );
    const totals = calculateQuoteTotals(items);
    const mode = payload.createdBy || QuoteCreatedBy.HUMAN;

    const fields = {
      tenantId,
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
      // Set below, and only once a workflow is actually running.
      workflowId: null,
    };

    let savedQuote: Quote | undefined;
    for (let attempt = 1; !savedQuote; attempt++) {
      const quoteNumber = await this.generateNextQuoteNumber(tenantId);
      try {
        // The created event is written with the quote, so it commits with it.
        // Its snapshot predates the Temporal start, so `workflowId` is null.
        savedQuote = await this.quoteRepository.manager.transaction(
          async (manager) => {
            const repo = manager.getRepository(Quote);
            const row = await repo.save(
              repo.create({ ...fields, quoteNumber }),
            );
            await this.eventBus?.publish(
              {
                tenantId,
                eventType: 'record.created',
                entityType: 'core',
                entityName: 'quote',
                entityId: row.id,
                actorUserId: (payload as any)?.actorUserId ?? null,
                timestamp: new Date().toISOString(),
                snapshot: {
                  before: null,
                  after: row,
                  changedFields: Object.keys(row ?? {}),
                },
              },
              { manager },
            );
            return row;
          },
        );
      } catch (err) {
        if (
          attempt < MAX_NUMBER_ATTEMPTS &&
          isUniqueViolation(err, 'uq_quotes_tenant_number')
        ) {
          this.logger.warn(
            `${quoteNumber} is already in use for tenant ${tenantId}; allocating the next number`,
          );
          continue;
        }
        throw err;
      }
    }

    const workflowId = `quote-${savedQuote.id}`;
    let started: string | null = null;
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
      started = handle.workflowId;
    } catch (err: unknown) {
      // Not fatal: approval provisions the order itself. But the row must
      // not name a workflow that is not running.
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Temporal workflow start deferred/failed: ${msg}`);
    }
    if (started) {
      await this.quoteRepository.update(
        { id: savedQuote.id, tenantId },
        { workflowId: started },
      );
    }
    return { ...savedQuote, workflowId: started } as Quote;
  }

  /**
   * Edits a quote under a row lock.
   *
   * The checks below — superseded, accepted, approved — are made against the
   * row as it is, not as the editor last loaded it. The customer can accept
   * while a rep has the editor open; saving the rep's copy used to write
   * `accepted_at` back to NULL. With the lock, a concurrent acceptance either
   * commits first (and is seen here) or waits for this edit (and is refused
   * if the edit killed its link).
   */
  async updateQuote(
    tenantId: string,
    id: string,
    payload: UpdateQuotePayload,
  ): Promise<Quote> {
    const { saved, beforeSnapshot, submittedForApproval } =
      await this.quoteRepository.manager.transaction(async (manager) => {
        const repo = manager.getRepository(Quote);
        const quote = await lockQuote(manager, tenantId, id);
        const beforeSnapshot = { ...quote };

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

        const nextStatus = payload.status as QuoteStatus | undefined;
        if (nextStatus !== undefined && nextStatus !== quote.status) {
          // Approval provisions the order and raises invoices; rejection
          // tells the workflow. Setting either directly would skip that.
          if (
            nextStatus === QuoteStatus.APPROVED ||
            nextStatus === QuoteStatus.REJECTED
          ) {
            throw new BadRequestException(
              `Use approve or reject to mark ${quote.quoteNumber ?? 'a quote'} ${nextStatus.toLowerCase()}`,
            );
          }
          if (quote.status === QuoteStatus.APPROVED) {
            throw new BadRequestException(
              `${quote.quoteNumber ?? 'This quote'} is approved. Create a revision to change it.`,
            );
          }
        }

        if (commercialChange) {
          quote.acceptanceTokenHash = null;
          quote.acceptanceExpiresAt = null;
        }

        if (payload.billingSchedule !== undefined) {
          if (await this.orderExists(quote.id, manager)) {
            throw new BadRequestException(
              'This quote already has a sales order; change billing on the order instead',
            );
          }
          quote.billingSchedule = normaliseSchedule(payload.billingSchedule);
        }

        if (payload.title !== undefined) {
          quote.title = payload.title;
        }
        // `payload.quoteNumber` is deliberately ignored: a document number is
        // allocated once, from the tenant sequence, and never edited.
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
          nextStatus === QuoteStatus.AWAITING_APPROVAL &&
          quote.status !== QuoteStatus.AWAITING_APPROVAL;
        if (nextStatus !== undefined) {
          quote.status = nextStatus;
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

        // Safe as a whole-entity save: `quote` was read under the lock in
        // this transaction, so every column it writes back is current.
        const saved = await repo.save(quote);

        // Written in this transaction: the event commits with the change.
        if (this.eventBus) {
          const afterSnapshot = { ...saved };
          await this.eventBus.publish(
            {
              tenantId,
              eventType: 'record.updated',
              entityType: 'core',
              entityName: 'quote',
              entityId: saved.id,
              actorUserId: (payload as any)?.actorUserId ?? null,
              timestamp: new Date().toISOString(),
              snapshot: {
                before: beforeSnapshot,
                after: afterSnapshot,
                changedFields: this.eventBus.computeChangedFields(
                  beforeSnapshot,
                  afterSnapshot,
                ),
              },
            },
            { manager },
          );
        }
        return { saved, beforeSnapshot, submittedForApproval };
      });

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

  /**
   * Approves or rejects a quote, or passes an override to its workflow.
   *
   * Approval and rejection are decided in one transaction on the locked quote
   * row: its status and `superseded_at` are checked as they are now, only the
   * columns the decision owns are written (a whole-entity save could write a
   * concurrent revision's `superseded_at` back to NULL), and an approval
   * creates the sales order in the same transaction — so a quote is never
   * approved without its order, and an approve and a reject cannot both win.
   *
   * Temporal hears about the decision only after it has committed. Its
   * `generateInvoiceActivity` runs the same idempotent provisioning and finds
   * the order already there. A signal that fails is logged, not fatal: the
   * decision is on record and the order exists either way.
   */
  async sendSignal(
    tenantId: string,
    quoteId: string,
    action: 'APPROVE' | 'REJECT' | 'OVERRIDE',
    payload?: any,
    actorUserId?: string,
    options: { automated?: boolean } = {},
  ): Promise<Quote> {
    if (action !== 'APPROVE' && action !== 'REJECT' && action !== 'OVERRIDE') {
      throw new BadRequestException(`Invalid signal action: ${action}`);
    }

    if (action === 'OVERRIDE') {
      const quote = await this.findQuoteById(tenantId, quoteId);
      await this.signalWorkflow(quote, action, payload);
      return quote;
    }

    const { quote, decided, invoicesRaised } =
      await this.quoteRepository.manager.transaction(async (manager) => {
        const repo = manager.getRepository(Quote);
        const quote = await lockQuote(manager, tenantId, quoteId);
        const name = quote.quoteNumber ?? 'This quote';

        if (quote.supersededAt) {
          throw new BadRequestException(
            `${name} has been replaced by a newer revision and cannot be ${action === 'APPROVE' ? 'approved' : 'rejected'}`,
          );
        }

        if (action === 'REJECT') {
          if (quote.status === QuoteStatus.APPROVED) {
            throw new BadRequestException(
              `${name} is already approved and has a sales order. Cancel the order instead.`,
            );
          }
          if (quote.status === QuoteStatus.REJECTED) {
            return { quote, decided: false, invoicesRaised: [] as Invoice[] };
          }
          await repo.update(
            { id: quote.id, tenantId },
            { status: QuoteStatus.REJECTED },
          );
          quote.status = QuoteStatus.REJECTED;
          return { quote, decided: true, invoicesRaised: [] as Invoice[] };
        }

        if (quote.status === QuoteStatus.REJECTED) {
          throw new BadRequestException(
            `${name} was rejected. Resubmit it for approval first.`,
          );
        }
        if (quote.status === QuoteStatus.APPROVED) {
          // Already decided; nothing is re-costed or re-signalled. Provisioning
          // is idempotent, so this only fills in an order that is missing.
          const { invoicesRaised } = await this.invoicesService.createFromQuote(
            tenantId,
            quote,
            manager,
          );
          return { quote, decided: false, invoicesRaised };
        }

        // Approval is the commitment, so it is where the floors bite. Saving a
        // thin draft stays possible — the rep needs to see the number before
        // they can fix it. Re-cost from the catalog first so the check runs on
        // what the job actually costs today, not on what was stored when it
        // was drafted.
        const { items, violations } = await this.recost(
          tenantId,
          quote.items || [],
          quote.customerId,
        );
        const totals = calculateQuoteTotals(items);
        await this.assertActorMayApprove(
          tenantId,
          actorUserId,
          violations,
          options.automated,
        );

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
        // now, so a missing rate refuses the approval outright.
        await fxRateFor(manager, tenantId, quote.currency, new Date());

        const decision = {
          items,
          subtotalAmount: totals.subtotalAmount,
          discountAmount: totals.discountAmount,
          taxAmount: totals.taxAmount,
          totalAmount: totals.totalAmount,
          status: QuoteStatus.APPROVED,
        };
        await repo.update({ id: quote.id, tenantId }, decision);
        Object.assign(quote, decision);

        // Same transaction: if the order cannot be created, the approval
        // rolls back with it.
        const { invoicesRaised } = await this.invoicesService.createFromQuote(
          tenantId,
          quote,
          manager,
        );
        return { quote, decided: true, invoicesRaised };
      });

    if (decided) {
      await this.signalWorkflow(quote, action, payload);
      // Decided: nobody else needs to be asked.
      await this.notifications.resolve(tenantId, quote.id);
    }

    for (const invoice of invoicesRaised) {
      try {
        await this.automationEventBridgeService.handleCrmEvent({
          tenantId,
          eventType: 'invoice.issued',
          entityId: invoice.id,
          data: {
            invoiceId: invoice.id,
            invoiceNumber: invoice.invoiceNumber,
            quoteId: quote.id,
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

    return quote;
  }

  /** Best-effort: the decision is already committed by the time this runs. */
  private async signalWorkflow(
    quote: Quote,
    action: 'APPROVE' | 'REJECT' | 'OVERRIDE',
    payload?: any,
  ): Promise<void> {
    const workflowId = quote.workflowId || `quote-${quote.id}`;
    try {
      const handle = this.temporalService
        .getClient()
        .workflow.getHandle(workflowId);
      switch (action) {
        case 'APPROVE':
          await handle.signal(approveQuoteSignal);
          break;
        case 'REJECT':
          await handle.signal(
            rejectQuoteSignal,
            typeof payload === 'string' ? payload : payload?.reason || '',
          );
          break;
        case 'OVERRIDE':
          await handle.signal(manualOverrideSignal, payload);
          break;
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `Failed to send signal to workflow ${workflowId}: ${msg}`,
      );
    }
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
        return repo.save(revision);
      })
      .then(async (saved) => {
        // Outside the transaction: a workflow that starts for a revision that
        // then rolls back would wait for a signal forever.
        await this.startWorkflow(saved);
        return saved;
      });
  }

  /** Records the workflow id only once the workflow is actually running. */
  private async startWorkflow(quote: Quote): Promise<void> {
    let started: string;
    try {
      const handle = await this.temporalService
        .getClient()
        .workflow.start(quoteWorkflow, {
          taskQueue: 'quotes-queue',
          workflowId: `quote-${quote.id}`,
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
      started = handle.workflowId;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Temporal workflow start deferred/failed: ${msg}`);
      return;
    }
    await this.quoteRepository.update(
      { id: quote.id, tenantId: quote.tenantId },
      { workflowId: started },
    );
    quote.workflowId = started;
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

  async getPdf(
    tenantId: string,
    id: string,
  ): Promise<{ buffer: Buffer; filename: string }> {
    const quote = await this.findQuoteById(tenantId, id);
    const organization = await this.organizationRepository?.findOne({
      where: { id: tenantId },
    });
    const template =
      await this.documentTemplatesService?.resolveForDocumentType(
        tenantId,
        'QUOTE',
      );

    const address = organization
      ? formatOrganizationAddress(organization).join(', ') || undefined
      : undefined;

    const logoUrl =
      organization?.logoData && organization?.logoContentType
        ? `data:${organization.logoContentType};base64,${organization.logoData.toString('base64')}`
        : undefined;

    const docData: UniversalDocumentData = {
      type: 'QUOTE',
      number: quote.quoteNumber || quote.id,
      status: quote.status,
      issuedAt: quote.createdAt,
      validUntil: quote.validUntil || undefined,
      currency: quote.currency || 'USD',
      organization: {
        name: organization?.name || 'Your Company',
        address,
        taxId: organization?.taxId || undefined,
        phone: organization?.phone || undefined,
        email: organization?.email || undefined,
        website: organization?.website || undefined,
        logoUrl,
      },
      party: {
        name: quote.customerName || 'Customer',
        email: quote.customerEmail || undefined,
      },
      items: (quote.items || []).map((item) => ({
        code: (item as any).sku || (item as any).code || undefined,
        description: item.description || '',
        quantity: item.quantity != null ? Number(item.quantity) : undefined,
        unitPrice: item.unitPrice != null ? Number(item.unitPrice) : undefined,
        discount: item.discount != null ? Number(item.discount) : undefined,
        taxRate: item.taxRate != null ? Number(item.taxRate) : undefined,
        amount:
          item.subtotal != null
            ? Number(item.subtotal)
            : item.quantity != null && item.unitPrice != null
              ? Number(item.quantity) * Number(item.unitPrice)
              : undefined,
      })),
      totals: {
        subtotal: Number(quote.subtotalAmount || 0),
        discounts: Number(quote.discountAmount || 0),
        taxes: quoteDocumentTaxes(
          quote.items,
          Number(quote.taxAmount || 0),
        ),
        total: Number(quote.totalAmount || 0),
      },
      notes:
        [quote.notes, quote.termsAndConditions].filter(Boolean).join('\n\n') ||
        undefined,
      paymentTerms: quote.paymentTerms || undefined,
    };

    const config = template?.config ?? DEFAULT_DOCUMENT_TEMPLATE_CONFIG;
    const buffer = this.pdfRenderer
      ? await this.pdfRenderer.render(docData, config)
      : Buffer.from('');

    return {
      buffer,
      filename: `${quote.quoteNumber || `quote-${quote.id}`}.pdf`,
    };
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
    const quoteIds = [
      ...new Set(invoices.map((i) => i.quoteId).filter(Boolean)),
    ];
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

/** How many sequence values createQuote tries before giving up on a clash. */
const MAX_NUMBER_ATTEMPTS = 5;

/** Reads a quote `FOR UPDATE` inside the caller's transaction. */
async function lockQuote(
  manager: EntityManager,
  tenantId: string,
  id: string,
): Promise<Quote> {
  const quote = await manager
    .getRepository(Quote)
    .createQueryBuilder('q')
    .setLock('pessimistic_write')
    .where('q.id = :id', { id })
    .andWhere('q.tenant_id = :tenantId', { tenantId })
    .getOne();
  if (!quote) throw new NotFoundException(`Quote with ID ${id} not found`);
  return quote;
}

/** A Postgres unique violation, optionally on one named constraint/index. */
function isUniqueViolation(err: unknown, constraint?: string): boolean {
  const e = err as {
    code?: string;
    constraint?: string;
    driverError?: { code?: string; constraint?: string };
  };
  const code = e?.code ?? e?.driverError?.code;
  const name = e?.constraint ?? e?.driverError?.constraint;
  return code === '23505' && (!constraint || name === constraint);
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
