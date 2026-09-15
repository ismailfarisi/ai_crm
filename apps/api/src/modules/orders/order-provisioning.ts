import { BadRequestException, NotFoundException } from '@nestjs/common';
import { In, type DataSource, type EntityManager } from 'typeorm';
import {
  allocateStageAmounts,
  calculateInvoiceDueDate,
  DEFAULT_BILLING_SCHEDULE,
  LEDGER_ROLES,
  REVERSE_CHARGE_NOTICE,
  scaleBreakdown,
  stripLineCosts,
  taxBreakdown,
  type TaxBreakdownLine,
  validateBillingSchedule,
  type JournalLineInput,
  type QuoteLineItem,
} from '@saas/shared';
import {
  allocateNextSequenceValue,
  formatSequenceNumber,
} from '../../database/tenant-sequence.util';
import type { LedgerService } from '../finance/ledger.service';
import { JournalEntry } from '../finance/entities/journal-entry.entity';
import { TaxCode } from '../tax/entities/tax.entity';
import { fxRateFor } from '../finance/fx';
import { Quote } from '../quotes/entities/quote.entity';
import { Invoice, InvoiceStatus } from '../quotes/entities/invoice.entity';
import {
  BillingScheduleLine,
  SalesOrder,
  SalesOrderLine,
} from './entities/sales-order.entity';

/**
 * Turning an approved quote into an order, and an order's stages into invoices.
 *
 * Plain functions, not a Nest service, because two callers need them and one
 * of them has no DI container: the synchronous approval in `QuotesService` and
 * the Temporal `generateInvoiceActivity` both run this, often at the same
 * moment. Keeping one implementation is what stops the two drifting apart —
 * before this there were two copies of invoice creation, one in each place.
 *
 * Concurrency, in the order it bites:
 *
 * 1. The quote row is locked `FOR UPDATE` first. Whichever caller gets the
 *    lock creates the order; the other waits, then finds it.
 * 2. `uq_sales_orders_quote` backs that up if something ever skips the lock.
 * 3. A billing stage is locked before its invoice is created, and
 *    `uq_invoices_billing_line` backs that up. Locking first rather than
 *    catching the violation means a lost race does not burn an invoice number
 *    and leave a gap in the sequence, which auditors ask about.
 */

export type LedgerLines = Pick<LedgerService, 'resolveLines'>;

export interface ProvisionResult {
  order: SalesOrder;
  /** Invoices raised by this call. Empty when another caller got there first. */
  invoicesRaised: Invoice[];
  /** Every invoice on the order, including ones raised earlier. */
  invoices: Invoice[];
  isNew: boolean;
}

export async function provisionOrderForQuote(
  dataSource: DataSource,
  ledger: LedgerLines,
  tenantId: string,
  quoteId: string,
): Promise<ProvisionResult> {
  return dataSource.transaction(async (manager) => {
    const quote = await manager
      .getRepository(Quote)
      .createQueryBuilder('q')
      .setLock('pessimistic_write')
      .where('q.id = :quoteId AND q.tenant_id = :tenantId', {
        quoteId,
        tenantId,
      })
      .getOne();
    if (!quote) throw new NotFoundException(`Quote ${quoteId} not found`);

    const orders = manager.getRepository(SalesOrder);
    const existing = await orders.findOne({ where: { quoteId: quote.id } });
    if (existing) {
      return {
        order: existing,
        invoicesRaised: [],
        invoices: await invoicesForOrder(manager, existing.id),
        isNew: false,
      };
    }

    if (quote.supersededAt) {
      throw new BadRequestException(
        `${quote.quoteNumber ?? 'This quote'} has been replaced by a newer revision and cannot become an order`,
      );
    }

    const stages = quote.billingSchedule?.length
      ? quote.billingSchedule
      : DEFAULT_BILLING_SCHEDULE;
    const problems = validateBillingSchedule(stages);
    if (problems.length) {
      throw new BadRequestException(
        `The billing schedule on ${quote.quoteNumber ?? 'this quote'} is not valid: ${problems.join(' ')}`,
      );
    }

    const number = await allocateNextSequenceValue(
      manager,
      tenantId,
      'sales_order_number',
    );
    const order = await orders.save(
      orders.create({
        tenantId,
        orderNumber: formatSequenceNumber('SO', number),
        quoteId: quote.id,
        quoteNumber: quote.quoteNumber,
        customerId: quote.customerId,
        customerName: quote.customerName,
        customerEmail: quote.customerEmail,
        status: 'OPEN',
        currency: quote.currency,
        paymentTerms: quote.paymentTerms,
        subtotalAmount: Number(quote.subtotalAmount),
        discountAmount: Number(quote.discountAmount),
        taxAmount: Number(quote.taxAmount),
        totalAmount: Number(quote.totalAmount),
        notes: quote.notes,
      }),
    );

    const lineRepo = manager.getRepository(SalesOrderLine);
    const products = (quote.items ?? []).filter(
      (item) => (item.type ?? 'product') === 'product',
    );
    if (products.length) {
      await lineRepo.save(
        products.map((item, index) =>
          lineRepo.create({
            tenantId,
            salesOrderId: order.id,
            sequence: index + 1,
            quoteLineId: item.id ?? null,
            catalogItemId: isUuid(item.catalogItemId)
              ? item.catalogItemId
              : null,
            description: item.description || 'Item',
            uom: item.uom?.slice(0, 40) ?? null,
            qtyOrdered: Number(item.quantity) || 1,
            unitPrice: Number(item.unitPrice) || 0,
            lineTotal: round2(Number(item.subtotal) || 0),
          }),
        ),
      );
    }

    const amounts = allocateStageAmounts(
      {
        subtotalAmount: Number(quote.subtotalAmount),
        discountAmount: Number(quote.discountAmount),
        taxAmount: Number(quote.taxAmount),
        totalAmount: Number(quote.totalAmount),
      },
      stages,
    );
    const stageRepo = manager.getRepository(BillingScheduleLine);
    const scheduleLines = await stageRepo.save(
      stages.map((stage, index) =>
        stageRepo.create({
          tenantId,
          salesOrderId: order.id,
          sequence: index + 1,
          kind: stage.kind,
          label: stage.label,
          percent: stage.percent,
          trigger: stage.trigger,
          ...amounts[index],
          invoiceId: null,
          invoicedAt: null,
        }),
      ),
    );

    const invoicesRaised: Invoice[] = [];
    for (const line of scheduleLines) {
      if (line.trigger !== 'ON_APPROVAL') continue;
      const { invoice } = await raiseStageInvoiceInTransaction(
        manager,
        ledger,
        tenantId,
        line.id,
        quote,
      );
      invoicesRaised.push(invoice);
    }

    return { order, invoicesRaised, invoices: invoicesRaised, isNew: true };
  });
}

/**
 * Raises the invoice for one billing stage. Idempotent: a stage that already
 * has its invoice returns that invoice instead of billing again.
 */
export async function raiseStageInvoice(
  dataSource: DataSource,
  ledger: LedgerLines,
  tenantId: string,
  scheduleLineId: string,
): Promise<{ invoice: Invoice; isNew: boolean }> {
  return dataSource.transaction((manager) =>
    raiseStageInvoiceInTransaction(manager, ledger, tenantId, scheduleLineId),
  );
}

async function raiseStageInvoiceInTransaction(
  manager: EntityManager,
  ledger: LedgerLines,
  tenantId: string,
  scheduleLineId: string,
  knownQuote?: Quote,
): Promise<{ invoice: Invoice; isNew: boolean }> {
  const stage = await manager
    .getRepository(BillingScheduleLine)
    .createQueryBuilder('s')
    .setLock('pessimistic_write')
    .where('s.id = :id AND s.tenant_id = :tenantId', {
      id: scheduleLineId,
      tenantId,
    })
    .getOne();
  if (!stage) throw new NotFoundException('Billing stage not found');

  const invoices = manager.getRepository(Invoice);
  if (stage.invoiceId) {
    const already = await invoices.findOne({ where: { id: stage.invoiceId } });
    if (already) return { invoice: already, isNew: false };
  }
  if (stage.trigger === 'ON_DELIVERY') {
    throw new BadRequestException(
      'This order is invoiced per delivery. Invoice each dispatched delivery note instead.',
    );
  }

  const order = await manager
    .getRepository(SalesOrder)
    .findOne({ where: { id: stage.salesOrderId, tenantId } });
  if (!order) throw new NotFoundException('Sales order not found');
  if (order.status === 'CANCELLED') {
    throw new BadRequestException(
      `${order.orderNumber} is cancelled and cannot be invoiced`,
    );
  }

  const quote =
    knownQuote ??
    (await manager
      .getRepository(Quote)
      .findOne({ where: { id: order.quoteId, tenantId } }));
  if (!quote) throw new NotFoundException('Quote for this order not found');

  const stageCount = await manager
    .getRepository(BillingScheduleLine)
    .count({ where: { salesOrderId: order.id } });

  const invoice = await issueInvoice(manager, ledger, tenantId, {
    order,
    items:
      stageCount > 1
        ? stageInvoiceItems(stage, order.quoteNumber)
        : stripLineCosts(quote.items ?? []),
    subtotalAmount: stage.subtotalAmount,
    discountAmount: stage.discountAmount,
    taxAmount: stage.taxAmount,
    totalAmount: stage.totalAmount,
    taxBreakdown: scaleBreakdown(breakdownForItems(quote.items ?? []), {
      net: stage.subtotalAmount,
      tax: stage.taxAmount,
    }),
    billingScheduleLineId: stage.id,
    deliveryNoteId: null,
    stageLabel: stageCount > 1 ? stage.label : null,
    notes: quote.notes,
  });

  stage.invoiceId = invoice.id;
  stage.invoicedAt = invoice.issuedAt ?? new Date();
  await manager.getRepository(BillingScheduleLine).save(stage);

  return { invoice, isNew: true };
}

/** Net and tax per code across a quote's priced lines. */
export function breakdownForItems(items: QuoteLineItem[]): TaxBreakdownLine[] {
  return taxBreakdown(
    items
      .filter((item) => (item.type ?? 'product') === 'product')
      .map((item) => ({
        net: Number(item.subtotal) || 0,
        rate: Number(item.taxRate) || 0,
        taxCodeId: item.taxCodeId ?? null,
        code: item.taxCode ?? null,
        reverseCharge: item.taxReverseCharge,
      })),
  );
}

/**
 * Numbers, stores and posts one invoice. Every invoice goes through here,
 * whether it bills a stage of an order or what one delivery carried.
 */
export async function issueInvoice(
  manager: EntityManager,
  ledger: LedgerLines,
  tenantId: string,
  p: {
    order: SalesOrder;
    items: QuoteLineItem[];
    subtotalAmount: number;
    discountAmount: number;
    taxAmount: number;
    totalAmount: number;
    taxBreakdown: TaxBreakdownLine[];
    billingScheduleLineId: string | null;
    deliveryNoteId: string | null;
    stageLabel: string | null;
    notes: string | null;
  },
): Promise<Invoice> {
  const invoices = manager.getRepository(Invoice);
  const value = await allocateNextSequenceValue(
    manager,
    tenantId,
    'invoice_number',
  );
  const issuedAt = new Date();
  // The rate the receivable is booked at, for good: payments and credits
  // clear it at this rate, and any difference is an exchange gain or loss.
  const fxRate = await fxRateFor(manager, tenantId, p.order.currency, issuedAt);

  // A reverse-charge supply has to say so on the invoice, or the customer
  // has no basis for accounting for the tax themselves.
  const reverseCharged = p.taxBreakdown.some(
    (line) => line.reverseCharge && line.net > 0,
  );
  const notes = reverseCharged
    ? [p.notes, REVERSE_CHARGE_NOTICE].filter(Boolean).join('\n\n')
    : p.notes;

  const invoice = await invoices.save(
    invoices.create({
      tenantId,
      quoteId: p.order.quoteId,
      salesOrderId: p.order.id,
      billingScheduleLineId: p.billingScheduleLineId,
      deliveryNoteId: p.deliveryNoteId,
      stageLabel: p.stageLabel,
      invoiceNumber: formatSequenceNumber('INV', value),
      customerId: p.order.customerId,
      customerName: p.order.customerName,
      customerEmail: p.order.customerEmail,
      currency: p.order.currency,
      items: p.items,
      subtotalAmount: p.subtotalAmount,
      discountAmount: p.discountAmount,
      taxAmount: p.taxAmount,
      amount: p.totalAmount,
      taxBreakdown: p.taxBreakdown,
      fxRate,
      status: InvoiceStatus.ISSUED,
      paymentTerms: p.order.paymentTerms,
      dueDate: calculateInvoiceDueDate(issuedAt, p.order.paymentTerms),
      notes,
    }),
  );

  await postInvoiceIssued(manager, ledger, tenantId, invoice);
  return invoice;
}

/**
 * Dr receivables, Cr sales and tax.
 *
 * Invoices used to post nothing until paid, when the payment credited
 * receivables that had never been debited — so receivables ran negative by
 * everything ever collected. With deposits that stops being cosmetic: an
 * unpaid deposit invoice is money the customer owes, and it has to show.
 *
 * Tax is credited per code, to the account the code names, or to the chart's
 * tax payable account when it names none.
 */
export async function postInvoiceIssued(
  manager: EntityManager,
  ledger: LedgerLines,
  tenantId: string,
  invoice: Invoice,
): Promise<JournalEntry | null> {
  const total = round2(Number(invoice.amount));
  if (!(total > 0)) return null;
  const description = `Invoice ${invoice.invoiceNumber}`;

  const taxLines = await taxPostingLines(
    manager,
    tenantId,
    invoice.taxBreakdown,
    round2(Number(invoice.taxAmount) || 0),
    description,
    'credit',
  );
  const tax = round2(taxLines.reduce((s, l) => s + l.credit, 0));
  const sales = round2(total - tax);

  const lines: JournalLineInput[] = [
    {
      role: LEDGER_ROLES.ACCOUNTS_RECEIVABLE,
      accountName: 'Accounts Receivable',
      debit: total,
      credit: 0,
      description,
    },
  ];
  if (sales > 0) {
    lines.push({
      role: LEDGER_ROLES.SALES,
      accountName: 'Sales',
      debit: 0,
      credit: sales,
      description,
    });
  }
  lines.push(...taxLines);

  const repo = manager.getRepository(JournalEntry);
  return repo.save(
    repo.create({
      tenantId,
      entryNumber: issueEntryNumber(invoice.invoiceNumber),
      referenceType: 'INVOICE',
      referenceId: invoice.id,
      entryDate: new Date(),
      totalAmount: total,
      currency: invoice.currency,
      fxRate: invoice.fxRate ?? 1,
      lines: await ledger.resolveLines(
        tenantId,
        lines,
        manager,
        invoice.fxRate ?? 1,
      ),
    }),
  );
}

/**
 * Tax journal lines for a breakdown, one per account.
 *
 * Falls back to a single line for the document's tax when there is no
 * breakdown — documents from before tax codes — so their postings are
 * exactly what they were.
 */
export async function taxPostingLines(
  manager: EntityManager,
  tenantId: string,
  breakdown: TaxBreakdownLine[] | null,
  documentTax: number,
  description: string,
  side: 'debit' | 'credit',
): Promise<JournalLineInput[]> {
  const line = (
    amount: number,
    ledgerAccountId: string | null,
  ): JournalLineInput => ({
    ...(ledgerAccountId
      ? { ledgerAccountId }
      : { role: LEDGER_ROLES.TAX_PAYABLE }),
    accountName: 'Tax payable',
    debit: side === 'debit' ? amount : 0,
    credit: side === 'credit' ? amount : 0,
    description,
  });

  const taxed = (breakdown ?? []).filter((b) => b.tax > 0);
  if (!taxed.length) {
    return documentTax > 0 ? [line(documentTax, null)] : [];
  }

  const ids = taxed
    .map((b) => b.taxCodeId)
    .filter((v): v is string => Boolean(v));
  const codes = ids.length
    ? await manager
        .getRepository(TaxCode)
        .find({ where: { tenantId, id: In(ids) } })
    : [];
  const accountFor = new Map(codes.map((c) => [c.id, c.ledgerAccountId]));

  const byAccount = new Map<string, number>();
  for (const b of taxed) {
    const account = (b.taxCodeId && accountFor.get(b.taxCodeId)) || '';
    byAccount.set(account, round2((byAccount.get(account) ?? 0) + b.tax));
  }
  return [...byAccount.entries()].map(([account, amount]) =>
    line(amount, account || null),
  );
}

export const issueEntryNumber = (invoiceNumber: string) =>
  `JE-${invoiceNumber}`;

export async function invoicesForOrder(
  manager: EntityManager,
  salesOrderId: string,
): Promise<Invoice[]> {
  return manager
    .getRepository(Invoice)
    .find({ where: { salesOrderId }, order: { issuedAt: 'ASC' } });
}

/** A part invoice bills a share of the job, not a share of every line. */
function stageInvoiceItems(
  stage: BillingScheduleLine,
  quoteNumber: string | null,
): QuoteLineItem[] {
  const subtotal = Number(stage.subtotalAmount);
  const tax = Number(stage.taxAmount);
  return [
    {
      id: `stage-${stage.sequence}`,
      type: 'product',
      description: `${stage.label} (${Number(stage.percent)}% of ${quoteNumber ?? 'the quoted work'})`,
      quantity: 1,
      unitPrice: subtotal,
      discount: 0,
      taxRate: subtotal > 0 ? Math.round((tax / subtotal) * 10000) / 100 : 0,
      subtotal,
    },
  ];
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

const isUuid = (v: unknown): v is string =>
  typeof v === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
