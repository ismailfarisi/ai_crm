import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  calculateQuoteTotals,
  CreateQuotePayload,
  PERMISSIONS,
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
  ): Promise<{ items: QuoteLineItem[]; violations: GuardrailViolation[] }> {
    const { items: recosted, violations, staleLineIds } =
      await this.costingService.recostLines(tenantId, items);

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
      ? (await this.rbacService.resolveAccess(actorUserId, tenantId)).permissions
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
    const { items } = await this.recost(tenantId, payload.items || []);
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
    if (payload.status !== undefined) {
      quote.status = payload.status as QuoteStatus;
    }
    if (payload.items !== undefined) {
      const { items } = await this.recost(tenantId, payload.items);
      quote.items = items;
      const totals = calculateQuoteTotals(items);
      quote.subtotalAmount = totals.subtotalAmount;
      quote.discountAmount = totals.discountAmount;
      quote.taxAmount = totals.taxAmount;
      quote.totalAmount = totals.totalAmount;
    }

    return await this.quoteRepository.save(quote);
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
      const { items, violations } = await this.recost(tenantId, quote.items || []);
      quote.items = items;
      const totals = calculateQuoteTotals(items);
      quote.subtotalAmount = totals.subtotalAmount;
      quote.discountAmount = totals.discountAmount;
      quote.taxAmount = totals.taxAmount;
      quote.totalAmount = totals.totalAmount;

      await this.assertActorMayApprove(tenantId, actorUserId, violations);
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

    // Guarantees an invoice exists even if Temporal never picks up the
    // signal, or hasn't finished `generateInvoiceActivity` by the time this
    // request returns. `createFromQuote` is idempotent so whichever path
    // gets there first wins.
    if (savedQuote.status === QuoteStatus.APPROVED) {
      try {
        const { invoice, isNew } = await this.invoicesService.createFromQuote(
          tenantId,
          savedQuote,
        );
        if (isNew) {
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
  ): Promise<{ violations: GuardrailViolation[]; totals: ReturnType<typeof calculateQuoteTotals> }> {
    const quote = await this.findQuoteById(tenantId, quoteId);
    const { items, violations } = await this.recost(tenantId, quote.items || []);
    return { violations, totals: calculateQuoteTotals(items) };
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
    return this.invoiceRepository.find({
      where: { tenantId },
      order: { issuedAt: 'DESC' },
    });
  }
}
