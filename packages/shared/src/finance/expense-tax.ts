/**
 * VAT on an expense claim.
 *
 * A claim states what the employee paid, VAT included, and that is what they
 * are owed. The tax code says what the VAT inside it is worth to the
 * business: claimed back (input tax), a cost (blocked, e.g. entertainment),
 * or self-assessed (reverse charge on a foreign supplier). With no code a
 * claim carries no VAT at all, which is how every claim worked before codes
 * reached them.
 */
import { LEDGER_ROLES, type JournalLineInput, type LedgerRole } from './ledger';
import { isValidTrn, type VatTreatment } from '../tax/uae';
import { reverseChargeTax } from '../tax/vat201';

const cents = (n: number) => Math.round(((Number(n) || 0) + Number.EPSILON) * 100);

export interface ExpenseTaxCodeLike {
  rate: number;
  isReverseCharge: boolean;
  treatment?: VatTreatment | null;
}

export interface ExpenseClaimTax {
  /** What the employee paid and is owed, VAT included. */
  gross: number;
  /** The VAT inside `gross`, as the receipt shows it. */
  tax: number;
  /** The part of `tax` the business claims back. */
  recoverable: number;
  /** VAT the business accounts for itself on a reverse-charge purchase. */
  selfAssessed: number;
  /** What lands in the expense account: `gross` less `recoverable`. */
  cost: number;
  /** `gross` less `tax`: the value of the purchase before VAT. */
  net: number;
  /** The VAT was paid but the law does not let it be claimed back. */
  blocked: boolean;
}

/** The VAT inside a VAT-inclusive amount at `rate` percent. */
export function vatIncludedIn(gross: number, rate: number): number {
  const r = Math.max(0, Number(rate) || 0);
  if (r === 0) return 0;
  return Math.round((cents(gross) * r) / (100 + r)) / 100;
}

/**
 * Splits a claim into cost and VAT.
 *
 * `taxAmount` is what the receipt prints; left out, it is worked out from the
 * code's rate. A reverse-charge code means the supplier charged none, and a
 * 0% code has none to state.
 */
export function expenseClaimTax(
  gross: number,
  taxAmount: number | null | undefined,
  code: ExpenseTaxCodeLike | null | undefined,
): ExpenseClaimTax {
  const grossC = Math.max(0, cents(gross));
  const none: ExpenseClaimTax = {
    gross: grossC / 100,
    tax: 0,
    recoverable: 0,
    selfAssessed: 0,
    cost: grossC / 100,
    net: grossC / 100,
    blocked: false,
  };
  if (!code) return none;
  const rate = Math.max(0, Number(code.rate) || 0);
  if (code.isReverseCharge) {
    return { ...none, selfAssessed: reverseChargeTax(grossC / 100, rate) };
  }
  if (rate === 0) return none;

  const stated = cents(taxAmount ?? 0);
  const taxC = stated > 0 ? stated : cents(vatIncludedIn(grossC / 100, rate));
  const blocked = code.treatment === 'BLOCKED';
  const recoverableC = blocked ? 0 : taxC;
  return {
    gross: grossC / 100,
    tax: taxC / 100,
    recoverable: recoverableC / 100,
    selfAssessed: 0,
    cost: (grossC - recoverableC) / 100,
    net: (grossC - taxC) / 100,
    blocked,
  };
}

/**
 * Why a claim's VAT cannot be accepted as entered, in words for the person
 * filling in the form, or null when it can.
 *
 * `uae` is UAE VAT mode: there, VAT is only claimed back against a receipt
 * that shows the supplier's tax registration number.
 */
export function expenseClaimTaxProblem(
  gross: number,
  taxAmount: number | null | undefined,
  code: ExpenseTaxCodeLike | null | undefined,
  context: { uae: boolean; supplierTaxId: string | null | undefined },
): string | null {
  if (!code) return null;
  const rate = Math.max(0, Number(code.rate) || 0);
  const stated = cents(taxAmount ?? 0);
  if (stated < 0) return 'The VAT amount cannot be negative.';
  if (code.isReverseCharge || rate === 0) {
    return stated > 0
      ? 'This VAT type has no VAT on the receipt. Remove the VAT amount, or choose the type that matches the receipt.'
      : null;
  }
  // A receipt can mix taxed and untaxed items, so less is fine; more is not.
  const most = cents(vatIncludedIn(gross, rate));
  if (stated > most + 1) {
    return `The VAT cannot be more than ${(most / 100).toFixed(2)}, which is ${rate}% VAT on a total of ${(cents(gross) / 100).toFixed(2)}. Check the VAT amount on the receipt.`;
  }
  const split = expenseClaimTax(gross, taxAmount, code);
  if (context.uae && split.recoverable > 0 && !isValidTrn(context.supplierTaxId)) {
    return 'To claim this VAT back, enter the supplier\u2019s tax number (TRN) from the receipt: 15 digits. If the receipt does not show one, choose "No VAT".';
  }
  return null;
}

/**
 * The journal lines for an approved claim, in the claim's currency.
 *
 * The employee is owed the gross whatever the VAT treatment. Recoverable VAT
 * goes to the tax account the way a bill's input tax does and the rest is the
 * cost; blocked VAT stays in the cost. A reverse-charge claim debits and
 * credits the tax account by the self-assessed amount.
 */
export function expenseClaimPostingLines(
  claim: { label: string; category: string | null; expenseRole: LedgerRole },
  tax: ExpenseClaimTax,
): JournalLineInput[] {
  const out: JournalLineInput[] = [
    {
      role: claim.expenseRole,
      accountName: claim.category || 'Operating expense',
      debit: tax.cost,
      credit: 0,
      description: `Expense claim ${claim.label} — ${claim.category ?? 'uncategorised'}`,
    },
  ];
  if (tax.recoverable !== 0) {
    out.push({
      role: LEDGER_ROLES.TAX_PAYABLE,
      accountName: 'Input tax',
      debit: tax.recoverable,
      credit: 0,
      description: `VAT to claim back on expense claim ${claim.label}`,
    });
  }
  if (tax.selfAssessed !== 0) {
    const description = `Reverse-charge VAT on expense claim ${claim.label}`;
    out.push(
      { role: LEDGER_ROLES.TAX_PAYABLE, accountName: 'Input tax (reverse charge)', debit: tax.selfAssessed, credit: 0, description },
      { role: LEDGER_ROLES.TAX_PAYABLE, accountName: 'Output tax (reverse charge)', debit: 0, credit: tax.selfAssessed, description },
    );
  }
  out.push({
    role: LEDGER_ROLES.ACCOUNTS_PAYABLE,
    accountName: 'Accounts payable',
    debit: 0,
    credit: tax.gross,
    description: `Payable for expense claim ${claim.label}`,
  });
  return out;
}

/**
 * What the VAT on a claim means, in a sentence a workshop owner can read.
 * `money` formats an amount in the claim's currency.
 */
export function describeExpenseClaimTax(
  tax: ExpenseClaimTax,
  money: (amount: number) => string,
): string {
  if (tax.selfAssessed > 0) {
    return `The supplier is abroad and charged no VAT. ${money(tax.selfAssessed)} of VAT is reported for it and claimed back in the same return, so nothing extra is paid.`;
  }
  if (tax.tax <= 0) return 'No VAT is claimed back on this expense.';
  if (tax.blocked) {
    return `Includes ${money(tax.tax)} of VAT that cannot be claimed back, so it stays part of the cost.`;
  }
  return `Includes ${money(tax.tax)} of VAT, which is claimed back from the tax authority. The cost to the business is ${money(tax.cost)}.`;
}

export interface ExpenseTaxCodeOption extends ExpenseTaxCodeLike {
  id: string;
  isActive?: boolean;
}

/**
 * The tax code a scanned receipt should start on, or null for "No VAT".
 *
 * Only when the receipt prints VAT. In UAE VAT mode the VAT is claimed back
 * only when the receipt also shows a valid supplier tax number; entertainment
 * starts on the blocked code, because that VAT is not recoverable and a
 * wrong claim is worse than a missed one. Elsewhere a code is suggested only
 * when exactly one rate explains the VAT printed. The claimant can change it.
 */
export function suggestExpenseTaxCode<T extends ExpenseTaxCodeOption>(
  codes: T[],
  receipt: {
    amount: number;
    taxAmount: number | null | undefined;
    supplierTaxId: string | null | undefined;
    category?: string | null;
  },
  uae: boolean,
): T | null {
  const tax = Number(receipt.taxAmount) || 0;
  if (tax <= 0 || !(receipt.amount > 0)) return null;
  const usable = codes.filter(
    (c) => c.isActive !== false && !c.isReverseCharge && Number(c.rate) > 0,
  );
  if (uae) {
    if (/entertain/i.test(receipt.category ?? '')) {
      const blocked = usable.find((c) => c.treatment === 'BLOCKED');
      if (blocked) return blocked;
    }
    if (!isValidTrn(receipt.supplierTaxId)) return null;
    return usable.find((c) => c.treatment === 'STANDARD') ?? null;
  }
  const explains = usable.filter(
    (c) =>
      c.treatment !== 'BLOCKED' &&
      Math.abs(vatIncludedIn(receipt.amount, Number(c.rate)) - tax) <= Math.max(0.02, tax * 0.02),
  );
  return explains.length === 1 ? explains[0] : null;
}

/** A tax code as a non-accountant reads it in the claim form's list. */
export function expenseTaxCodeLabel(code: ExpenseTaxCodeLike & { name: string }): string {
  if (code.treatment === 'BLOCKED') return `${code.name} (VAT cannot be claimed back)`;
  if (code.isReverseCharge) return `${code.name} (supplier charged no VAT)`;
  if (!(Number(code.rate) > 0)) return `${code.name} (no VAT to claim)`;
  return `${code.name} (VAT is claimed back)`;
}
