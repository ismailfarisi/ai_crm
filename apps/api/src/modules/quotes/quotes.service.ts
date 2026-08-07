import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
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

  async createQuote(
    tenantId: string,
    createdBy?: QuoteCreatedBy,
    title?: string,
    prompt?: string,
    items?: any[],
    totalAmount?: number,
  ): Promise<Quote> {
    const mode = createdBy || QuoteCreatedBy.HUMAN;
    const quote = this.quoteRepository.create({
      tenantId,
      createdBy: mode,
      title: title || 'Untitled Quote',
      prompt,
      items: items || [],
      totalAmount: totalAmount || 0,
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
            mode: mode === QuoteCreatedBy.AI ? 'AI' : 'HUMAN',
            prompt,
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

  async sendSignal(
    tenantId: string,
    quoteId: string,
    action: 'APPROVE' | 'REJECT' | 'OVERRIDE',
    payload?: any,
  ): Promise<Quote> {
    const quote = await this.findQuoteById(tenantId, quoteId);
    const workflowId = quote.workflowId || `quote-${quote.id}`;

    try {
      const client = this.temporalService.getClient();
      const handle = client.workflow.getHandle(workflowId);

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
        default:
          throw new BadRequestException(`Invalid signal action: ${action}`);
      }
    } catch (err: unknown) {
      if (err instanceof BadRequestException) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Failed to send signal to workflow ${workflowId}: ${msg}`);
    }

    return quote;
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
