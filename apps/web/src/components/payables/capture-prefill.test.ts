import { describe, expect, it } from 'vitest';
import type { BillCaptureResult, BillableOrderLineDto } from '@saas/shared';
import { prefillFromCapture } from './capture-prefill';

const orderLine = (id: string, description: string, qtyBillable: number, orderUnitCost: number): BillableOrderLineDto => ({
  purchaseOrderLineId: id,
  materialId: null,
  description,
  qtyOrdered: qtyBillable,
  qtyReceived: qtyBillable,
  qtyBilled: 0,
  qtyBillable,
  orderUnitCost,
});

const result = (over: Partial<BillCaptureResult> = {}): BillCaptureResult => ({
  invoice: {
    isInvoice: true,
    supplierName: 'Gulf Board',
    supplierTaxId: null,
    supplierInvoiceNumber: 'INV-7781',
    purchaseOrderReference: 'PO-2026-0031',
    billDate: '2026-10-20',
    dueDate: null,
    currency: 'AED',
    subtotalAmount: 1350,
    taxAmount: 67.5,
    totalAmount: 1417.5,
    lines: [
      { description: 'Kraft board 300gsm', qty: 400, unitCost: 2.45, lineTotal: 980 },
      { description: 'Delivery', qty: 1, unitCost: 150, lineTotal: 150 },
    ],
    confidence: 0.9,
    uncertainFields: ['billDate'],
  },
  supplier: { id: 'sup-1', companyName: 'Gulf Board Trading LLC', currency: 'AED' },
  supplierCandidates: [],
  purchaseOrder: { id: 'po-31', poNumber: 'PO-2026-0031' },
  orderCandidates: [],
  lines: [
    { index: 0, purchaseOrderLineId: 'pol-1', score: 0.9 },
    { index: 1, purchaseOrderLineId: null, score: 0 },
  ],
  duplicateOf: null,
  warnings: [{ code: 'LINE_NOT_ON_ORDER', message: '"Delivery" is not on PO-2026-0031' }],
  model: 'm',
  promptVersion: 'bill-capture/1',
  ...over,
});

const billable = [orderLine('pol-1', 'Kraft board 300gsm 70x100', 500, 2.4), orderLine('pol-2', 'Gold foil roll', 10, 85)];

describe('prefillFromCapture', () => {
  it('bills what the invoice says on paired lines and nothing on the rest', () => {
    const p = prefillFromCapture(result(), 'po-31', billable, null);
    expect(p.edits).toEqual({ 'pol-1': { qty: '400', unitCost: '2.45' }, 'pol-2': { qty: '0' } });
    expect(p.paired).toEqual(['pol-1']);
  });

  it('turns a charge that is not on the order into an extra line', () => {
    const p = prefillFromCapture(result(), 'po-31', billable, null);
    expect(p.extras).toHaveLength(1);
    expect(p.extras[0]).toMatchObject({ description: 'Delivery', qty: '1', unitCost: '150' });
  });

  it('copies the header and what capture was unsure of', () => {
    const p = prefillFromCapture(result(), 'po-31', billable, null);
    expect(p).toMatchObject({ invoiceNumber: 'INV-7781', billDate: '2026-10-20', tax: '67.5', uncertain: ['billDate'] });
  });

  it('pairs again, and drops the old pairing warnings, when another order is chosen', () => {
    const other = [orderLine('pol-7', 'Kraft board 300gsm', 400, 2.4)];
    const p = prefillFromCapture(result(), 'po-99', other, null);
    expect(p.edits['pol-7']).toEqual({ qty: '400', unitCost: '2.45' });
    expect(p.warnings).toEqual([]);
  });

  it('leaves the tax blank rather than zero when none was printed', () => {
    const r = result();
    r.invoice.taxAmount = null;
    expect(prefillFromCapture(r, 'po-31', billable, null).tax).toBe('');
  });
});
