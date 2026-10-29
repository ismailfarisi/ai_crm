import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { BillCaptureResult } from '@saas/shared';
import { CaptureBillFlow } from './capture-bill-flow';
import { useBillableLines, useCaptureBill } from '@/hooks/use-bills';
import { usePurchaseOrder, usePurchaseOrders } from '@/hooks/use-purchase-orders';
import { useSuppliers } from '@/hooks/use-suppliers';

vi.mock('@/hooks/use-bills', () => ({
  useCaptureBill: vi.fn(),
  useBillableLines: vi.fn(),
  useCreateBill: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
}));
vi.mock('@/hooks/use-purchase-orders', () => ({
  usePurchaseOrder: vi.fn(),
  usePurchaseOrders: vi.fn(),
  usePurchasePolicy: vi.fn(() => ({ data: { varianceTolerancePct: 0 } })),
}));
vi.mock('@/hooks/use-suppliers', () => ({ useSuppliers: vi.fn() }));

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

const SUPPLIER = '11111111-1111-4111-8111-111111111111';
const ORDER = '22222222-2222-4222-8222-222222222222';

const result = (over: Partial<BillCaptureResult> = {}): BillCaptureResult => ({
  invoice: {
    isInvoice: true,
    supplierName: 'Gulf Board Trading L.L.C.',
    supplierTaxId: null,
    supplierInvoiceNumber: 'INV-7781',
    purchaseOrderReference: 'PO-2026-0031',
    billDate: '2026-10-20',
    dueDate: null,
    currency: 'AED',
    subtotalAmount: 1200,
    taxAmount: 60,
    totalAmount: 1260,
    lines: [{ description: 'Kraft board 300gsm', qty: 500, unitCost: 2.4, lineTotal: 1200 }],
    confidence: 0.9,
    uncertainFields: [],
  },
  supplier: { id: SUPPLIER, companyName: 'Gulf Board Trading LLC', currency: 'AED' },
  supplierCandidates: [],
  purchaseOrder: { id: ORDER, poNumber: 'PO-2026-0031' },
  orderCandidates: [],
  lines: [{ index: 0, purchaseOrderLineId: 'pol-1', score: 0.9 }],
  duplicateOf: null,
  warnings: [],
  model: 'm',
  promptVersion: 'bill-capture/1',
  ...over,
});

const order = {
  id: ORDER,
  poNumber: 'PO-2026-0031',
  supplierId: SUPPLIER,
  supplierName: 'Gulf Board Trading LLC',
  status: 'RECEIVED',
  totalAmount: 1200,
  currency: 'AED',
};

/** Picks a file and lets the (mocked) read resolve inside act, so the review dialog is up before any assertion. */
async function pickFile(container: HTMLElement) {
  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  await act(async () => {
    fireEvent.change(input, { target: { files: [new File(['%PDF'], 'inv.pdf', { type: 'application/pdf' })] } });
  });
}

describe('CaptureBillFlow', () => {
  let mutateAsync: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    push.mockReset();
    mutateAsync = vi.fn().mockResolvedValue(result());
    vi.mocked(useCaptureBill).mockReturnValue({ mutateAsync, isPending: false, reset: vi.fn() } as never);
    vi.mocked(useSuppliers).mockReturnValue({
      data: { items: [{ id: SUPPLIER, companyName: 'Gulf Board Trading LLC' }] },
    } as never);
    vi.mocked(usePurchaseOrders).mockReturnValue({ data: { items: [order] } } as never);
    vi.mocked(usePurchaseOrder).mockReturnValue({ data: order } as never);
    vi.mocked(useBillableLines).mockReturnValue({
      data: [
        {
          purchaseOrderLineId: 'pol-1',
          materialId: null,
          description: 'Kraft board 300gsm 70x100',
          qtyOrdered: 500,
          qtyReceived: 500,
          qtyBilled: 0,
          qtyBillable: 500,
          orderUnitCost: 2.4,
        },
      ],
    } as never);
  });

  it('reads the file and opens on the supplier and order it found', async () => {
    const { container } = render(<CaptureBillFlow />);
    await pickFile(container);

    await screen.findByText('Check what was read');
    expect(mutateAsync).toHaveBeenCalledWith(expect.any(File));
    expect(screen.getByLabelText('Supplier')).toHaveValue(SUPPLIER);
    expect(screen.getByLabelText('Purchase order')).toHaveValue(ORDER);
    expect(screen.getByRole('button', { name: 'Continue to the bill' })).toBeEnabled();
  });

  it('opens the bill form filled in from the invoice', async () => {
    const { container } = render(<CaptureBillFlow />);
    await pickFile(container);
    fireEvent.click(await screen.findByRole('button', { name: 'Continue to the bill' }));

    await waitFor(() => expect(screen.getByLabelText(/Their invoice number/)).toHaveValue('INV-7781'));
    expect(screen.getByLabelText('Invoice date')).toHaveValue('2026-10-20');
    expect(screen.getByLabelText('Tax on the invoice')).toHaveValue(60);
  });

  it('will not continue with an invoice that is already entered', async () => {
    mutateAsync.mockResolvedValue(
      result({
        duplicateOf: { id: '33333333-3333-4333-8333-333333333333', billNumber: 'BILL-2026-0007' },
        warnings: [{ code: 'DUPLICATE', message: 'Gulf Board invoice INV-7781 is already entered as BILL-2026-0007.' }],
      }),
    );
    const { container } = render(<CaptureBillFlow />);
    await pickFile(container);

    expect(await screen.findByText(/already entered as BILL-2026-0007/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open BILL-2026-0007' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continue to the bill' })).toBeDisabled();
  });

  it('stops when the document is not an invoice', async () => {
    mutateAsync.mockResolvedValue(
      result({
        invoice: { ...result().invoice, isInvoice: false },
        supplier: null,
        purchaseOrder: null,
        warnings: [{ code: 'NOT_AN_INVOICE', message: 'This does not look like a supplier invoice.' }],
      }),
    );
    const { container } = render(<CaptureBillFlow />);
    await pickFile(container);

    expect(await screen.findByText('This does not look like a supplier invoice.')).toBeInTheDocument();
    expect(screen.queryByLabelText('Supplier')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continue to the bill' })).toBeDisabled();
  });
});
