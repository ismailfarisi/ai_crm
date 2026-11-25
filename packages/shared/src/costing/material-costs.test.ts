import { describe, expect, it } from 'vitest';
import { costMoved, reviewMaterialCosts } from './material-costs';

const board = { id: 'm1', name: 'Greyboard 2mm', uom: 'SHEET', costPerUom: 6.79 };
const ink = { id: 'm2', name: 'Black ink', uom: 'KG', costPerUom: 20 };

describe('reviewMaterialCosts', () => {
  it('suggests the last price paid and says how far it is from the catalog', () => {
    const review = reviewMaterialCosts({
      materials: [board, ink],
      lastReceipts: [
        { materialId: 'm1', unitCost: 7.2, receivedAt: '2026-11-20T08:00:00Z', receiptNumber: 'GRN-0004', supplierName: 'Gulf Board' },
        { materialId: 'm2', unitCost: 20.1, receivedAt: '2026-11-20T08:00:00Z', receiptNumber: 'GRN-0005', supplierName: null },
      ],
      positions: [
        { materialId: 'm1', qtyOnHand: 100, avgUnitCost: 7 },
        { materialId: 'm1', qtyOnHand: 100, avgUnitCost: 7.1 },
      ],
      supplierPrices: [],
    });
    expect(review.checked).toBe(2);
    // Ink is 0.5% away, under the 2% threshold.
    expect(review.rows).toHaveLength(1);
    const row = review.rows[0];
    expect(row).toMatchObject({ target: { id: 'm1' }, field: 'costPerUom', suggested: 'LAST_PURCHASE', current: 6.79 });
    expect(row.figures.find((f) => f.basis === 'AVERAGE')?.unitCost).toBe(7.05);
    expect(row.reason).toBe('Quotes use 6.79 per sheet; the last price paid is 7.20, 6% more.');
  });

  it('falls back to the average, then the supplier price, and flags a material with no cost', () => {
    const review = reviewMaterialCosts({
      materials: [{ ...board, costPerUom: 0 }, ink],
      lastReceipts: [],
      positions: [{ materialId: 'm2', qtyOnHand: 10, avgUnitCost: 18 }],
      supplierPrices: [{ materialId: 'm1', supplierName: 'Gulf Board', unitCost: 7.3333, currency: 'AED' }],
    });
    const byId = Object.fromEntries(review.rows.map((r) => [r.target.id, r]));
    expect(byId.m1.suggested).toBe('SUPPLIER');
    expect(byId.m1.reason).toMatch(/^Has no cost in the catalog/);
    expect(byId.m2.suggested).toBe('AVERAGE');
    expect(byId.m2.reason).toContain('10% less');
  });

  it('compares a stock item at the cost of its linked material and notes left-out receipts', () => {
    const review = reviewMaterialCosts({
      materials: [board],
      stockItems: [{ id: 'i1', name: 'Greyboard sheet (resale)', standardCost: 6, stockMaterialId: 'm1' }],
      lastReceipts: [{ materialId: 'm1', unitCost: 6.79, receivedAt: '2026-11-20', receiptNumber: 'GRN-1', supplierName: null }],
      otherUnitReceipts: [{ materialId: 'm1', count: 2 }],
      positions: [],
      supplierPrices: [{ materialId: 'm1', supplierName: 'X', unitCost: null, currency: 'EUR' }],
    });
    expect(review.rows.map((r) => r.id)).toEqual(['CATALOG_ITEM:i1']);
    expect(review.rows[0].field).toBe('standardCost');
    expect(review.notes).toHaveLength(2);
  });
});

describe('costMoved', () => {
  it('ignores sub-fil and sub-half-percent drift', () => {
    expect(costMoved(100, 100.004)).toBe(false);
    expect(costMoved(100, 100.4)).toBe(false);
    expect(costMoved(100, 101)).toBe(true);
    expect(costMoved(null, 5)).toBe(true);
    expect(costMoved(null, null)).toBe(false);
  });
});
