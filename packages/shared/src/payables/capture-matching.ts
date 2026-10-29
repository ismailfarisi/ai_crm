import type {
  BillCaptureWarning,
  CapturedInvoice,
  CapturedInvoiceLine,
  CapturedLineMatch,
} from './capture';

/**
 * Pairing what an invoice says with what Kerf already knows.
 *
 * Everything here is deliberately cautious: a wrong pairing is worse than
 * none, because a person checking a pre-filled form trusts it. When two
 * answers are close, the functions return candidates and let someone choose.
 */

/** Trailing words that differ between how a supplier prints its name and how it was typed in. */
const LEGAL_SUFFIXES = new Set([
  'llc',
  'fze',
  'fzc',
  'fzco',
  'fz',
  'est',
  'establishment',
  'trading',
  'co',
  'company',
  'ltd',
  'limited',
  'inc',
  'plc',
  'wll',
  'spc',
  'llp',
]);

const words = (s: string): string[] =>
  s
    .toLowerCase()
    .replace(/\./g, '')
    .split(/[^a-z0-9؀-ۿ]+/)
    .filter(Boolean);

export function normaliseCompanyName(name: string): string {
  const tokens = words(name);
  while (tokens.length > 1 && LEGAL_SUFFIXES.has(tokens[tokens.length - 1])) {
    tokens.pop();
  }
  return tokens.join(' ');
}

const jaccard = (a: Set<string>, b: Set<string>): number => {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const t of a) if (b.has(t)) shared++;
  return shared / (a.size + b.size - shared);
};

const digitsOf = (s: string | null | undefined): string => (s ?? '').replace(/\D/g, '');

export interface SupplierForMatch {
  id: string;
  companyName: string;
  taxId: string | null;
}

/** Below this, a supplier is not worth offering as a candidate. */
const SUPPLIER_CANDIDATE_SCORE = 0.3;

export function matchSupplier<S extends SupplierForMatch>(
  printed: { name: string | null; taxId: string | null },
  suppliers: S[],
): { match: S | null; candidates: S[] } {
  // A tax registration number identifies a business; a name only suggests one.
  const taxDigits = digitsOf(printed.taxId);
  if (taxDigits.length >= 8) {
    const byTax = suppliers.find((s) => digitsOf(s.taxId) === taxDigits);
    if (byTax) return { match: byTax, candidates: [] };
  }

  if (!printed.name) return { match: null, candidates: [] };
  const wanted = normaliseCompanyName(printed.name);
  const exact = suppliers.filter((s) => normaliseCompanyName(s.companyName) === wanted);
  if (exact.length === 1) return { match: exact[0], candidates: [] };
  if (exact.length > 1) return { match: null, candidates: exact };

  const wantedTokens = new Set(wanted.split(' '));
  const candidates = suppliers
    .map((s) => ({
      s,
      score: jaccard(wantedTokens, new Set(normaliseCompanyName(s.companyName).split(' '))),
    }))
    .filter((c) => c.score >= SUPPLIER_CANDIDATE_SCORE)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map((c) => c.s);
  return { match: null, candidates };
}

export interface OrderForMatch {
  id: string;
  poNumber: string;
}

const alnumKey = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');
const lastDigitGroup = (s: string): string | null => {
  const groups = s.match(/\d+/g);
  return groups ? groups[groups.length - 1] : null;
};

/**
 * Our order, from the reference the supplier printed.
 *
 * Suppliers copy PO numbers loosely — "PO 2026/0031", "Your PO 31" — so the
 * full number is compared without punctuation, then the last group of digits
 * on its own, but only when exactly one order ends that way.
 */
export function matchOrderReference<O extends OrderForMatch>(
  reference: string | null,
  orders: O[],
): O | null {
  if (!reference) return null;
  const key = alnumKey(reference);
  const exact = orders.find((o) => alnumKey(o.poNumber) === key);
  if (exact) return exact;

  const tail = lastDigitGroup(reference);
  if (!tail || tail.length < 2) return null;
  const n = Number(tail);
  const byTail = orders.filter((o) => {
    const t = lastDigitGroup(o.poNumber);
    return t != null && Number(t) === n;
  });
  return byTail.length === 1 ? byTail[0] : null;
}

/** Description words, with sizes split from units so "64cm" meets "64 CM". */
const descriptionTokens = (s: string): Set<string> =>
  new Set(
    s
      .toLowerCase()
      .replace(/(\d)([a-z])/g, '$1 $2')
      .replace(/([a-z])(\d)/g, '$1 $2')
      .split(/[^a-z0-9؀-ۿ]+/)
      .filter((t) => t.length > 1 || /\d/.test(t)),
  );

const dice = (a: Set<string>, b: Set<string>): number => {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const t of a) if (b.has(t)) shared++;
  return (2 * shared) / (a.size + b.size);
};

const closeness = (a: number, b: number): number => {
  const scale = Math.max(Math.abs(a), Math.abs(b));
  if (scale === 0) return 1;
  return 1 - Math.min(1, Math.abs(a - b) / scale);
};

export interface BillableLineForMatch {
  purchaseOrderLineId: string;
  description: string;
  qtyBillable: number;
  orderUnitCost: number;
}

/**
 * Below this a pairing is not offered. Price and quantity alone can reach
 * 0.4, so a pairing always needs some agreement in the description.
 */
const LINE_MATCH_SCORE = 0.45;

/**
 * Pairs invoice lines with order lines, best pairs first, one-to-one.
 *
 * An order line with nothing left to bill is still a candidate: pairing it
 * lets the three-way match say "already billed" instead of the line quietly
 * becoming an unordered charge.
 */
export function matchInvoiceLines(
  invoiceLines: CapturedInvoiceLine[],
  billable: BillableLineForMatch[],
): CapturedLineMatch[] {
  const orderTokens = billable.map((b) => descriptionTokens(b.description));
  const pairs: { i: number; j: number; score: number }[] = [];
  invoiceLines.forEach((line, i) => {
    const tokens = descriptionTokens(line.description);
    billable.forEach((b, j) => {
      const score =
        0.6 * dice(tokens, orderTokens[j]) +
        0.25 * closeness(line.unitCost, b.orderUnitCost) +
        0.15 * closeness(line.qty, b.qtyBillable);
      if (score >= LINE_MATCH_SCORE) pairs.push({ i, j, score });
    });
  });
  pairs.sort((a, b) => b.score - a.score);

  const result: CapturedLineMatch[] = invoiceLines.map((_, index) => ({
    index,
    purchaseOrderLineId: null,
    score: 0,
  }));
  const usedOrderLines = new Set<number>();
  for (const { i, j, score } of pairs) {
    if (result[i].purchaseOrderLineId || usedOrderLines.has(j)) continue;
    usedOrderLines.add(j);
    result[i] = {
      index: i,
      purchaseOrderLineId: billable[j].purchaseOrderLineId,
      score: Math.round(score * 100) / 100,
    };
  }
  return result;
}

const fmt = (n: number) => n.toFixed(2);

/**
 * Whether the document is internally consistent. A misread digit usually
 * shows up here first, so it is worth saying before anyone saves the bill.
 */
export function invoiceArithmeticWarnings(
  invoice: Pick<CapturedInvoice, 'lines' | 'subtotalAmount' | 'taxAmount' | 'totalAmount'>,
): BillCaptureWarning[] {
  const warnings: BillCaptureWarning[] = [];
  const sum = invoice.lines.reduce((acc, l) => acc + l.lineTotal, 0);
  // Each printed line total is already rounded, so allow a cent per line.
  const tolerance = 0.05 + invoice.lines.length * 0.01;

  if (invoice.subtotalAmount != null && Math.abs(sum - invoice.subtotalAmount) > tolerance) {
    warnings.push({
      code: 'LINES_DO_NOT_ADD_UP',
      message: `The lines add up to ${fmt(sum)}, but the invoice's subtotal is ${fmt(invoice.subtotalAmount)}. A line may have been misread or missed.`,
    });
  }

  const base = invoice.subtotalAmount ?? sum;
  const expected = base + (invoice.taxAmount ?? 0);
  if (invoice.totalAmount != null && Math.abs(expected - invoice.totalAmount) > tolerance) {
    warnings.push({
      code: 'TOTAL_DOES_NOT_ADD_UP',
      message: `${fmt(base)} plus ${fmt(invoice.taxAmount ?? 0)} tax is ${fmt(expected)}, but the invoice total is ${fmt(invoice.totalAmount)}.`,
    });
  }
  return warnings;
}
