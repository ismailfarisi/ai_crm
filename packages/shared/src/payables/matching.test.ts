import { describe, it, expect } from 'vitest';
import { isBalanced } from '../finance/ledger';
import {
  agingBucket,
  billPostingLines,
  billTotals,
  canTransitionBill,
  daysOverdue,
  evaluateLineMatch,
  summariseMatch,
} from './matching';

const ordered = (over: Partial<{ unitCost: number; qtyReceived: number; qtyBilledElsewhere: number }> = {}) => ({
  unitCost: 0.42,
  qtyReceived: 500,
  qtyBilledElsewhere: 0,
  ...over,
});

describe('evaluateLineMatch', () => {
  it('matches a bill that agrees with the order and the receipt', () => {
    expect(
      evaluateLineMatch({ description: 'Board', qty: 500, unitCost: 0.42, orderLine: ordered() }, 0),
    ).toEqual([]);
  });

  it('refuses quantity beyond what arrived, with no tolerance', () => {
    // Billing for goods that are not in the building is the case the whole
    // check exists for.
    const v = evaluateLineMatch(
      { description: 'Board', qty: 501, unitCost: 0.42, orderLine: ordered() },
      0.5,
    );
    expect(v.map((x) => x.code)).toEqual(['QTY_EXCEEDS_RECEIVED']);
    expect(v[0].limit).toBe(500);
    expect(v[0].overridable).toBe(false);
  });

  it('counts quantity already billed on another bill', () => {
    const v = evaluateLineMatch(
      { description: 'Board', qty: 300, unitCost: 0.42, orderLine: ordered({ qtyBilledElsewhere: 250 }) },
      0,
    );
    expect(v[0].code).toBe('QTY_EXCEEDS_RECEIVED');
    expect(v[0].limit).toBe(250);
  });

  it('says so plainly when there is nothing left to bill', () => {
    const v = evaluateLineMatch(
      { description: 'Board', qty: 1, unitCost: 0.42, orderLine: ordered({ qtyBilledElsewhere: 500 }) },
      0,
    );
    expect(v[0].message).toContain('nothing left to bill');
  });

  it('accepts a price inside the tolerance', () => {
    // 0.42 × 1.05 = 0.441
    expect(
      evaluateLineMatch({ description: 'Board', qty: 500, unitCost: 0.441, orderLine: ordered() }, 0.05),
    ).toEqual([]);
  });

  it('flags a price outside the tolerance and names both prices', () => {
    // 8% over, against a 5% tolerance.
    const v = evaluateLineMatch(
      { description: 'Board', qty: 500, unitCost: 0.4536, orderLine: ordered() },
      0.05,
    );
    expect(v.map((x) => x.code)).toEqual(['PRICE_OUTSIDE_TOLERANCE']);
    expect(v[0].message).toContain('8.0% above');
    expect(v[0].message).toContain('0.4200');
    expect(v[0].overridable).toBe(true);
  });

  it('does not flag a bill below the ordered price', () => {
    expect(
      evaluateLineMatch({ description: 'Board', qty: 500, unitCost: 0.3, orderLine: ordered() }, 0),
    ).toEqual([]);
  });

  it('has nothing to say about a line with no order behind it', () => {
    expect(evaluateLineMatch({ description: 'Electricity', qty: 1, unitCost: 412 }, 0)).toEqual([]);
  });
});

describe('summariseMatch', () => {
  it('is UNMATCHED when nothing links to an order', () => {
    expect(summariseMatch([{ description: 'Rent', qty: 1, unitCost: 1500 }], 0).status).toBe('UNMATCHED');
  });

  it('is VARIANCE if any single line is out, and says which', () => {
    const result = summariseMatch(
      [
        { description: 'Board', qty: 500, unitCost: 0.42, orderLine: ordered() },
        { description: 'Magnets', qty: 2000, unitCost: 0.05, orderLine: ordered({ unitCost: 0.05, qtyReceived: 1000 }) },
      ],
      0,
    );
    expect(result.status).toBe('VARIANCE');
    expect(result.variances[0].lineIndex).toBe(1);
  });

  it('is MATCHED when every linked line agrees', () => {
    expect(
      summariseMatch([{ description: 'Board', qty: 500, unitCost: 0.42, orderLine: ordered() }], 0).status,
    ).toBe('MATCHED');
  });
});

describe('billPostingLines', () => {
  const ref = { billNumber: 'BILL-2026-0001', supplierName: 'Papertree Ltd' };
  const code = (lines: ReturnType<typeof billPostingLines>) =>
    lines.map((l) => `${l.role}:${l.debit}/${l.credit}`);

  it('clears GRNI exactly and credits payables for a matched bill', () => {
    const lines = billPostingLines([{ description: 'Board', qty: 500, unitCost: 0.42, orderUnitCost: 0.42 }], 0, ref);
    expect(code(lines)).toEqual(['GRNI:210/0', 'ACCOUNTS_PAYABLE:0/210']);
    expect(isBalanced(lines)).toBe(true);
  });

  it('sends a dearer bill’s difference to price variance', () => {
    // Receipt credited GRNI at 210; the supplier bills 225. GRNI must clear at
    // 210, or it never returns to zero.
    const lines = billPostingLines([{ description: 'Board', qty: 500, unitCost: 0.45, orderUnitCost: 0.42 }], 0, ref);
    expect(code(lines)).toEqual(['GRNI:210/0', 'COGS:15/0', 'ACCOUNTS_PAYABLE:0/225']);
    expect(isBalanced(lines)).toBe(true);
  });

  it('credits variance when the bill is cheaper than ordered', () => {
    const lines = billPostingLines([{ description: 'Board', qty: 500, unitCost: 0.4, orderUnitCost: 0.42 }], 0, ref);
    expect(code(lines)).toEqual(['GRNI:210/0', 'COGS:0/10', 'ACCOUNTS_PAYABLE:0/200']);
    expect(isBalanced(lines)).toBe(true);
  });

  it('debits operating expense for a line with no order', () => {
    const lines = billPostingLines([{ description: 'Electricity', qty: 1, unitCost: 412.5 }], 82.5, ref);
    expect(code(lines)).toEqual(['OPERATING_EXPENSE:412.5/0', 'TAX_PAYABLE:82.5/0', 'ACCOUNTS_PAYABLE:0/495']);
    expect(isBalanced(lines)).toBe(true);
  });

  it('balances a mixed bill with tax', () => {
    const lines = billPostingLines(
      [
        { description: 'Board', qty: 500, unitCost: 0.45, orderUnitCost: 0.42 },
        { description: 'Carriage', qty: 1, unitCost: 25 },
      ],
      50,
      ref,
    );
    expect(isBalanced(lines)).toBe(true);
    expect(lines.find((l) => l.role === 'ACCOUNTS_PAYABLE')?.credit).toBe(300);
  });

  it('stays balanced across awkward unit costs', () => {
    const lines = billPostingLines(
      [
        { description: 'A', qty: 3, unitCost: 0.3333, orderUnitCost: 0.3332 },
        { description: 'B', qty: 7, unitCost: 1.0001, orderUnitCost: 1 },
      ],
      0.01,
      ref,
    );
    expect(isBalanced(lines)).toBe(true);
  });
});

describe('billTotals', () => {
  it('rounds each line to the cent before summing', () => {
    expect(billTotals([{ qty: 3, unitCost: 0.3333 }, { qty: 3, unitCost: 0.3333 }], 0)).toEqual({
      subtotal: 2,
      tax: 0,
      total: 2,
    });
  });
});

describe('aging', () => {
  const asOf = new Date('2026-09-15T10:00:00Z');

  it('treats a bill due today as current', () => {
    expect(agingBucket('2026-09-15T23:00:00Z', asOf)).toBe('CURRENT');
    expect(daysOverdue('2026-09-15T00:00:00Z', asOf)).toBe(0);
  });

  it.each([
    ['2026-09-14', 'DAYS_1_30'],
    ['2026-08-16', 'DAYS_1_30'],
    ['2026-08-15', 'DAYS_31_60'],
    ['2026-07-17', 'DAYS_31_60'],
    ['2026-07-16', 'DAYS_61_90'],
    ['2026-06-17', 'DAYS_61_90'],
    ['2026-06-16', 'DAYS_OVER_90'],
  ])('due %s is %s', (due, bucket) => {
    expect(agingBucket(`${due}T12:00:00Z`, asOf)).toBe(bucket);
  });

  it('counts a bill with no due date as current rather than guessing', () => {
    expect(agingBucket(null, asOf)).toBe('CURRENT');
  });
});

describe('BILL_TRANSITIONS', () => {
  it('will not let a cancelled bill come back', () => {
    expect(canTransitionBill('CANCELLED', 'DRAFT')).toBe(false);
  });

  it('will not cancel an approved bill, which has already posted', () => {
    expect(canTransitionBill('APPROVED', 'CANCELLED')).toBe(false);
  });

  it('lets a disputed bill be corrected and resubmitted', () => {
    expect(canTransitionBill('DISPUTED', 'DRAFT')).toBe(true);
  });
});

import { LEDGER_ROLES } from '../finance/ledger';

describe('billPostingLines — categories and spreading', () => {
  const ref = { billNumber: 'BILL-2026-0001', supplierName: 'Landlord LLC' };
  const sum = (ls: ReturnType<typeof billPostingLines>, k: 'debit' | 'credit') =>
    Math.round(ls.reduce((s, l) => s + l[k], 0) * 100) / 100;

  it('debits each unmatched line to its category role, grouped', () => {
    const lines = billPostingLines([
      { description: 'DEWA Jan', qty: 1, unitCost: 800, category: 'Utilities & Telecom' },
      { description: 'Du Jan', qty: 1, unitCost: 200, category: 'Utilities' },
      { description: 'Cardboard', qty: 1, unitCost: 500, category: 'Packaging' },
    ], 0, ref);
    expect(lines.find((l) => l.role === LEDGER_ROLES.UTILITIES)!.debit).toBe(1000);
    expect(lines.find((l) => l.role === LEDGER_ROLES.COGS)!.debit).toBe(500);
    expect(lines.some((l) => l.role === LEDGER_ROLES.OPERATING_EXPENSE)).toBe(false);
  });

  it('keeps an uncategorised line on operating expense', () => {
    const lines = billPostingLines([{ description: 'Electricity', qty: 1, unitCost: 412.5 }], 0, ref);
    expect(lines.find((l) => l.role === LEDGER_ROLES.OPERATING_EXPENSE)!.debit).toBe(412.5);
  });

  it('debits a multi-month line to prepaid expenses instead of its category', () => {
    const lines = billPostingLines([
      { description: 'Lease 2026', qty: 1, unitCost: 120_000, category: 'Rent & premises', servicePeriodStart: '2026-01-01', servicePeriodEnd: '2026-12-31' },
    ], 0, ref);
    expect(lines.find((l) => l.role === LEDGER_ROLES.PREPAID_EXPENSES)!.debit).toBe(120_000);
    expect(lines.some((l) => l.role === LEDGER_ROLES.RENT)).toBe(false);
  });

  it('expenses a one-month service period directly', () => {
    const lines = billPostingLines([
      { description: 'Rent March', qty: 1, unitCost: 10_000, category: 'Rent & premises', servicePeriodStart: '2026-03-01', servicePeriodEnd: '2026-03-31' },
    ], 0, ref);
    expect(lines.find((l) => l.role === LEDGER_ROLES.RENT)!.debit).toBe(10_000);
    expect(lines.find((l) => l.role === LEDGER_ROLES.RENT)!.accountName).toBe('Rent & premises');
  });

  it('mixed bill balances', () => {
    const lines = billPostingLines([
      { description: 'Board', qty: 500, unitCost: 0.45, orderUnitCost: 0.42 },
      { description: 'Insurance 2026', qty: 1, unitCost: 6000, category: 'Insurance', servicePeriodStart: '2026-01-01', servicePeriodEnd: '2026-12-31' },
      { description: 'Repairs', qty: 1, unitCost: 300, category: 'Repairs & maintenance' },
    ], 315, ref);
    expect(sum(lines, 'debit')).toBe(sum(lines, 'credit'));
    expect(lines.find((l) => l.role === LEDGER_ROLES.ACCOUNTS_PAYABLE)!.credit).toBe(6840);
  });
});
