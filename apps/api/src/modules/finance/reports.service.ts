import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, In, LessThanOrEqual, Not, Repository } from 'typeorm';
import {
  agingBucket,
  AGING_BUCKETS,
  invoicePosition,
  LEDGER_ROLES,
  NORMAL_BALANCE,
  toBase,
  type BalanceSheetDto,
  type MarginReportDto,
  type MarginRowDto,
  type ProfitAndLossDto,
  type ReceivablesAgingDto,
  type StatementLineDto,
} from '@saas/shared';
import {
  SalesOrder,
  SalesOrderLine,
} from '../orders/entities/sales-order.entity';
import { WorkOrder } from '../production/entities/work-order.entity';
import { CreditNote } from '../credits/entities/credit-note.entity';
import { Invoice, InvoiceStatus } from '../quotes/entities/invoice.entity';
import { Quote } from '../quotes/entities/quote.entity';
import { JournalEntry } from './entities/journal-entry.entity';
import { LedgerAccount } from './entities/ledger-account.entity';
import { baseCurrencyFor } from './fx';
import { LedgerService } from './ledger.service';

const cents = (n: number) => Math.round((n + Number.EPSILON) * 100);
const round2 = (n: number) => cents(n) / 100;

/**
 * Statements and management reports, read off the ledger and documents.
 *
 * Everything is in base currency. The statements come from journal lines
 * alone, so they agree with the trial balance by construction; the operational
 * reports (aging, margin) come from documents and say whether they reconcile.
 */
@Injectable()
export class ReportsService {
  constructor(
    @InjectRepository(JournalEntry)
    private readonly journal: Repository<JournalEntry>,
    @InjectRepository(LedgerAccount)
    private readonly accounts: Repository<LedgerAccount>,
    @InjectRepository(Invoice) private readonly invoices: Repository<Invoice>,
    @InjectRepository(CreditNote)
    private readonly creditNotes: Repository<CreditNote>,
    @InjectRepository(SalesOrder)
    private readonly orders: Repository<SalesOrder>,
    @InjectRepository(SalesOrderLine)
    private readonly orderLines: Repository<SalesOrderLine>,
    @InjectRepository(WorkOrder)
    private readonly workOrders: Repository<WorkOrder>,
    @InjectRepository(Quote) private readonly quotes: Repository<Quote>,
    private readonly ledger: LedgerService,
  ) {}

  private async balances(tenantId: string, where: object) {
    const [accounts, entries] = await Promise.all([
      this.ledger.list(tenantId),
      this.journal.find({ where: { tenantId, ...where } }),
    ]);
    const totals = new Map<string, number>();
    for (const entry of entries) {
      for (const line of entry.lines ?? []) {
        if (!line.ledgerAccountId) continue;
        totals.set(
          line.ledgerAccountId,
          (totals.get(line.ledgerAccountId) ?? 0) +
            cents(Number(line.debit ?? 0)) -
            cents(Number(line.credit ?? 0)),
        );
      }
    }
    return accounts
      .map((account): StatementLineDto => {
        const debitMinusCredit = (totals.get(account.id) ?? 0) / 100;
        return {
          ledgerAccountId: account.id,
          code: account.code,
          name: account.name,
          type: account.type,
          amount: round2(
            NORMAL_BALANCE[account.type] === 'DEBIT'
              ? debitMinusCredit
              : -debitMinusCredit,
          ),
        };
      })
      .filter((line) => cents(line.amount) !== 0);
  }

  async profitAndLoss(
    tenantId: string,
    from: Date,
    to: Date,
  ): Promise<ProfitAndLossDto> {
    const lines = await this.balances(tenantId, {
      entryDate: Between(from, to),
    });
    const income = lines.filter((l) => l.type === 'INCOME');
    const expenses = lines.filter((l) => l.type === 'EXPENSE');
    const totalIncome = round2(income.reduce((s, l) => s + l.amount, 0));
    const totalExpenses = round2(expenses.reduce((s, l) => s + l.amount, 0));
    return {
      from: from.toISOString(),
      to: to.toISOString(),
      baseCurrency: await baseCurrencyFor(this.journal.manager, tenantId),
      income,
      expenses,
      totalIncome,
      totalExpenses,
      netProfit: round2(totalIncome - totalExpenses),
    };
  }

  /**
   * Assets against liabilities and equity at a date. Profit not yet closed
   * into retained earnings is shown as current earnings, which is what makes
   * the two sides agree.
   */
  async balanceSheet(tenantId: string, asOf: Date): Promise<BalanceSheetDto> {
    const lines = await this.balances(tenantId, {
      entryDate: LessThanOrEqual(asOf),
    });
    const sum = (type: StatementLineDto['type']) =>
      round2(
        lines.filter((l) => l.type === type).reduce((s, l) => s + l.amount, 0),
      );
    const assets = lines.filter((l) => l.type === 'ASSET');
    const liabilities = lines.filter((l) => l.type === 'LIABILITY');
    const equity = lines.filter((l) => l.type === 'EQUITY');
    const currentEarnings = round2(sum('INCOME') - sum('EXPENSE'));
    const totalAssets = sum('ASSET');
    const totalLiabilitiesAndEquity = round2(
      sum('LIABILITY') + sum('EQUITY') + currentEarnings,
    );
    return {
      asOf: asOf.toISOString(),
      baseCurrency: await baseCurrencyFor(this.journal.manager, tenantId),
      assets,
      liabilities,
      equity,
      currentEarnings,
      totalAssets,
      totalLiabilitiesAndEquity,
      difference: round2(totalAssets - totalLiabilitiesAndEquity),
    };
  }

  async receivablesAging(
    tenantId: string,
    asOf: Date,
  ): Promise<ReceivablesAgingDto> {
    const open = await this.invoices.find({
      where: {
        tenantId,
        status: In([
          InvoiceStatus.ISSUED,
          InvoiceStatus.PARTIALLY_PAID,
          InvoiceStatus.PAID,
        ]),
        issuedAt: LessThanOrEqual(asOf),
      },
      order: { dueDate: 'ASC' },
    });
    const buckets = Object.fromEntries(
      AGING_BUCKETS.map((b) => [b, 0]),
    ) as ReceivablesAgingDto['buckets'];
    const rows: ReceivablesAgingDto['rows'] = [];
    for (const invoice of open) {
      const outstanding = invoicePosition(invoice).balance;
      if (cents(outstanding) === 0) continue;
      const outstandingBase = toBase(outstanding, invoice.fxRate ?? 1);
      const bucket = agingBucket(invoice.dueDate, asOf);
      buckets[bucket] = round2(buckets[bucket] + outstandingBase);
      rows.push({
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        customerName: invoice.customerName,
        currency: invoice.currency,
        outstanding,
        outstandingBase,
        dueDate: invoice.dueDate?.toISOString() ?? null,
        daysOverdue: invoice.dueDate
          ? Math.max(
              0,
              Math.floor(
                (asOf.getTime() - invoice.dueDate.getTime()) / 86_400_000,
              ),
            )
          : 0,
        bucket,
      });
    }
    const total = round2(rows.reduce((s, r) => s + r.outstandingBase, 0));
    const receivables = await this.ledger.byRole(
      tenantId,
      LEDGER_ROLES.ACCOUNTS_RECEIVABLE,
    );
    const trial = await this.ledger.trialBalance(tenantId, asOf);
    const ledgerBalance =
      trial.rows.find((r) => r.ledgerAccountId === receivables.id)?.balance ??
      0;
    return {
      asOf: asOf.toISOString(),
      baseCurrency: await baseCurrencyFor(this.journal.manager, tenantId),
      rows,
      buckets,
      total,
      ledgerBalance,
      difference: round2(total - ledgerBalance),
    };
  }

  /**
   * Margin on sales orders placed in a period, by customer or by product
   * template.
   *
   * Revenue is what was invoiced, net of tax and of credit notes, in base
   * currency. Cost is measured where it can be — a completed work order's
   * actual cost — and quoted where it cannot, and the report says how much of
   * each row is measured, because a margin built on estimates is a forecast.
   */
  async margins(
    tenantId: string,
    from: Date,
    to: Date,
    by: 'customer' | 'template',
  ): Promise<MarginReportDto> {
    const orders = await this.orders.find({
      where: {
        tenantId,
        createdAt: Between(from, to),
        status: Not('CANCELLED'),
      },
    });
    const base = await baseCurrencyFor(this.journal.manager, tenantId);
    const empty = {
      from: from.toISOString(),
      to: to.toISOString(),
      baseCurrency: base,
      by,
      rows: [],
    };
    if (!orders.length) return empty;

    const orderIds = orders.map((o) => o.id);
    const [lines, invoices, workOrders, quotes] = await Promise.all([
      this.orderLines.find({ where: { tenantId, salesOrderId: In(orderIds) } }),
      this.invoices.find({
        where: {
          tenantId,
          salesOrderId: In(orderIds),
          status: Not(InvoiceStatus.CANCELLED),
        },
      }),
      this.workOrders.find({
        where: { tenantId, salesOrderId: In(orderIds), status: 'COMPLETE' },
      }),
      this.quotes.find({
        where: { tenantId, id: In(orders.map((o) => o.quoteId)) },
      }),
    ]);
    const credits = invoices.length
      ? await this.creditNotes.find({
          where: {
            tenantId,
            status: 'ISSUED',
            invoiceId: In(invoices.map((i) => i.id)),
          },
        })
      : [];

    const groups = new Map<
      string,
      MarginRowDto & { measured: number; orderIds: Set<string> }
    >();
    const group = (key: string, label: string) => {
      const g = groups.get(key) ?? {
        key,
        label,
        orders: 0,
        revenue: 0,
        cost: 0,
        margin: 0,
        marginPct: null,
        measuredCostShare: 0,
        measured: 0,
        orderIds: new Set<string>(),
      };
      groups.set(key, g);
      return g;
    };

    for (const order of orders) {
      const orderInvoices = invoices.filter((i) => i.salesOrderId === order.id);
      const credited = credits
        .filter((c) => orderInvoices.some((i) => i.id === c.invoiceId))
        .reduce(
          (s, c) => s + toBase(Number(c.subtotalAmount), c.fxRate ?? 1),
          0,
        );
      const revenue = round2(
        orderInvoices.reduce(
          (s, i) => s + toBase(Number(i.subtotalAmount), i.fxRate ?? 1),
          0,
        ) - credited,
      );
      const quote = quotes.find((q) => q.id === order.quoteId);
      const quoteItems = new Map((quote?.items ?? []).map((i) => [i.id, i]));
      const orderLines = lines.filter((l) => l.salesOrderId === order.id);
      const orderNet = orderLines.reduce((s, l) => s + Number(l.lineTotal), 0);

      for (const line of orderLines) {
        const item = line.quoteLineId
          ? quoteItems.get(line.quoteLineId)
          : undefined;
        if (by === 'template' && !item?.templateId) continue;
        const share = orderNet > 0 ? Number(line.lineTotal) / orderNet : 0;
        const wo = workOrders.find((w) => w.salesOrderLineId === line.id);
        const measuredCost = wo?.actualCost?.total ?? null;
        const cost = measuredCost ?? Number(item?.cost?.totalCost ?? 0);

        const g =
          by === 'customer'
            ? group(
                order.customerId ?? `name:${order.customerName}`,
                order.customerName,
              )
            : group(
                item!.templateId as string,
                (quote?.items ?? []).find(
                  (i) => i.templateId === item!.templateId,
                )?.description ?? 'Template',
              );
        g.revenue = round2(g.revenue + revenue * share);
        g.cost = round2(g.cost + cost);
        if (measuredCost != null)
          g.measured = round2(g.measured + measuredCost);
        g.orderIds.add(order.id);
      }
    }

    const rows = [...groups.values()]
      .map(({ measured, orderIds, ...g }) => ({
        ...g,
        orders: orderIds.size,
        margin: round2(g.revenue - g.cost),
        marginPct:
          g.revenue > 0
            ? Math.round(((g.revenue - g.cost) / g.revenue) * 1000) / 1000
            : null,
        measuredCostShare:
          g.cost > 0 ? Math.round((measured / g.cost) * 1000) / 1000 : 0,
      }))
      .sort((a, b) => b.revenue - a.revenue);
    return { ...empty, rows };
  }
}

/** Minimal RFC 4180 CSV: quotes a field only when it has to. */
export function toCsv(
  header: string[],
  rows: (string | number | null | undefined)[][],
): string {
  const field = (value: string | number | null | undefined) => {
    const text = value == null ? '' : String(value);
    // A leading = + - @ turns a cell into a formula in a spreadsheet.
    const safe =
      /^[=+\-@]/.test(text) && !/^-?\d/.test(text) ? `'${text}` : text;
    return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  return (
    [header, ...rows].map((r) => r.map(field).join(',')).join('\r\n') + '\r\n'
  );
}
