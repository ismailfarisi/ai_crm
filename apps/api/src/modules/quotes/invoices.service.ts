import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import {
  calculateInvoiceDueDate,
  RecordInvoicePaymentPayload,
  VoidInvoicePayload,
} from '@saas/shared';
import { Invoice, InvoiceStatus } from './entities/invoice.entity';
import { InvoicePayment } from './entities/invoice-payment.entity';
import { Quote } from './entities/quote.entity';
import { Organization } from '../organizations/entities/organization.entity';
import { FinanceService } from '../finance/finance.service';
import { MailService } from '../mail/mail.service';
import { InvoicePdfService } from './invoice-pdf.service';
import { AutomationEventBridgeService } from '../automations/services/automation-event-bridge.service';
import {
  allocateNextSequenceValue,
  formatSequenceNumber,
} from '../../database/tenant-sequence.util';

const POSTGRES_UNIQUE_VIOLATION = '23505';

@Injectable()
export class InvoicesService {
  private readonly logger = new Logger(InvoicesService.name);

  constructor(
    @InjectRepository(Invoice)
    private readonly invoiceRepository: Repository<Invoice>,
    @InjectRepository(InvoicePayment)
    private readonly invoicePaymentRepository: Repository<InvoicePayment>,
    @InjectRepository(Organization)
    private readonly organizationRepository: Repository<Organization>,
    private readonly financeService: FinanceService,
    private readonly mailService: MailService,
    private readonly invoicePdfService: InvoicePdfService,
    private readonly automationEventBridgeService: AutomationEventBridgeService,
  ) {}

  /**
   * Synchronous fallback for the Temporal `generateInvoiceActivity`: makes
   * sure an invoice exists for an approved quote even if the workflow never
   * runs (Temporal down) or hasn't finished by the time this call returns.
   * Idempotent — a `UQ_invoices_quote_id` constraint backs this up against
   * the race with the Temporal activity, which can also try to create it.
   */
  async createFromQuote(
    tenantId: string,
    quote: Quote,
  ): Promise<{ invoice: Invoice; isNew: boolean }> {
    const existing = await this.invoiceRepository.findOne({
      where: { quoteId: quote.id },
    });
    if (existing) {
      return { invoice: existing, isNew: false };
    }

    const sequenceValue = await allocateNextSequenceValue(
      this.invoiceRepository.manager,
      tenantId,
      'invoice_number',
    );
    const invoiceNumber = formatSequenceNumber('INV', sequenceValue);
    const issuedAt = new Date();

    const invoice = this.invoiceRepository.create({
      quoteId: quote.id,
      tenantId,
      invoiceNumber,
      customerId: quote.customerId,
      customerName: quote.customerName,
      customerEmail: quote.customerEmail,
      currency: quote.currency,
      items: quote.items,
      subtotalAmount: quote.subtotalAmount,
      discountAmount: quote.discountAmount,
      taxAmount: quote.taxAmount,
      amount: quote.totalAmount,
      status: InvoiceStatus.ISSUED,
      paymentTerms: quote.paymentTerms,
      dueDate: calculateInvoiceDueDate(issuedAt, quote.paymentTerms),
      notes: quote.notes,
    });

    try {
      const saved = await this.invoiceRepository.save(invoice);
      return { invoice: saved, isNew: true };
    } catch (err: unknown) {
      const isUniqueViolation =
        err instanceof QueryFailedError &&
        (err as unknown as { code?: string }).code ===
          POSTGRES_UNIQUE_VIOLATION;
      if (!isUniqueViolation) throw err;

      // Lost the race against the Temporal activity, which also tries to
      // create the invoice for this quote — use the row that won instead.
      const winner = await this.invoiceRepository.findOne({
        where: { quoteId: quote.id },
      });
      if (!winner) throw err;
      return { invoice: winner, isNew: false };
    }
  }

  async findAll(tenantId: string): Promise<Invoice[]> {
    return this.invoiceRepository.find({
      where: { tenantId },
      order: { issuedAt: 'DESC' },
    });
  }

  async findByQuoteId(
    tenantId: string,
    quoteId: string,
  ): Promise<Invoice | null> {
    return this.invoiceRepository.findOne({ where: { tenantId, quoteId } });
  }

  async findById(tenantId: string, id: string): Promise<Invoice> {
    const invoice = await this.invoiceRepository.findOne({
      where: { id, tenantId },
    });
    if (!invoice) {
      throw new NotFoundException(`Invoice with ID ${id} not found`);
    }
    return invoice;
  }

  async findPayments(tenantId: string, id: string): Promise<InvoicePayment[]> {
    await this.findById(tenantId, id);
    return this.invoicePaymentRepository.find({
      where: { invoiceId: id },
      order: { paidAt: 'DESC' },
    });
  }

  async recordPayment(
    tenantId: string,
    id: string,
    payload: RecordInvoicePaymentPayload,
    actorId: string,
  ): Promise<Invoice> {
    const invoice = await this.findById(tenantId, id);
    if (invoice.status === InvoiceStatus.CANCELLED) {
      throw new BadRequestException(
        'Cannot record a payment on a voided invoice',
      );
    }
    if (invoice.status === InvoiceStatus.PAID) {
      throw new BadRequestException('Invoice is already fully paid');
    }

    const remaining = Number(invoice.amount) - Number(invoice.paidAmount || 0);
    const amount = payload.amount ?? remaining;
    if (!amount || amount <= 0) {
      throw new BadRequestException('Payment amount must be greater than zero');
    }
    if (amount > remaining + 0.01) {
      throw new BadRequestException(
        `Payment of ${amount} exceeds remaining balance of ${remaining}`,
      );
    }

    await this.financeService.recordInvoicePayment(tenantId, {
      invoiceId: invoice.id,
      accountId: payload.accountId,
      amount,
      description: `Invoice ${invoice.invoiceNumber} payment`,
    });

    const paidAt = payload.paidAt ? new Date(payload.paidAt) : new Date();
    const payment = await this.invoicePaymentRepository.save(
      this.invoicePaymentRepository.create({
        tenantId,
        invoiceId: invoice.id,
        amount,
        paidAt,
        accountId: payload.accountId,
        recordedById: actorId,
        notes: payload.notes ?? null,
      }),
    );

    // The payments table is the source of truth for the running total —
    // recompute it from a SUM rather than incrementing a counter.
    const sumResult = await this.invoicePaymentRepository
      .createQueryBuilder('p')
      .select('COALESCE(SUM(p.amount), 0)', 'sum')
      .where('p.invoiceId = :invoiceId', { invoiceId: invoice.id })
      .getRawOne<{ sum: string }>();
    const totalPaid = Number(sumResult?.sum ?? 0);

    invoice.paidAmount = totalPaid;
    invoice.paidViaAccountId = payload.accountId;
    invoice.status =
      totalPaid >= Number(invoice.amount)
        ? InvoiceStatus.PAID
        : InvoiceStatus.PARTIALLY_PAID;
    if (invoice.status === InvoiceStatus.PAID) {
      invoice.paidAt = payment.paidAt;
    }

    const saved = await this.invoiceRepository.save(invoice);
    await this.emitInvoiceEvent(
      tenantId,
      saved,
      saved.status === InvoiceStatus.PAID
        ? 'invoice.paid'
        : 'invoice.partially_paid',
    );
    return saved;
  }

  /** @deprecated use recordPayment via POST /invoices/:id/payments */
  async markPaid(
    tenantId: string,
    id: string,
    payload: {
      accountId: string;
      paidAmount?: number;
      paidAt?: string;
      notes?: string;
    },
    actorId: string,
  ): Promise<Invoice> {
    return this.recordPayment(
      tenantId,
      id,
      {
        accountId: payload.accountId,
        amount: payload.paidAmount,
        paidAt: payload.paidAt,
        notes: payload.notes,
      },
      actorId,
    );
  }

  async voidInvoice(
    tenantId: string,
    id: string,
    payload: VoidInvoicePayload,
    actorId: string,
  ): Promise<Invoice> {
    const invoice = await this.findById(tenantId, id);
    if (invoice.status === InvoiceStatus.CANCELLED) {
      throw new BadRequestException('Invoice is already voided');
    }

    const payments = await this.invoicePaymentRepository.find({
      where: { invoiceId: id },
    });
    for (const payment of payments) {
      if (!payment.accountId) {
        this.logger.warn(
          `Skipping reversal for payment ${payment.id}: no account on record`,
        );
        continue;
      }
      await this.financeService.reverseInvoicePayment(tenantId, {
        invoiceId: invoice.id,
        paymentId: payment.id,
        accountId: payment.accountId,
        amount: payment.amount,
        description: `Void of invoice ${invoice.invoiceNumber}: reversing payment ${payment.id}`,
      });
    }

    invoice.status = InvoiceStatus.CANCELLED;
    invoice.voidedAt = new Date();
    invoice.voidedById = actorId;
    invoice.voidReason = payload.reason ?? null;

    const saved = await this.invoiceRepository.save(invoice);
    await this.emitInvoiceEvent(tenantId, saved, 'invoice.voided');
    return saved;
  }

  async sendToCustomer(tenantId: string, id: string): Promise<Invoice> {
    const invoice = await this.findById(tenantId, id);
    if (!invoice.customerEmail) {
      throw new BadRequestException('Invoice has no customer email to send to');
    }

    const organization = await this.organizationRepository.findOne({
      where: { id: tenantId },
    });
    const organizationName = organization?.name || 'Relay CRM';

    const pdf = await this.invoicePdfService.generate(
      invoice,
      organizationName,
    );

    await this.mailService.sendMail({
      to: invoice.customerEmail,
      subject: `Invoice ${invoice.invoiceNumber} from ${organizationName}`,
      html: `<p>Hi ${escapeHtml(invoice.customerName)},</p><p>Please find attached invoice <strong>${escapeHtml(invoice.invoiceNumber)}</strong> for ${escapeHtml(String(invoice.amount))} ${escapeHtml(invoice.currency)}.</p>`,
      text: `Hi ${invoice.customerName},\n\nPlease find attached invoice ${invoice.invoiceNumber} for ${invoice.amount} ${invoice.currency}.`,
      attachments: [
        {
          filename: `${invoice.invoiceNumber}.pdf`,
          content: pdf,
          contentType: 'application/pdf',
        },
      ],
    });

    invoice.sentAt = new Date();
    const saved = await this.invoiceRepository.save(invoice);
    await this.emitInvoiceEvent(tenantId, saved, 'invoice.sent');
    return saved;
  }

  async getPdf(
    tenantId: string,
    id: string,
  ): Promise<{ buffer: Buffer; filename: string }> {
    const invoice = await this.findById(tenantId, id);
    const organization = await this.organizationRepository.findOne({
      where: { id: tenantId },
    });
    const buffer = await this.invoicePdfService.generate(
      invoice,
      organization?.name || 'Relay CRM',
    );
    return { buffer, filename: `${invoice.invoiceNumber}.pdf` };
  }

  /** Best-effort — an automation failure must never block the operation that already succeeded. */
  private async emitInvoiceEvent(
    tenantId: string,
    invoice: Invoice,
    eventType: string,
  ): Promise<void> {
    try {
      await this.automationEventBridgeService.handleCrmEvent({
        tenantId,
        eventType,
        entityId: invoice.id,
        data: {
          invoiceId: invoice.id,
          invoiceNumber: invoice.invoiceNumber,
          customerId: invoice.customerId,
          customerEmail: invoice.customerEmail,
          amount: invoice.amount,
          paidAmount: invoice.paidAmount,
          status: invoice.status,
          dueDate: invoice.dueDate,
        },
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `Failed to emit ${eventType} for invoice ${invoice.id}: ${msg}`,
      );
    }
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
