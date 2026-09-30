import { Injectable, NotFoundException, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Customer } from './entities/customer.entity';
import { Invoice, InvoiceStatus } from '../quotes/entities/invoice.entity';
import { InvoicePayment } from '../quotes/entities/invoice-payment.entity';
import { Organization } from '../organizations/entities/organization.entity';
import { DocumentPdfRendererService } from '../document-templates/document-pdf-renderer.service';
import type { UniversalDocumentData } from '@saas/shared';

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

function calculateDaysOverdue(dueDate: Date | string, asOf: Date): number {
  const due = new Date(dueDate);
  const a = Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), asOf.getUTCDate());
  const d = Date.UTC(due.getUTCFullYear(), due.getUTCMonth(), due.getUTCDate());
  return Math.floor((a - d) / 86_400_000);
}

function getPaymentDate(payment: InvoicePayment): Date {
  const d = (payment as any).paymentDate || payment.paidAt || payment.createdAt;
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
    private readonly templatesService?: any,
  ) {}

  async generateStatementData(
    tenantId: string,
    customerId: string,
    from: Date,
    to: Date,
  ): Promise<UniversalDocumentData> {
    const customer = await this.customerRepo.findOne({
      where: { id: customerId, organizationId: tenantId },
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
    const payments = await this.paymentRepo.find({
      where: {
        tenantId,
        invoiceId: In(
          invoiceIds.length > 0 ? invoiceIds : ['00000000-0000-0000-0000-000000000000'],
        ),
      },
      order: { paidAt: 'ASC' },
    });

    const fromTime = from.getTime();
    const toTime = to.getTime();

    // 1. Opening balance from transactions strictly prior to 'from' date
    const priorInvoices = invoices.filter((inv) => {
      if (inv.status === InvoiceStatus.CANCELLED) return false;
      return getInvoiceDate(inv).getTime() < fromTime;
    });

    const priorPayments = payments.filter((p) => {
      return getPaymentDate(p).getTime() < fromTime;
    });

    const priorInvoicedAmount = priorInvoices.reduce(
      (sum, inv) => sum + Number(inv.amount || 0),
      0,
    );
    const priorPaidAmount = priorPayments.reduce(
      (sum, p) => sum + Number(p.amount || 0),
      0,
    );
    const openingBalance = round2(priorInvoicedAmount - priorPaidAmount);

    // 2. Period transactions between 'from' and 'to' (inclusive)
    const periodInvoices = invoices.filter((inv) => {
      if (inv.status === InvoiceStatus.CANCELLED) return false;
      const t = getInvoiceDate(inv).getTime();
      return t >= fromTime && t <= toTime;
    });

    const periodPayments = payments.filter((p) => {
      const t = getPaymentDate(p).getTime();
      return t >= fromTime && t <= toTime;
    });

    const periodInvoicedAmount = periodInvoices.reduce(
      (sum, inv) => sum + Number(inv.amount || 0),
      0,
    );
    const periodPaidAmount = periodPayments.reduce(
      (sum, p) => sum + Number(p.amount || 0),
      0,
    );
    const closingBalance = round2(
      openingBalance + periodInvoicedAmount - periodPaidAmount,
    );

    // 3. Ledger items
    interface LedgerItem {
      date: Date;
      isInvoice: boolean;
      item: {
        code?: string;
        description: string;
        quantity: number;
        unitPrice: number;
        amount: number;
      };
    }

    const ledgerItems: LedgerItem[] = [];

    for (const inv of periodInvoices) {
      ledgerItems.push({
        date: getInvoiceDate(inv),
        isInvoice: true,
        item: {
          code: inv.invoiceNumber,
          description: `Invoice ${inv.invoiceNumber}`,
          quantity: 1,
          unitPrice: round2(Number(inv.amount)),
          amount: round2(Number(inv.amount)),
        },
      });
    }

    for (const pay of periodPayments) {
      const ref = (pay as any).reference || (pay as any).notes || 'Payment';
      ledgerItems.push({
        date: getPaymentDate(pay),
        isInvoice: false,
        item: {
          code: (pay as any).reference || 'PAYMENT',
          description: `Payment ${ref !== 'Payment' ? `(${ref})` : 'Received'}`,
          quantity: 1,
          unitPrice: -round2(Number(pay.amount)),
          amount: -round2(Number(pay.amount)),
        },
      });
    }

    ledgerItems.sort((a, b) => {
      const diff = a.date.getTime() - b.date.getTime();
      if (diff !== 0) return diff;
      return a.isInvoice ? -1 : 1;
    });

    const items = ledgerItems.map((li) => li.item);

    // 4. Aging calculation for open invoices as of 'to' date
    const aging = {
      current: 0,
      days30: 0,
      days60: 0,
      days90: 0,
      days90Plus: 0,
    };

    const invoicesToAge = invoices.filter((inv) => {
      if (inv.status === InvoiceStatus.CANCELLED) return false;
      return getInvoiceDate(inv).getTime() <= toTime;
    });

    for (const inv of invoicesToAge) {
      const paymentsOnInv = payments.filter(
        (p) => p.invoiceId === inv.id && getPaymentDate(p).getTime() <= toTime,
      );
      const paidOnInv = paymentsOnInv.reduce(
        (sum, p) => sum + Number(p.amount || 0),
        0,
      );
      const totalPaid = Math.max(paidOnInv, Number(inv.paidAmount || 0));
      const credited = Number(inv.creditedAmount || 0);
      const refunded = Number(inv.refundedAmount || 0);
      const outstanding = round2(
        Number(inv.amount) - totalPaid - credited + refunded,
      );

      if (outstanding > 0) {
        const days = inv.dueDate ? calculateDaysOverdue(inv.dueDate, to) : 0;
        if (days <= 0) {
          aging.current = round2(aging.current + outstanding);
        } else if (days <= 30) {
          aging.days30 = round2(aging.days30 + outstanding);
        } else if (days <= 60) {
          aging.days60 = round2(aging.days60 + outstanding);
        } else if (days <= 90) {
          aging.days90 = round2(aging.days90 + outstanding);
        } else {
          aging.days90Plus = round2(aging.days90Plus + outstanding);
        }
      }
    }

    const customerName =
      (customer as any).name ||
      customer.companyName ||
      customer.contactName ||
      'Customer';

    const customerAddress = [
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

    const docNumber = `STM-${customerName.replace(/[^a-zA-Z0-9]/g, '').toUpperCase()}-${to.toISOString().slice(0, 10).replace(/-/g, '')}`;

    return {
      type: 'STATEMENT',
      number: docNumber,
      status: 'ISSUED',
      issuedAt: to,
      currency: customer.currency || invoices[0]?.currency || 'USD',
      organization: {
        name: organization?.name || 'Relay CRM',
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
        periodFrom: from,
        periodTo: to,
        aging,
      },
      notes: customer.notes || undefined,
    };
  }

  async getStatementPdf(
    tenantId: string,
    customerId: string,
    from: Date,
    to: Date,
  ): Promise<{ buffer: Buffer; filename: string }> {
    const docData = await this.generateStatementData(
      tenantId,
      customerId,
      from,
      to,
    );

    let templateConfig;
    if (
      this.templatesService &&
      typeof this.templatesService.resolveForDocumentType === 'function'
    ) {
      const template = await this.templatesService.resolveForDocumentType(
        tenantId,
        'STATEMENT',
      );
      templateConfig = template?.config;
    }

    const buffer = await this.pdfRenderer.render(docData, templateConfig);
    const customerName =
      docData.party.companyName || docData.party.name || 'Customer';
    const safeName = customerName.replace(/[^a-zA-Z0-9_-]/g, '_');
    const dateStr = to.toISOString().slice(0, 10);
    const filename = `Statement-${safeName}-${dateStr}.pdf`;

    return { buffer, filename };
  }
}
