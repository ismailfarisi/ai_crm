/**
 * What a document's counterparty owed on a given day.
 *
 * An ageing report for a past date cannot read a document's running totals:
 * `paidAmount` is today's figure. It has to add up the dated things that
 * happened to the document (issue, payments, credit notes, refunds, a void),
 * keeping only those dated on or before the day asked about. Each of those is
 * also a journal entry on the same date, which is why the result agrees with
 * the receivables or payables account as of that day.
 */

type When = Date | string | null | undefined;

/** A dated change to what is owed on a document, in the document's currency. */
export interface DatedAmount {
  at: When;
  /** Positive raises what is owed, negative lowers it. */
  amount: number;
}

const cents = (n: number) => Math.round((Number(n) + Number.EPSILON) * 100);

/** Sum of the changes dated on or before `asOf`, exact to the cent. Undated changes never count. */
export function balanceAsOf(changes: DatedAmount[], asOf: Date): number {
  const limit = asOf.getTime();
  let total = 0;
  for (const change of changes) {
    if (change.at == null) continue;
    if (new Date(change.at).getTime() <= limit) total += cents(change.amount);
  }
  return total / 100;
}

export interface InvoiceHistory {
  amount: number;
  issuedAt: When;
  /** Today's total paid. Any part no payment row explains is dated `paidAt`, else the issue date. */
  paidAmount?: number | null;
  paidAt?: When;
  /** Voided invoices are `CANCELLED`; one with no `voidedAt` is treated as never owed. */
  status?: string;
  voidedAt?: When;
}

/**
 * What a customer owed on an invoice at `asOf`. Negative means they had paid
 * or been credited more than was owed: money due back to them.
 *
 * `credits` are issued credit notes only. A void reverses the issue and every
 * payment on the void date, so a voided invoice counts up to that day and is
 * nil after it.
 */
export function invoiceBalanceAsOf(
  invoice: InvoiceHistory,
  history: {
    payments?: { amount: number; paidAt: When }[];
    credits?: { totalAmount: number; issuedAt: When }[];
    refunds?: { amount: number; refundedAt: When }[];
  },
  asOf: Date,
): number {
  const payments = history.payments ?? [];
  const changes: DatedAmount[] = [
    { at: invoice.issuedAt, amount: Number(invoice.amount) },
    ...payments.map((p) => ({ at: p.paidAt, amount: -Number(p.amount) })),
    ...(history.credits ?? []).map((c) => ({ at: c.issuedAt, amount: -Number(c.totalAmount) })),
    ...(history.refunds ?? []).map((r) => ({ at: r.refundedAt, amount: Number(r.amount) })),
  ];
  // Invoices paid before payments were kept as rows carry a total and no rows.
  const unexplained =
    cents(invoice.paidAmount ?? 0) - payments.reduce((s, p) => s + cents(p.amount), 0);
  if (unexplained > 0) {
    changes.push({ at: invoice.paidAt ?? invoice.issuedAt, amount: -unexplained / 100 });
  }
  if (invoice.status === 'CANCELLED' || invoice.voidedAt) {
    const voidedAt = invoice.voidedAt ?? invoice.issuedAt;
    changes.push(...changes.map((c) => ({ at: voidedAt, amount: -c.amount })));
  }
  return balanceAsOf(changes, asOf);
}

/**
 * What was owed to a supplier on a posted bill at `asOf`. The bill counts from
 * its bill date (the date its journal entry carries), a payment from the day
 * it was paid, and a reversed payment comes back on the day it was reversed.
 */
export function billBalanceAsOf(
  bill: { totalAmount: number; billDate: When },
  payments: { amount: number; paidAt: When; reversedAt?: When }[],
  asOf: Date,
): number {
  return balanceAsOf(
    [
      { at: bill.billDate, amount: Number(bill.totalAmount) },
      ...payments.flatMap((p) => [
        { at: p.paidAt, amount: -Number(p.amount) },
        { at: p.reversedAt, amount: Number(p.amount) },
      ]),
    ],
    asOf,
  );
}

/** The UTC calendar day, which is the day reports and the period lock compare by. */
export function utcDay(value: Date | string): string {
  return new Date(value).toISOString().slice(0, 10);
}

/**
 * True when `date` falls on an earlier UTC day than `floor`. A payment dated
 * before its document posts to the ledger before the debt exists, leaving the
 * account negative for the days in between. Same-day is fine whatever the hour.
 */
export function isBeforeDay(date: Date | string, floor: Date | string): boolean {
  return utcDay(date) < utcDay(floor);
}

/**
 * Why a payment dated `paidAt` cannot be recorded against a document dated
 * `documentDate`, in words the person recording it can act on. Null when the
 * date is fine.
 *
 * The rule is the same for money in and money out: a payment is never dated
 * before the invoice or bill it settles. Money that really moved earlier is
 * recorded on the document's date.
 */
export function paymentDateProblem(
  document: { number: string; kind: 'invoice' | 'bill'; date: Date | string },
  paidAt: Date | string,
): string | null {
  if (Number.isNaN(new Date(paidAt).getTime())) {
    return 'The payment date is not a valid date.';
  }
  if (!isBeforeDay(paidAt, document.date)) return null;
  const earliest = utcDay(document.date);
  return document.kind === 'invoice'
    ? `${document.number} was issued on ${earliest}, so a payment on it cannot be dated ${utcDay(paidAt)}. Use ${earliest} or later. If the money arrived before the invoice was raised, record it on ${earliest}.`
    : `${document.number} is dated ${earliest}, so a payment on it cannot be dated ${utcDay(paidAt)}. Use ${earliest} or later. If you paid before the bill was dated, record the payment on ${earliest}.`;
}
