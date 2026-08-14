import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  calculateQuoteTotals,
  CreateQuotePayload,
  UpdateQuotePayload,
} from '@saas/shared';
import { Quote, QuoteCreatedBy, QuoteStatus } from './entities/quote.entity';
import { Invoice } from './entities/invoice.entity';
import { TemporalService } from '../temporal/temporal.service';
import { quoteWorkflow } from './workflows/quote.workflow';
import {
  approveQuoteSignal,
  manualOverrideSignal,
  rejectQuoteSignal,
} from './workflows/interfaces';

@Injectable()
export class QuotesService {
  private readonly logger = new Logger(QuotesService.name);

  constructor(
    @InjectRepository(Quote)
    private readonly quoteRepository: Repository<Quote>,
    @InjectRepository(Invoice)
    private readonly invoiceRepository: Repository<Invoice>,
    private readonly temporalService: TemporalService,
  ) {}

  async generateNextQuoteNumber(tenantId: string): Promise<string> {
    const count = await this.quoteRepository.count({ where: { tenantId } });
    const year = new Date().getFullYear();
    const seq = String(count + 1).padStart(4, '0');
    return `QT-${year}-${seq}`;
  }

  async createQuote(
    tenantId: string,
    payload: CreateQuotePayload,
  ): Promise<Quote> {
    const quoteNumber =
      payload.quoteNumber || (await this.generateNextQuoteNumber(tenantId));
    const items = payload.items || [];
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
      quote.validUntil = payload.validUntil ? new Date(payload.validUntil) : null;
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
      quote.items = payload.items;
      const totals = calculateQuoteTotals(payload.items);
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
  ): Promise<Quote> {
    const quote = await this.findQuoteById(tenantId, quoteId);
    const workflowId = quote.workflowId || `quote-${quote.id}`;

    if (action !== 'APPROVE' && action !== 'REJECT' && action !== 'OVERRIDE') {
      throw new BadRequestException(`Invalid signal action: ${action}`);
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
      this.logger.warn(`Failed to send signal to workflow ${workflowId}: ${msg}`);
      if (action === 'APPROVE') {
        quote.status = QuoteStatus.APPROVED;
      } else if (action === 'REJECT') {
        quote.status = QuoteStatus.REJECTED;
      }
    }

    return await this.quoteRepository.save(quote);
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
