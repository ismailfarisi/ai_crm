import { describe, it, expect } from 'vitest';
import {
  calculateQuoteTotals,
  formatPaymentTerms,
  QuoteLineItem,
  quoteLineSubtotal,
  withLineSubtotals,
} from './types';

describe('calculateQuoteTotals', () => {
  it('correctly calculates untaxed subtotal, discounts, taxes, and total amount', () => {
    const items: QuoteLineItem[] = [
      {
        id: '1',
        type: 'section',
        description: 'Software Licenses',
      },
      {
        id: '2',
        type: 'product',
        description: 'Cloud License',
        quantity: 10,
        uom: 'Licenses',
        unitPrice: 100,
        discount: 10, // 10% discount -> $90 unit total -> $900 line total
        taxRate: 10, // 10% tax -> $90 tax
      },
      {
        id: '3',
        type: 'product',
        description: 'Setup Fee',
        quantity: 1,
        uom: 'Units',
        unitPrice: 500,
        discount: 0,
        taxRate: 0,
      },
      {
        id: '4',
        type: 'note',
        description: 'Includes 1 year maintenance',
      },
    ];

    const totals = calculateQuoteTotals(items);
    expect(totals.subtotalAmount).toBe(1400); // 900 + 500
    expect(totals.discountAmount).toBe(100); // 1000 - 900
    expect(totals.taxAmount).toBe(90); // 90 on 900
    expect(totals.totalAmount).toBe(1490); // 1400 + 90
  });

  it('handles empty items array gracefully', () => {
    const totals = calculateQuoteTotals([]);
    expect(totals.subtotalAmount).toBe(0);
    expect(totals.discountAmount).toBe(0);
    expect(totals.taxAmount).toBe(0);
    expect(totals.totalAmount).toBe(0);
  });

  it('handles rounding to 2 decimal places accurately', () => {
    const items: QuoteLineItem[] = [
      {
        id: '1',
        type: 'product',
        description: 'Item with fractional cents',
        quantity: 3,
        unitPrice: 19.99,
        discount: 15, // 3 * 19.99 = 59.97, discount 15% = 8.9955 -> subtotal = 50.9745
        taxRate: 8.25, // 50.9745 * 0.0825 = 4.20539625
      },
    ];

    const totals = calculateQuoteTotals(items);
    expect(totals.subtotalAmount).toBe(50.97);
    expect(totals.discountAmount).toBe(9.0);
    expect(totals.taxAmount).toBe(4.21);
    expect(totals.totalAmount).toBe(55.18);
  });

  it('ignores sections and notes in calculations', () => {
    const items: QuoteLineItem[] = [
      { id: '1', type: 'section', description: 'Section Title' },
      { id: '2', type: 'note', description: 'Terms and notes' },
    ];

    const totals = calculateQuoteTotals(items);
    expect(totals.subtotalAmount).toBe(0);
    expect(totals.discountAmount).toBe(0);
    expect(totals.taxAmount).toBe(0);
    expect(totals.totalAmount).toBe(0);
  });
});

describe('calculateQuoteTotals: the document adds up', () => {
  const c = (n: number) => Math.round(n * 100);

  it('ignores a subtotal the caller sent', () => {
    const line: QuoteLineItem = {
      id: '1', type: 'product', description: 'Sign', quantity: 10, unitPrice: 1000, discount: 20, taxRate: 5,
    };
    const totals = calculateQuoteTotals([line]);
    expect(calculateQuoteTotals([{ ...line, subtotal: 1 }])).toEqual(totals);
    expect(totals).toMatchObject({ subtotalAmount: 8000, discountAmount: 2000, taxAmount: 400, totalAmount: 8400 });
  });

  it('counts a line saved without a type as a product line', () => {
    const line = { id: '1', description: 'Sign', quantity: 2, unitPrice: 50, taxRate: 5 } as QuoteLineItem;
    expect(calculateQuoteTotals([line])).toMatchObject({ subtotalAmount: 100, taxAmount: 5, totalAmount: 105 });
  });

  it('makes the subtotal the sum of the lines as they print', () => {
    // Each line is 94.9905 after discount: 94.99 printed three times is
    // 284.97, where the unrounded sum would print 284.98.
    const items: QuoteLineItem[] = [1, 2, 3].map((n) => ({
      id: String(n), type: 'product', description: 'Panel', quantity: 1, unitPrice: 99.99, discount: 5, taxRate: 5,
    }));
    const totals = calculateQuoteTotals(items);
    expect(c(totals.subtotalAmount)).toBe(items.reduce((s, item) => s + c(quoteLineSubtotal(item)), 0));
    expect(totals.subtotalAmount).toBe(284.97);
  });

  it('makes subtotal + tax the total, where rounding each separately is a cent out', () => {
    // Net 0.094 and tax 0.0047 round to 0.09 and 0.00; their sum rounds to 0.10.
    const totals = calculateQuoteTotals([
      { id: '1', type: 'product', description: 'Washer', quantity: 1, unitPrice: 0.094, taxRate: 5 },
    ]);
    expect(c(totals.subtotalAmount) + c(totals.taxAmount)).toBe(c(totals.totalAmount));

    for (let i = 1; i <= 500; i++) {
      const t = calculateQuoteTotals([
        { id: 'a', type: 'product', description: 'A', quantity: i % 9 + 0.5, unitPrice: i * 1.37, discount: i % 4 ? 7.5 : 0, taxRate: 5 },
        { id: 'b', type: 'product', description: 'B', quantity: 3, unitPrice: 33.33 + i / 7, discount: 12.5, taxRate: i % 2 ? 5 : 0 },
      ]);
      expect(c(t.subtotalAmount) + c(t.taxAmount)).toBe(c(t.totalAmount));
      expect(t.discountAmount).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('withLineSubtotals', () => {
  it('derives each priced line from its quantity, price and discount', () => {
    const [missing, wrong, untyped, section] = withLineSubtotals([
      { id: '1', type: 'product', description: 'No subtotal sent', quantity: 10, unitPrice: 1000, discount: 20 },
      { id: '2', type: 'product', description: 'Wrong subtotal sent', quantity: 3, unitPrice: 19.99, discount: 15, subtotal: 9999 },
      { id: '3', description: 'No type sent', quantity: 2, unitPrice: 50 } as QuoteLineItem,
      { id: '4', type: 'section', description: 'Heading' },
    ]);
    expect(missing.subtotal).toBe(8000);
    expect(wrong.subtotal).toBe(50.97);
    expect(untyped).toMatchObject({ type: 'product', subtotal: 100 });
    expect(section).toEqual({ id: '4', type: 'section', description: 'Heading' });
  });

  it('survives a missing list and missing figures', () => {
    expect(withLineSubtotals(null)).toEqual([]);
    expect(withLineSubtotals([{ id: '1', type: 'product', description: 'Blank' }])[0].subtotal).toBe(0);
  });
});

describe('formatPaymentTerms', () => {
  it('turns the stored codes into words a customer can read', () => {
    expect(formatPaymentTerms('net_30')).toBe('Net 30 days');
    expect(formatPaymentTerms('net_15')).toBe('Net 15 days');
    expect(formatPaymentTerms('immediate')).toBe('Due on receipt');
    expect(formatPaymentTerms('end_of_month')).toBe('End of month');
  });

  it('prints free text as it was typed', () => {
    expect(formatPaymentTerms('50% advance, balance on delivery')).toBe('50% advance, balance on delivery');
  });
});
