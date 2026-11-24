import { describe, expect, it } from 'vitest';
import {
  describeExpenseClaimTax,
  expenseClaimPostingLines,
  expenseClaimTax,
  expenseClaimTaxProblem,
  expenseTaxCodeLabel,
  suggestExpenseTaxCode,
  vatIncludedIn,
} from './expense-tax';
import { LEDGER_ROLES, isBalanced } from './ledger';

const SR = { rate: 5, isReverseCharge: false, treatment: 'STANDARD' as const };
const BL = { rate: 5, isReverseCharge: false, treatment: 'BLOCKED' as const };
const ZR = { rate: 0, isReverseCharge: false, treatment: 'ZERO_RATED' as const };
const RC = { rate: 5, isReverseCharge: true, treatment: 'REVERSE_CHARGE' as const };
const claim = { label: 'EXP-1', category: 'Travel', expenseRole: LEDGER_ROLES.TRAVEL };
const VALID_TRN = '100123456700003';

describe('VAT on an expense claim', () => {
  it('finds the VAT inside a VAT-inclusive total', () => {
    expect(vatIncludedIn(210, 5)).toBe(10);
    expect(vatIncludedIn(99.99, 5)).toBe(4.76);
    expect(vatIncludedIn(210, 0)).toBe(0);
  });

  // The default: a claim with no code is the claim that existed before codes.
  it('carries no VAT without a tax code, whatever amount is stated', () => {
    expect(expenseClaimTax(210, 10, null)).toEqual({
      gross: 210, tax: 0, recoverable: 0, selfAssessed: 0, cost: 210, net: 210, blocked: false,
    });
  });

  it('claims back standard-rated VAT and leaves the net as the cost', () => {
    expect(expenseClaimTax(210, 10, SR)).toMatchObject({
      gross: 210, tax: 10, recoverable: 10, cost: 200, net: 200, blocked: false,
    });
  });

  it('works the VAT out from the rate when the receipt amount is not given', () => {
    expect(expenseClaimTax(210, null, SR).tax).toBe(10);
    expect(expenseClaimTax(210, undefined, SR).recoverable).toBe(10);
  });

  it('keeps a smaller stated VAT: a receipt can mix taxed and untaxed items', () => {
    expect(expenseClaimTax(210, 6.5, SR)).toMatchObject({ tax: 6.5, recoverable: 6.5, cost: 203.5 });
  });

  it('keeps blocked VAT in the cost', () => {
    expect(expenseClaimTax(210, 10, BL)).toMatchObject({
      tax: 10, recoverable: 0, cost: 210, net: 200, blocked: true,
    });
  });

  it('has no VAT on a 0% code', () => {
    expect(expenseClaimTax(210, null, ZR)).toMatchObject({ tax: 0, recoverable: 0, cost: 210 });
  });

  it('self-assesses a reverse-charge claim on the full amount', () => {
    expect(expenseClaimTax(200, null, RC)).toMatchObject({
      tax: 0, recoverable: 0, selfAssessed: 10, cost: 200,
    });
  });
});

describe('expenseClaimTaxProblem', () => {
  const uae = { uae: true, supplierTaxId: VALID_TRN };

  it('accepts a claim with no code', () => {
    expect(expenseClaimTaxProblem(210, 0, null, { uae: true, supplierTaxId: null })).toBeNull();
  });

  it('accepts recoverable VAT with the supplier tax number', () => {
    expect(expenseClaimTaxProblem(210, 10, SR, uae)).toBeNull();
  });

  it('refuses to claim VAT back in the UAE without the supplier tax number', () => {
    expect(expenseClaimTaxProblem(210, 10, SR, { uae: true, supplierTaxId: null })).toMatch(/tax number \(TRN\)/);
    expect(expenseClaimTaxProblem(210, 10, SR, { uae: true, supplierTaxId: '12345' })).toMatch(/15 digits/);
  });

  it('does not ask for a tax number outside UAE VAT mode, or for VAT that is not claimed', () => {
    expect(expenseClaimTaxProblem(210, 10, SR, { uae: false, supplierTaxId: null })).toBeNull();
    expect(expenseClaimTaxProblem(210, 10, BL, { uae: true, supplierTaxId: null })).toBeNull();
    expect(expenseClaimTaxProblem(200, 0, RC, { uae: true, supplierTaxId: null })).toBeNull();
  });

  it('refuses more VAT than the rate allows on the total', () => {
    expect(expenseClaimTaxProblem(210, 25, SR, uae)).toMatch(/cannot be more than 10\.00/);
    // A cent of rounding on the receipt is not an error.
    expect(expenseClaimTaxProblem(210, 10.01, SR, uae)).toBeNull();
  });

  it('refuses a VAT amount on a code that has none', () => {
    expect(expenseClaimTaxProblem(210, 10, ZR, uae)).toMatch(/no VAT on the receipt/);
    expect(expenseClaimTaxProblem(210, 10, RC, uae)).toMatch(/no VAT on the receipt/);
  });
});

describe('expenseClaimPostingLines', () => {
  const byRole = (lines: ReturnType<typeof expenseClaimPostingLines>, role: string) =>
    lines.filter((l) => l.role === role);

  it('posts a claim with no VAT exactly as before: cost against the payable', () => {
    const lines = expenseClaimPostingLines(claim, expenseClaimTax(210, 0, null));
    expect(lines).toEqual([
      { role: LEDGER_ROLES.TRAVEL, accountName: 'Travel', debit: 210, credit: 0, description: 'Expense claim EXP-1 — Travel' },
      { role: LEDGER_ROLES.ACCOUNTS_PAYABLE, accountName: 'Accounts payable', debit: 0, credit: 210, description: 'Payable for expense claim EXP-1' },
    ]);
  });

  it('splits recoverable VAT to the tax account and still owes the employee the gross', () => {
    const lines = expenseClaimPostingLines(claim, expenseClaimTax(210, 10, SR));
    expect(isBalanced(lines)).toBe(true);
    expect(byRole(lines, LEDGER_ROLES.TRAVEL)[0].debit).toBe(200);
    expect(byRole(lines, LEDGER_ROLES.TAX_PAYABLE)).toEqual([
      expect.objectContaining({ accountName: 'Input tax', debit: 10, credit: 0 }),
    ]);
    expect(byRole(lines, LEDGER_ROLES.ACCOUNTS_PAYABLE)[0].credit).toBe(210);
  });

  it('never sends blocked VAT to the tax account', () => {
    const lines = expenseClaimPostingLines(claim, expenseClaimTax(210, 10, BL));
    expect(byRole(lines, LEDGER_ROLES.TAX_PAYABLE)).toHaveLength(0);
    expect(byRole(lines, LEDGER_ROLES.TRAVEL)[0].debit).toBe(210);
    expect(byRole(lines, LEDGER_ROLES.ACCOUNTS_PAYABLE)[0].credit).toBe(210);
  });

  it('debits and credits the tax account for a reverse-charge claim', () => {
    const lines = expenseClaimPostingLines(claim, expenseClaimTax(200, null, RC));
    expect(isBalanced(lines)).toBe(true);
    const tax = byRole(lines, LEDGER_ROLES.TAX_PAYABLE);
    expect(tax.map((l) => [l.debit, l.credit])).toEqual([[10, 0], [0, 10]]);
    expect(byRole(lines, LEDGER_ROLES.ACCOUNTS_PAYABLE)[0].credit).toBe(200);
  });
});

describe('describeExpenseClaimTax', () => {
  const money = (n: number) => `AED ${n.toFixed(2)}`;

  it('says in plain words what happens to the VAT', () => {
    expect(describeExpenseClaimTax(expenseClaimTax(210, 0, null), money)).toBe(
      'No VAT is claimed back on this expense.',
    );
    expect(describeExpenseClaimTax(expenseClaimTax(210, 10, SR), money)).toBe(
      'Includes AED 10.00 of VAT, which is claimed back from the tax authority. The cost to the business is AED 200.00.',
    );
    expect(describeExpenseClaimTax(expenseClaimTax(210, 10, BL), money)).toBe(
      'Includes AED 10.00 of VAT that cannot be claimed back, so it stays part of the cost.',
    );
    expect(describeExpenseClaimTax(expenseClaimTax(200, null, RC), money)).toMatch(/charged no VAT/);
  });
});

describe('suggestExpenseTaxCode', () => {
  const codes = [
    { id: 'sr', ...SR },
    { id: 'bl', ...BL },
    { id: 'zr', ...ZR },
    { id: 'rc', ...RC },
  ];

  it('suggests the standard code when a UAE receipt shows VAT and a valid tax number', () => {
    const receipt = { amount: 210, taxAmount: 10, supplierTaxId: '100-1234-5670-0003', category: 'Travel' };
    expect(suggestExpenseTaxCode(codes, receipt, true)?.id).toBe('sr');
  });

  it('suggests nothing without VAT on the receipt, or without the tax number', () => {
    expect(suggestExpenseTaxCode(codes, { amount: 210, taxAmount: 0, supplierTaxId: VALID_TRN }, true)).toBeNull();
    expect(suggestExpenseTaxCode(codes, { amount: 210, taxAmount: 10, supplierTaxId: null }, true)).toBeNull();
    expect(suggestExpenseTaxCode(codes, { amount: 210, taxAmount: 10, supplierTaxId: '123' }, true)).toBeNull();
  });

  it('starts entertainment on the blocked code', () => {
    const receipt = { amount: 210, taxAmount: 10, supplierTaxId: VALID_TRN, category: 'Meals & Entertainment' };
    expect(suggestExpenseTaxCode(codes, receipt, true)?.id).toBe('bl');
  });

  it('skips codes that are switched off', () => {
    const off = codes.map((c) => (c.id === 'sr' ? { ...c, isActive: false } : c));
    expect(suggestExpenseTaxCode(off, { amount: 210, taxAmount: 10, supplierTaxId: VALID_TRN }, true)).toBeNull();
  });

  it('outside the UAE suggests a code only when one rate explains the VAT', () => {
    const eu = [
      { id: 'v20', rate: 20, isReverseCharge: false, treatment: null },
      { id: 'v5', rate: 5, isReverseCharge: false, treatment: null },
    ];
    expect(suggestExpenseTaxCode(eu, { amount: 120, taxAmount: 20, supplierTaxId: null }, false)?.id).toBe('v20');
    expect(suggestExpenseTaxCode(eu, { amount: 120, taxAmount: 11, supplierTaxId: null }, false)).toBeNull();
  });
});

describe('expenseTaxCodeLabel', () => {
  it('says what each code does with the VAT', () => {
    expect(expenseTaxCodeLabel({ name: 'Standard rated 5%', ...SR })).toBe('Standard rated 5% (VAT is claimed back)');
    expect(expenseTaxCodeLabel({ name: 'Blocked input VAT 5%', ...BL })).toBe('Blocked input VAT 5% (VAT cannot be claimed back)');
    expect(expenseTaxCodeLabel({ name: 'Zero rated', ...ZR })).toBe('Zero rated (no VAT to claim)');
    expect(expenseTaxCodeLabel({ name: 'Reverse charge 5%', ...RC })).toBe('Reverse charge 5% (supplier charged no VAT)');
  });
});
