import { describe, expect, it } from 'vitest';
import { balanceAsOf, billBalanceAsOf, invoiceBalanceAsOf, isBeforeDay, paymentDateProblem } from './aging';

const day = (d: string) => new Date(`${d}T23:59:59.999Z`);

describe('balanceAsOf', () => {
  it('counts only changes dated on or before the day, to the cent', () => {
    const changes = [
      { at: '2026-03-01T09:00:00Z', amount: 0.1 },
      { at: '2026-03-02T09:00:00Z', amount: 0.2 },
      { at: '2026-03-05T09:00:00Z', amount: -0.3 },
      { at: null, amount: 99 },
    ];
    expect(balanceAsOf(changes, day('2026-03-02'))).toBe(0.3);
    expect(balanceAsOf(changes, day('2026-03-05'))).toBe(0);
    expect(balanceAsOf(changes, day('2026-02-28'))).toBe(0);
  });
});

describe('invoiceBalanceAsOf', () => {
  const invoice = { amount: 1050, issuedAt: '2026-03-01T09:00:00Z', paidAmount: 1050, status: 'PAID' };
  const history = {
    payments: [
      { amount: 400, paidAt: '2026-03-10T00:00:00Z' },
      { amount: 650, paidAt: '2026-03-20T00:00:00Z' },
    ],
    credits: [{ totalAmount: 105, issuedAt: '2026-03-25T10:00:00Z' }],
    refunds: [{ amount: 50, refundedAt: '2026-03-28T10:00:00Z' }],
  };

  it('is what was owed on each day, not what is owed now', () => {
    expect(invoiceBalanceAsOf(invoice, history, day('2026-02-28'))).toBe(0);
    expect(invoiceBalanceAsOf(invoice, history, day('2026-03-05'))).toBe(1050);
    expect(invoiceBalanceAsOf(invoice, history, day('2026-03-10'))).toBe(650);
    expect(invoiceBalanceAsOf(invoice, history, day('2026-03-20'))).toBe(0);
    expect(invoiceBalanceAsOf(invoice, history, day('2026-03-25'))).toBe(-105);
    expect(invoiceBalanceAsOf(invoice, history, day('2026-03-28'))).toBe(-55);
  });

  it('shows a payment dated before the invoice as money held, as the ledger does', () => {
    const early = { payments: [{ amount: 50, paidAt: '2026-01-20T00:00:00Z' }] };
    const inv = { amount: 50, issuedAt: '2026-03-01T09:00:00Z', paidAmount: 50, status: 'PAID' };
    expect(invoiceBalanceAsOf(inv, early, day('2026-02-01'))).toBe(-50);
    expect(invoiceBalanceAsOf(inv, early, day('2026-03-01'))).toBe(0);
  });

  it('counts a voided invoice until the day it was voided', () => {
    const voided = { amount: 500, issuedAt: '2026-03-01T09:00:00Z', paidAmount: 200, status: 'CANCELLED', voidedAt: '2026-03-15T12:00:00Z' };
    const paid = { payments: [{ amount: 200, paidAt: '2026-03-05T00:00:00Z' }] };
    expect(invoiceBalanceAsOf(voided, paid, day('2026-03-04'))).toBe(500);
    expect(invoiceBalanceAsOf(voided, paid, day('2026-03-10'))).toBe(300);
    expect(invoiceBalanceAsOf(voided, paid, day('2026-03-15'))).toBe(0);
  });

  it('dates a paid total with no payment rows on the day the invoice was paid', () => {
    const legacy = { amount: 300, issuedAt: '2026-03-01T09:00:00Z', paidAmount: 300, paidAt: '2026-03-09T00:00:00Z', status: 'PAID' };
    expect(invoiceBalanceAsOf(legacy, {}, day('2026-03-08'))).toBe(300);
    expect(invoiceBalanceAsOf(legacy, {}, day('2026-03-09'))).toBe(0);
  });
});

describe('billBalanceAsOf', () => {
  const bill = { totalAmount: 1000, billDate: '2026-03-01T00:00:00Z' };
  const payments = [
    { amount: 400, paidAt: '2026-03-10T00:00:00Z', reversedAt: '2026-03-12T08:00:00Z' },
    { amount: 1000, paidAt: '2026-03-20T00:00:00Z', reversedAt: null },
  ];

  it('follows the bill, its payments and their reversals day by day', () => {
    expect(billBalanceAsOf(bill, payments, day('2026-02-28'))).toBe(0);
    expect(billBalanceAsOf(bill, payments, day('2026-03-01'))).toBe(1000);
    expect(billBalanceAsOf(bill, payments, day('2026-03-10'))).toBe(600);
    expect(billBalanceAsOf(bill, payments, day('2026-03-12'))).toBe(1000);
    expect(billBalanceAsOf(bill, payments, day('2026-03-20'))).toBe(0);
  });
});

describe('isBeforeDay', () => {
  it('compares calendar days in UTC, so the same day is never before', () => {
    expect(isBeforeDay('2026-03-01T00:00:00Z', '2026-03-01T15:30:00Z')).toBe(false);
    expect(isBeforeDay('2026-02-28T23:59:59Z', '2026-03-01T00:00:00Z')).toBe(true);
    expect(isBeforeDay('2026-03-02', '2026-03-01T15:30:00Z')).toBe(false);
  });
});

describe('paymentDateProblem', () => {
  const invoice = { number: 'INV-2026-0007', kind: 'invoice' as const, date: '2026-11-20T09:30:00Z' };

  it('allows the day of the document and any later day', () => {
    expect(paymentDateProblem(invoice, '2026-11-20')).toBeNull();
    expect(paymentDateProblem(invoice, '2026-12-01T10:00:00Z')).toBeNull();
  });

  it('names the earliest date that will be accepted', () => {
    expect(paymentDateProblem(invoice, '2026-10-11')).toBe(
      'INV-2026-0007 was issued on 2026-11-20, so a payment on it cannot be dated 2026-10-11. Use 2026-11-20 or later. If the money arrived before the invoice was raised, record it on 2026-11-20.',
    );
    expect(paymentDateProblem({ number: 'BILL-2026-0003', kind: 'bill', date: '2026-11-20' }, '2026-11-19T23:00:00Z')).toMatch(
      /^BILL-2026-0003 is dated 2026-11-20, so a payment on it cannot be dated 2026-11-19\. Use 2026-11-20 or later\./,
    );
  });

  it('rejects a date that is not one', () => {
    expect(paymentDateProblem(invoice, 'yesterday')).toBe('The payment date is not a valid date.');
  });
});
