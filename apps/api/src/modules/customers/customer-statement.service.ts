import {
  BadRequestException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Customer } from './entities/customer.entity';
import { Invoice, InvoiceStatus } from '../quotes/entities/invoice.entity';
import { InvoicePayment } from '../quotes/entities/invoice-payment.entity';
import { Organization } from '../organizations/entities/organization.entity';
import { DocumentLocalizationService } from '../document-templates/document-localization.service';
import { DocumentPdfRendererService } from '../document-templates/document-pdf-renderer.service';
import { DocumentTemplatesService } from '../document-templates/document-templates.service';
import {
  agingBucket,
  invoiceBalanceAsOf,
  type AgingBucket,
  type UniversalDocumentData,
} from '@saas/shared';
import {
  CreditNote,
  CreditNoteRefund,
} from '../credits/entities/credit-note.entity';

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * Statement periods are whole UTC days, but the PDF prints dates in the
 * document time zone, so the end of a UTC day (23:59:59Z) would print as the
 * next day in Dubai. Midday UTC prints as the same calendar day there.
 */
export function statementDisplayDate(d: Date): Date {
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 12),
  );
}

function normalizeStatementDate(
  val: Date | string,
  paramName: string,
  isEndBoundary = false,
): Date {
  let d: Date;
  if (typeof val === 'string') {
    d = new Date(val);
    if (isNaN(d.getTime())) {
      throw new BadRequestException(`Invalid "${paramName}" date: ${val}`);
    }
    if (isEndBoundary && val.trim().length <= 10) {
      d.setUTCHours(23, 59, 59, 999);
    }
  } else if (val instanceof Date) {
    if (isNaN(val.getTime())) {
      throw new BadRequestException(`Invalid "${paramName}" date`);
    }
    d = new Date(val.getTime());
  } else {
    throw new BadRequestException(`Invalid "${paramName}" date`);
  }
  return d;
}

function getPaymentDate(payment: InvoicePayment): Date {
  const d = payment.paidAt || (payment as any).paymentDate || payment.createdAt;
  return d instanceof Date ? d : new Date(d);
}

function getInvoiceDate(invoice: Invoice): Date {
  const d = invoice.issuedAt || (invoice as any).createdAt;
  return d instanceof Date ? d : new Date(d);
}

@Injectable()
export class CustomerStatementService {
  constructor(
    @InjectRepository(Customer)
    private readonly customerRepo: Repository<Customer>,
    @InjectRepository(Invoice)
    private readonly invoiceRepo: Repository<Invoice>,
    @InjectRepository(InvoicePayment)
    private readonly paymentRepo: Repository<InvoicePayment>,
    @InjectRepository(Organization)
    private readonly orgRepo: Repository<Organization>,
    private readonly pdfRenderer: DocumentPdfRendererService,
    @Optional()
    private readonly templatesService?: DocumentTemplatesService,
    @Optional()
    private readonly documentLocalization?: DocumentLocalizationService,
  ) {}

  async generateStatementData(
    tenantId: string,
    customerId: string,
    from: Date | string,
    to: Date | string,
  ): Promise<UniversalDocumentData> {
    const fromDate = normalizeStatementDate(from, 'from', false);
    const toDate = normalizeStatementDate(to, 'to', true);

    if (fromDate.getTime() > toDate.getTime()) {
      throw new BadRequestException(
        '"from" date must be before or equal to "to" date',
      );
    }

    const customer = await this.customerRepo.findOne({
      where: { id: customerId, tenantId },
    });

    if (!customer) {
      throw new NotFoundException(`Customer with ID ${customerId} not found`);
    }

    const organization = await this.orgRepo.findOne({
      where: { id: tenantId },
    });

    const invoices = await this.invoiceRepo.find({
      where: { tenantId, customerId },
      order: { issuedAt: 'ASC' },
    });

    const invoiceIds = invoices.map((inv) => inv.id).filter(Boolean);
    const payments =
      invoiceIds.length > 0
        ? await this.paymentRepo.find({
            where: {
              tenantId,
              invoiceId: In(invoiceIds),
            },
            order: { paidAt: 'ASC' },
          })
        : [];

    const live = invoices.filter(
      (inv) => inv.status !== InvoiceStatus.CANCELLED,
    );
    const liveIds = live.map((inv) => inv.id);
    const manager = this.invoiceRepo.manager;
    const [creditNotes, refunds] =
      liveIds.length > 0
        ? await Promise.all([
            manager.getRepository(CreditNote).find({
              where: { tenantId, invoiceId: In(liveIds), status: 'ISSUED' },
            }),
            manager.getRepository(CreditNoteRefund).find({
              where: { tenantId, invoiceId: In(liveIds) },
            }),
          ])
        : [[], []];

    const fromTime = fromDate.getTime();
    const toTime = toDate.getTime();

    // Every dated change to what the customer owes: the same events the
    // receivables ageing and the ledger count, so the balances agree with them.
    // A voided invoice is left out with its payments, as if it was never sent.
    type Kind = 'invoice' | 'payment' | 'credit' | 'refund';
    interface StatementEvent {
      date: Date;
      kind: Kind;
      amount: number;
      code: string;
      description: string;
      descriptionAr: string;
    }
    const events: StatementEvent[] = [];
    const liveSet = new Set(liveIds);
    for (const inv of live) {
      events.push({
        date: getInvoiceDate(inv),
        kind: 'invoice',
        amount: Number(inv.amount || 0),
        code: inv.invoiceNumber,
        description: `Invoice ${inv.invoiceNumber}`,
        descriptionAr: `فاتورة ${inv.invoiceNumber}`,
      });
      // Invoices paid before payments were kept as rows carry a total and no rows.
      const rows = payments.filter((p) => p.invoiceId === inv.id);
      const unexplained = round2(
        Number(inv.paidAmount || 0) -
          rows.reduce((sum, p) => sum + Number(p.amount || 0), 0),
      );
      if (unexplained > 0) {
        events.push({
          date: inv.paidAt ? new Date(inv.paidAt) : getInvoiceDate(inv),
          kind: 'payment',
          amount: -unexplained,
          code: 'PAYMENT',
          description: 'Payment Received',
          descriptionAr: 'دفعة مستلمة',
        });
      }
    }
    for (const pay of payments) {
      if (!liveSet.has(pay.invoiceId)) continue;
      const ref = (pay as any).reference || pay.notes || 'Payment';
      const code = (pay as any).reference || pay.notes || 'PAYMENT';
      events.push({
        date: getPaymentDate(pay),
        kind: 'payment',
        amount: -Number(pay.amount || 0),
        code,
        description: `Payment ${ref !== 'Payment' ? `(${ref})` : 'Received'}`,
        descriptionAr: ref !== 'Payment' ? `دفعة (${ref})` : 'دفعة مستلمة',
      });
    }
    for (const note of creditNotes) {
      if (!note.issuedAt) continue;
      const number = note.creditNoteNumber ?? 'Credit note';
      events.push({
        date: new Date(note.issuedAt),
        kind: 'credit',
        amount: -Number(note.totalAmount || 0),
        code: number,
        description: `Credit note ${number}`,
        descriptionAr: `إشعار دائن ${number}`,
      });
    }
    for (const refund of refunds) {
      events.push({
        date: new Date(refund.refundedAt),
        kind: 'refund',
        amount: Number(refund.amount || 0),
        code: 'REFUND',
        description: 'Refund paid to you',
        descriptionAr: 'مبلغ مسترد',
      });
    }

    const sum = (rows: StatementEvent[]) =>
      round2(rows.reduce((total, e) => total + e.amount, 0));

    // 1. Opening balance from everything strictly before the 'from' date
    const openingBalance = sum(
      events.filter((e) => e.date.getTime() < fromTime),
    );

    // 2. Period events between 'from' and 'to' (inclusive)
    const period = events.filter((e) => {
      const t = e.date.getTime();
      return t >= fromTime && t <= toTime;
    });
    const periodInvoicedAmount = sum(
      period.filter((e) => e.kind === 'invoice'),
    );
    const periodPaidAmount = -sum(period.filter((e) => e.kind === 'payment'));
    const closingBalance = round2(openingBalance + sum(period));

    // 3. Ledger items, invoices first on a day
    const order: Record<Kind, number> = {
      invoice: 0,
      credit: 1,
      payment: 2,
      refund: 3,
    };
    const items = [...period]
      .sort((a, b) => {
        const diff = a.date.getTime() - b.date.getTime();
        return diff !== 0 ? diff : order[a.kind] - order[b.kind];
      })
      .map((e) => ({
        code: e.code,
        description: e.description,
        descriptionAr: e.descriptionAr,
        quantity: 1,
        unitPrice: round2(e.amount),
        amount: round2(e.amount),
      }));

    // 4. Ageing of what was owed at the 'to' date, worked out exactly as the
    // receivables ageing does. Money owed back to the customer is in the
    // closing balance but not in an overdue column: a credit is not a late debt.
    const aging = {
      current: 0,
      days30: 0,
      days60: 0,
      days90: 0,
      days90Plus: 0,
    };
    const column: Record<AgingBucket, keyof typeof aging> = {
      CURRENT: 'current',
      DAYS_1_30: 'days30',
      DAYS_31_60: 'days60',
      DAYS_61_90: 'days90',
      DAYS_OVER_90: 'days90Plus',
    };
    for (const inv of live) {
      if (getInvoiceDate(inv).getTime() > toTime) continue;
      const outstanding = invoiceBalanceAsOf(
        inv,
        {
          payments: payments.filter((p) => p.invoiceId === inv.id),
          credits: creditNotes
            .filter((c) => c.invoiceId === inv.id)
            .map((c) => ({ totalAmount: c.totalAmount, issuedAt: c.issuedAt })),
          refunds: refunds.filter((r) => r.invoiceId === inv.id),
        },
        toDate,
      );
      if (outstanding > 0) {
        const key = column[agingBucket(inv.dueDate, toDate)];
        aging[key] = round2(aging[key] + outstanding);
      }
    }

    const customerName =
      (customer as any).name ||
      customer.companyName ||
      customer.contactName ||
      'Customer';

    const customerAddress =
      [
        customer.addressLine1,
        customer.addressLine2,
        customer.city,
        customer.postalCode,
        customer.country,
      ]
        .filter(Boolean)
        .join(', ') || undefined;

    const orgAddress = organization
      ? [
          organization.addressLine1,
          organization.addressLine2,
          organization.city,
          organization.region,
          organization.postalCode,
          organization.country,
        ]
          .filter(Boolean)
          .join(', ') || undefined
      : undefined;

    const docNumber = `STM-${customerName.replace(/[^a-zA-Z0-9]/g, '').toUpperCase()}-${toDate.toISOString().slice(0, 10).replace(/-/g, '')}`;

    return {
      type: 'STATEMENT',
      number: docNumber,
      status: 'ISSUED',
      issuedAt: statementDisplayDate(toDate),
      currency: customer.currency || invoices[0]?.currency || 'USD',
      organization: {
        name: organization?.name || 'Kerf',
        address: orgAddress,
        taxId: organization?.taxId || undefined,
        phone: organization?.phone || undefined,
        email: organization?.email || undefined,
        website: organization?.website || undefined,
      },
      party: {
        name: customerName,
        companyName: customer.companyName || customerName,
        address: customerAddress,
        email: customer.email || undefined,
        phone: customer.phone || undefined,
        taxId: customer.taxId || undefined,
      },
      items,
      totals: {
        subtotal: periodInvoicedAmount,
        total: closingBalance,
        amountPaid: periodPaidAmount,
        balanceDue: closingBalance,
      },
      statementSummary: {
        openingBalance,
        closingBalance,
        periodFrom: statementDisplayDate(fromDate),
        periodTo: statementDisplayDate(toDate),
        aging,
      },
      notes: customer.notes || undefined,
    };
  }

  async getStatementPdf(
    tenantId: string,
    customerId: string,
    from: Date | string,
    to: Date | string,
  ): Promise<{ buffer: Buffer; filename: string }> {
    const docData = await this.generateStatementData(
      tenantId,
      customerId,
      from,
      to,
    );

    const template = await this.templatesService?.resolveForDocumentType(
      tenantId,
      'STATEMENT',
    );

    const localized =
      (await this.documentLocalization?.localize(
        tenantId,
        customerId,
        docData,
        template?.config,
      )) ?? docData;
    const buffer = await this.pdfRenderer.render(localized, template?.config);
    const customerName =
      docData.party.companyName || docData.party.name || 'Customer';
    const safeName = customerName.replace(/[^a-zA-Z0-9_-]/g, '_');
    const periodTo = docData.statementSummary?.periodTo
      ? new Date(docData.statementSummary.periodTo)
      : new Date();
    const dateStr = periodTo.toISOString().slice(0, 10);
    const filename = `Statement-${safeName}-${dateStr}.pdf`;

    return { buffer, filename };
  }
}
