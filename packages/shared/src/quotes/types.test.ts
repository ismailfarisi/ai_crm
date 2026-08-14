import { describe, it, expect } from 'vitest';
import { calculateQuoteTotals, QuoteLineItem } from './types';

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
