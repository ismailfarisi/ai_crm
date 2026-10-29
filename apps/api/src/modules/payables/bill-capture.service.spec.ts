import {
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { AiBudgetExceededException } from '../ai/exceptions/ai-budget-exceeded.exception';
import { BillCaptureService } from './bill-capture.service';

const TENANT = 'tenant-1';

const invoice = (over: Record<string, unknown> = {}) => ({
  isInvoice: true,
  supplierName: 'Gulf Board Trading L.L.C.',
  supplierTaxId: null,
  supplierInvoiceNumber: 'INV-7781',
  purchaseOrderReference: 'LPO 2026-0031',
  billDate: '2026-10-20',
  dueDate: null,
  currency: 'AED',
  subtotalAmount: 1350,
  taxAmount: 67.5,
  totalAmount: 1417.5,
  lines: [
    {
      description: 'Kraft board 300gsm 70x100',
      qty: 500,
      unitCost: 2.4,
      lineTotal: 1200,
    },
    { description: 'Delivery', qty: 1, unitCost: 150, lineTotal: 150 },
  ],
  confidence: 0.92,
  uncertainFields: [],
  ...over,
});

const suppliers = [
  {
    id: 'sup-1',
    companyName: 'Gulf Board Trading LLC',
    taxId: null,
    currency: 'AED',
  },
  { id: 'sup-2', companyName: 'Emirates Inks', taxId: null, currency: 'AED' },
];

const orders = [
  {
    id: 'po-31',
    poNumber: 'PO-2026-0031',
    supplierId: 'sup-1',
    totalAmount: 1200,
    currency: 'AED',
  },
  {
    id: 'po-40',
    poNumber: 'PO-2026-0040',
    supplierId: 'sup-2',
    totalAmount: 900,
    currency: 'AED',
  },
];

const billable: Record<string, unknown[]> = {
  'po-31': [
    {
      purchaseOrderLineId: 'pol-1',
      description: 'Kraft board 300gsm 70x100',
      qtyBillable: 500,
      orderUnitCost: 2.4,
    },
  ],
  'po-40': [
    {
      purchaseOrderLineId: 'pol-9',
      description: 'Black ink 5kg',
      qtyBillable: 4,
      orderUnitCost: 120,
    },
  ],
};

function setup(data: unknown = invoice()) {
  const ai = {
    generateStructured: jest
      .fn()
      .mockResolvedValue({ data, model: 'claude-sonnet-5-5', usage: {} }),
  };
  const payables = {
    billableLines: jest.fn((_t: string, id: string) =>
      Promise.resolve(billable[id] ?? []),
    ),
  };
  const supplierRepo = { find: jest.fn().mockResolvedValue(suppliers) };
  const orderRepo = { find: jest.fn().mockResolvedValue(orders) };
  const billRepo = { findOne: jest.fn().mockResolvedValue(null) };
  const service = new BillCaptureService(
    ai as never,
    payables as never,
    supplierRepo as never,
    orderRepo as never,
    billRepo as never,
  );
  return { service, ai, payables, billRepo };
}

const pdf = {
  buffer: Buffer.from('%PDF-1.7 /Type /Page'),
  mimeType: 'application/pdf',
  filename: 'inv.pdf',
};
const photo = { buffer: Buffer.from('jpeg-bytes'), mimeType: 'image/jpeg' };

describe('BillCaptureService', () => {
  it('refuses a file that is not a PDF or a photo, before calling the model', async () => {
    const { service, ai } = setup();
    await expect(
      service.capture(TENANT, 'u1', {
        buffer: Buffer.from('x'),
        mimeType: 'text/html',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(ai.generateStructured).not.toHaveBeenCalled();
  });

  it('sends a PDF as a document and a photo as an image', async () => {
    const { service, ai } = setup();
    await service.capture(TENANT, 'u1', pdf);
    await service.capture(TENANT, 'u1', photo, 'for the board order');

    const first = ai.generateStructured.mock.calls[0][1].messages[0].content;
    expect(first[0]).toMatchObject({
      type: 'document',
      mimeType: 'application/pdf',
      filename: 'inv.pdf',
    });
    const second = ai.generateStructured.mock.calls[1][1].messages[0].content;
    expect(second[0]).toMatchObject({ type: 'image', mimeType: 'image/jpeg' });
    expect(second[1].text).toContain('for the board order');
    expect(ai.generateStructured.mock.calls[0][0]).toBe('bill.capture');
    expect(ai.generateStructured.mock.calls[0][2]).toEqual({
      organizationId: TENANT,
      userId: 'u1',
    });
  });

  it('resolves the supplier, the quoted order and its lines, and flags the charge that is not on it', async () => {
    const { service } = setup();
    const r = await service.capture(TENANT, 'u1', pdf);

    expect(r.supplier?.id).toBe('sup-1');
    expect(r.purchaseOrder).toEqual({ id: 'po-31', poNumber: 'PO-2026-0031' });
    expect(r.lines[0].purchaseOrderLineId).toBe('pol-1');
    expect(r.lines[1].purchaseOrderLineId).toBeNull();
    expect(r.warnings.map((w) => w.code)).toEqual(['LINE_NOT_ON_ORDER']);
    expect(r.promptVersion).toBe('bill-capture/1');
  });

  it('takes the supplier from the quoted order when the name is not recognised', async () => {
    const { service } = setup(invoice({ supplierName: 'GBT' }));
    const r = await service.capture(TENANT, 'u1', pdf);
    expect(r.supplier?.id).toBe('sup-1');
    expect(r.warnings.map((w) => w.code)).not.toContain('SUPPLIER_NOT_FOUND');
  });

  it('refuses an order that belongs to another supplier', async () => {
    const { service } = setup(
      invoice({ purchaseOrderReference: 'PO-2026-0040' }),
    );
    const r = await service.capture(TENANT, 'u1', pdf);
    expect(r.warnings.map((w) => w.code)).toContain('ORDER_OTHER_SUPPLIER');
    // Falls back to the supplier's own open orders, where the board order fits.
    expect(r.purchaseOrder?.id).toBe('po-31');
  });

  it('finds the order from the lines when the invoice quotes none', async () => {
    const { service } = setup(invoice({ purchaseOrderReference: null }));
    const r = await service.capture(TENANT, 'u1', pdf);
    expect(r.purchaseOrder?.id).toBe('po-31');
    expect(r.orderCandidates).toEqual([]);
  });

  it('offers the supplier’s open orders when no order fits', async () => {
    const { service } = setup(
      invoice({
        purchaseOrderReference: null,
        lines: [
          { description: 'Consulting', qty: 1, unitCost: 500, lineTotal: 500 },
        ],
        subtotalAmount: 500,
        taxAmount: 25,
        totalAmount: 525,
      }),
    );
    const r = await service.capture(TENANT, 'u1', pdf);
    expect(r.purchaseOrder).toBeNull();
    expect(r.orderCandidates.map((o) => o.id)).toEqual(['po-31']);
  });

  it('says when a supplier cannot be found', async () => {
    const { service } = setup(
      invoice({
        supplierName: 'Dubai Steel Works',
        purchaseOrderReference: null,
      }),
    );
    const r = await service.capture(TENANT, 'u1', pdf);
    expect(r.supplier).toBeNull();
    expect(r.purchaseOrder).toBeNull();
    expect(r.warnings.map((w) => w.code)).toContain('SUPPLIER_NOT_FOUND');
  });

  it('points at the bill already entered for the same supplier invoice', async () => {
    const { service, billRepo } = setup();
    billRepo.findOne.mockResolvedValue({
      id: 'bill-1',
      billNumber: 'BILL-2026-0007',
    });
    const r = await service.capture(TENANT, 'u1', pdf);
    expect(r.duplicateOf).toEqual({
      id: 'bill-1',
      billNumber: 'BILL-2026-0007',
    });
    expect(r.warnings.map((w) => w.code)).toContain('DUPLICATE');
  });

  it('stops at the read when the document is not an invoice', async () => {
    const { service, payables } = setup(invoice({ isInvoice: false }));
    const r = await service.capture(TENANT, 'u1', pdf);
    expect(r.warnings.map((w) => w.code)).toEqual(['NOT_AN_INVOICE']);
    expect(r.supplier).toBeNull();
    expect(payables.billableLines).not.toHaveBeenCalled();
  });

  it('flags a hard read and a total that does not add up', async () => {
    const { service } = setup(invoice({ confidence: 0.4, totalAmount: 1500 }));
    const r = await service.capture(TENANT, 'u1', pdf);
    expect(r.warnings.map((w) => w.code)).toEqual(
      expect.arrayContaining(['TOTAL_DOES_NOT_ADD_UP', 'LOW_CONFIDENCE']),
    );
  });

  it('rejects a malformed read rather than pre-filling nonsense', async () => {
    const { service } = setup({ supplierName: 42 });
    await expect(service.capture(TENANT, 'u1', pdf)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('reports a failed model call as unavailable, and passes budget errors through', async () => {
    const { service, ai } = setup();
    ai.generateStructured.mockRejectedValueOnce(new Error('socket hang up'));
    await expect(service.capture(TENANT, 'u1', pdf)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );

    ai.generateStructured.mockRejectedValueOnce(
      new AiBudgetExceededException(TENANT, 10, 10),
    );
    await expect(service.capture(TENANT, 'u1', pdf)).rejects.toBeInstanceOf(
      AiBudgetExceededException,
    );
  });
});
