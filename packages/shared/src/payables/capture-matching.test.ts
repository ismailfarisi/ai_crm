import { describe, expect, it } from 'vitest';
import {
  invoiceArithmeticWarnings,
  matchInvoiceLines,
  matchOrderReference,
  matchSupplier,
  normaliseCompanyName,
} from './capture-matching';

describe('normaliseCompanyName', () => {
  it('drops legal suffixes and punctuation', () => {
    expect(normaliseCompanyName('Gulf Board Trading L.L.C.')).toBe('gulf board');
    expect(normaliseCompanyName('GULF BOARD TRADING LLC')).toBe('gulf board');
    expect(normaliseCompanyName('Al-Noor Paper Industries FZE')).toBe(
      'al noor paper industries',
    );
  });
});

describe('matchSupplier', () => {
  const suppliers = [
    { id: 's1', companyName: 'Gulf Board Trading LLC', taxId: '100234567800003' },
    { id: 's2', companyName: 'Gulf Packaging Materials', taxId: null },
    { id: 's3', companyName: 'Emirates Inks FZE', taxId: '100999888700003' },
  ];

  it('takes a tax number over the name', () => {
    const r = matchSupplier(
      { name: 'Some other name', taxId: 'TRN 100-2345-6780-0003' },
      suppliers,
    );
    expect(r.match?.id).toBe('s1');
  });

  it('matches a name once legal suffixes are ignored', () => {
    const r = matchSupplier({ name: 'GULF BOARD TRADING L.L.C', taxId: null }, suppliers);
    expect(r.match?.id).toBe('s1');
  });

  it('offers candidates rather than guessing between two close names', () => {
    const r = matchSupplier({ name: 'Gulf Trading', taxId: null }, suppliers);
    expect(r.match).toBeNull();
    expect(r.candidates.map((c) => c.id)).toContain('s1');
  });

  it('finds nothing for an unknown supplier', () => {
    const r = matchSupplier({ name: 'Dubai Steel Works', taxId: null }, suppliers);
    expect(r.match).toBeNull();
    expect(r.candidates).toEqual([]);
  });
});

describe('matchOrderReference', () => {
  const orders = [
    { id: 'p1', poNumber: 'PO-2026-0031' },
    { id: 'p2', poNumber: 'PO-2026-0032' },
    { id: 'p3', poNumber: 'PO-2025-0031' },
  ];

  it('matches the number however it is punctuated', () => {
    expect(matchOrderReference('po 2026 0031', orders)?.id).toBe('p1');
    expect(matchOrderReference('PO2026-0032', orders)?.id).toBe('p2');
  });

  it('matches trailing digits only when they are unambiguous', () => {
    expect(matchOrderReference('Your PO 32', orders)?.id).toBe('p2');
    expect(matchOrderReference('31', orders)).toBeNull();
  });

  it('ignores a reference with too few digits to mean anything', () => {
    expect(matchOrderReference('PO 2', orders)).toBeNull();
    expect(matchOrderReference(null, orders)).toBeNull();
  });
});

describe('matchInvoiceLines', () => {
  const billable = [
    { purchaseOrderLineId: 'l1', description: 'Kraft board 300gsm 70x100', qtyBillable: 500, orderUnitCost: 2.4 },
    { purchaseOrderLineId: 'l2', description: 'Gold foil roll 64cm', qtyBillable: 10, orderUnitCost: 85 },
  ];

  it('pairs lines by description, price and quantity', () => {
    const r = matchInvoiceLines(
      [
        { description: 'GOLD FOIL 64 CM ROLL', qty: 10, unitCost: 85, lineTotal: 850 },
        { description: 'Kraft Board 300 GSM (70x100)', qty: 500, unitCost: 2.45, lineTotal: 1225 },
      ],
      billable,
    );
    expect(r.map((m) => m.purchaseOrderLineId)).toEqual(['l2', 'l1']);
    expect(r.every((m) => m.score > 0.5)).toBe(true);
  });

  it('leaves a charge that is not on the order unpaired', () => {
    const r = matchInvoiceLines(
      [{ description: 'Delivery charges', qty: 1, unitCost: 150, lineTotal: 150 }],
      billable,
    );
    expect(r[0]).toEqual({ index: 0, purchaseOrderLineId: null, score: 0 });
  });

  it('never pairs two invoice lines with the same order line', () => {
    const r = matchInvoiceLines(
      [
        { description: 'Kraft board 300gsm', qty: 300, unitCost: 2.4, lineTotal: 720 },
        { description: 'Kraft board 300gsm', qty: 200, unitCost: 2.4, lineTotal: 480 },
      ],
      billable,
    );
    const paired = r.filter((m) => m.purchaseOrderLineId === 'l1');
    expect(paired).toHaveLength(1);
  });

  it('pairs an order line with nothing left to bill, so the match can flag it', () => {
    const r = matchInvoiceLines(
      [{ description: 'Gold foil roll 64cm', qty: 10, unitCost: 85, lineTotal: 850 }],
      [{ ...billable[1], qtyBillable: 0 }],
    );
    expect(r[0].purchaseOrderLineId).toBe('l2');
  });
});

describe('invoiceArithmeticWarnings', () => {
  const line = (lineTotal: number) => ({ description: 'x', qty: 1, unitCost: lineTotal, lineTotal });

  it('is quiet when the document adds up', () => {
    expect(
      invoiceArithmeticWarnings({ lines: [line(100), line(50)], subtotalAmount: 150, taxAmount: 7.5, totalAmount: 157.5 }),
    ).toEqual([]);
  });

  it('flags lines that do not reach the subtotal', () => {
    const w = invoiceArithmeticWarnings({ lines: [line(100)], subtotalAmount: 150, taxAmount: 0, totalAmount: 150 });
    expect(w.map((x) => x.code)).toEqual(['LINES_DO_NOT_ADD_UP']);
  });

  it('flags a total that is not subtotal plus tax', () => {
    const w = invoiceArithmeticWarnings({ lines: [line(100)], subtotalAmount: 100, taxAmount: 5, totalAmount: 110 });
    expect(w.map((x) => x.code)).toEqual(['TOTAL_DOES_NOT_ADD_UP']);
  });

  it('checks the lines against the total when no subtotal is printed', () => {
    const w = invoiceArithmeticWarnings({ lines: [line(100)], subtotalAmount: null, taxAmount: 5, totalAmount: 120 });
    expect(w.map((x) => x.code)).toEqual(['TOTAL_DOES_NOT_ADD_UP']);
  });
});
