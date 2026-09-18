import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import {
  invoicePosition,
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
import { LedgerService } from '../finance/ledger.service';
import { fxRateFor } from '../finance/fx';
import { JournalEntry } from '../finance/entities/journal-entry.entity';
import {
  BillingScheduleLine,
  SalesOrder,
} from '../orders/entities/sales-order.entity';
import {
  issueEntryNumber,
  provisionOrderForQuote,
} from '../orders/order-provisioning';

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

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
    private readonly ledger: LedgerService,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Synchronous fallback for the Temporal `generateInvoiceActivity`: makes
   * sure an approved quote has its order, and the invoices its billing
   * schedule raises on approval, even if the workflow never runs.
   *
   * Both paths call the same `provisionOrderForQuote`, which locks the quote
   * row, so whichever gets there first creates everything and the other finds
   * it. `invoice` is the first invoice on the order — null when every stage
   * waits for a milestone.
   */
  async createFromQuote(
    tenantId: string,
    quote: Quote,
  ): Promise<{
    order: SalesOrder;
    invoice: Invoice | null;
    invoicesRaised: Invoice[];
    isNew: boolean;
  }> {
    const result = await provisionOrderForQuote(
      this.dataSource,
      this.ledger,
      tenantId,
      quote.id,
    );
    return {
      order: result.order,
      invoice: result.invoices[0] ?? null,
      invoicesRaised: result.invoicesRaised,
      isNew: result.isNew,
    };
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
    // A quote billed in stages has several; the first is the one approval raised.
    return this.invoiceRepository.findOne({
      where: { tenantId, quoteId },
      order: { issuedAt: 'ASC' },
    });
  }

  async findById(tenantId: string, id: string): Promise<Invoice> {
    const invoice = await this.invoiceRepository.findOne({
      where: { id, tenantId },
    });
    if (!invoice) {
      throw new NotFoundException(`Invoice with ID ${id} not found`);
    }
    // So the invoice shows "QT-2026-0001" rather than the quote's UUID.
    const quote = await this.dataSource.getRepository(Quote).findOne({
      where: { id: invoice.quoteId, tenantId },
      select: { id: true, quoteNumber: true },
    });
    invoice.quoteNumber = quote?.quoteNumber ?? null;
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
    const saved = await this.dataSource.transaction(async (manager) => {
      // Locked so two payments recorded at once cannot both pass the
      // remaining-balance check and overpay the invoice between them.
      const invoice = await this.lockInvoice(manager, tenantId, id);
      if (invoice.status === InvoiceStatus.CANCELLED) {
        throw new BadRequestException(
          'Cannot record a payment on a voided invoice',
        );
      }
      if (invoice.status === InvoiceStatus.PAID) {
        throw new BadRequestException('Invoice is already fully paid');
      }

      // Credits reduce what is owed; refunds of overpayment put it back.
      const remaining = Math.max(0, invoicePosition(invoice).balance);
      const amount = payload.amount ?? remaining;
      if (!amount || amount <= 0) {
        throw new BadRequestException(
          'Payment amount must be greater than zero',
        );
      }
      if (amount > remaining + 0.001) {
        throw new BadRequestException(
          `Payment of ${amount} exceeds remaining balance of ${remaining}`,
        );
      }

      const paidAt = payload.paidAt ? new Date(payload.paidAt) : new Date();
      const paymentRate = await fxRateFor(
        manager,
        tenantId,
        invoice.currency,
        paidAt,
      );
      await this.financeService.recordInvoicePayment(
        tenantId,
        {
          invoiceId: invoice.id,
          accountId: payload.accountId,
          amount,
          description: `Invoice ${invoice.invoiceNumber} payment`,
          fx: {
            currency: invoice.currency,
            invoiceRate: invoice.fxRate,
            paymentRate,
          },
        },
        manager,
      );

      const payments = manager.getRepository(InvoicePayment);
      const payment = await payments.save(
        payments.create({
          tenantId,
          invoiceId: invoice.id,
          amount,
          paidAt,
          accountId: payload.accountId,
          recordedById: actorId,
          notes: payload.notes ?? null,
          fxRate: paymentRate,
        }),
      );

      // The payments table is the source of truth for the running total —
      // recompute it from a SUM rather than incrementing a counter.
      const sumResult = await payments
        .createQueryBuilder('p')
        .select('COALESCE(SUM(p.amount), 0)', 'sum')
        .where('p.invoiceId = :invoiceId', { invoiceId: invoice.id })
        .getRawOne<{ sum: string }>();
      const totalPaid = round2(Number(sumResult?.sum ?? 0));

      invoice.paidAmount = totalPaid;
      invoice.paidViaAccountId = payload.accountId;
      invoice.status =
        invoicePosition(invoice).balance <= 0
          ? InvoiceStatus.PAID
          : InvoiceStatus.PARTIALLY_PAID;
      if (invoice.status === InvoiceStatus.PAID) {
        invoice.paidAt = payment.paidAt;
      }

      return manager.getRepository(Invoice).save(invoice);
    });

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
    const saved = await this.dataSource.transaction(async (manager) => {
      const invoice = await this.lockInvoice(manager, tenantId, id);
      if (invoice.status === InvoiceStatus.CANCELLED) {
        throw new BadRequestException('Invoice is already voided');
      }
      // A credit note has been posted against it. Voiding underneath would
      // reverse the invoice and leave the credit standing.
      if (Number(invoice.creditedAmount) > 0) {
        throw new BadRequestException(
          `${invoice.invoiceNumber} has credit notes against it and cannot be voided. Credit the rest instead.`,
        );
      }

      const payments = await manager.getRepository(InvoicePayment).find({
        where: { invoiceId: id },
      });
      for (const payment of payments) {
        if (!payment.accountId) {
          this.logger.warn(
            `Skipping reversal for payment ${payment.id}: no account on record`,
          );
          continue;
        }
        await this.financeService.reverseInvoicePayment(
          tenantId,
          {
            invoiceId: invoice.id,
            paymentId: payment.id,
            accountId: payment.accountId,
            amount: payment.amount,
            description: `Void of invoice ${invoice.invoiceNumber}: reversing payment ${payment.id}`,
            fx: {
              currency: invoice.currency,
              invoiceRate: invoice.fxRate,
              paymentRate: payment.fxRate,
            },
          },
          manager,
        );
      }

      await this.reverseIssuePosting(manager, tenantId, invoice);

      // Free the billing stage so a corrected invoice can be raised for it.
      // The voided invoice keeps its order link, for the history.
      if (invoice.billingScheduleLineId) {
        await manager
          .getRepository(BillingScheduleLine)
          .update(
            { id: invoice.billingScheduleLineId, invoiceId: invoice.id },
            { invoiceId: null, invoicedAt: null },
          );
        invoice.billingScheduleLineId = null;
      }

      invoice.status = InvoiceStatus.CANCELLED;
      invoice.voidedAt = new Date();
      invoice.voidedById = actorId;
      invoice.voidReason = payload.reason ?? null;

      return manager.getRepository(Invoice).save(invoice);
    });

    await this.emitInvoiceEvent(tenantId, saved, 'invoice.voided');
    return saved;
  }

  private async lockInvoice(
    manager: EntityManager,
    tenantId: string,
    id: string,
  ): Promise<Invoice> {
    const invoice = await manager
      .getRepository(Invoice)
      .createQueryBuilder('i')
      .setLock('pessimistic_write')
      .where('i.id = :id', { id })
      .andWhere('i.tenant_id = :tenantId', { tenantId })
      .getOne();
    if (!invoice) {
      throw new NotFoundException(`Invoice with ID ${id} not found`);
    }
    return invoice;
  }

  /**
   * Undoes the receivable an invoice posted when it was issued. Invoices from
   * before sales orders never posted one, so there may be nothing to undo.
   */
  private async reverseIssuePosting(
    manager: EntityManager,
    tenantId: string,
    invoice: Invoice,
  ): Promise<void> {
    const journal = manager.getRepository(JournalEntry);
    const issued = await journal.findOne({
      where: {
        tenantId,
        referenceType: 'INVOICE',
        referenceId: invoice.id,
        entryNumber: issueEntryNumber(invoice.invoiceNumber),
      },
    });
    if (!issued) return;

    await journal.save(
      journal.create({
        tenantId,
        entryNumber: `${issued.entryNumber}-VOID`,
        referenceType: 'INVOICE',
        referenceId: invoice.id,
        entryDate: new Date(),
        totalAmount: issued.totalAmount,
        lines: issued.lines.map((line) => ({
          ...line,
          debit: line.credit,
          credit: line.debit,
          description: `Void of ${invoice.invoiceNumber}`,
        })),
      }),
    );
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
