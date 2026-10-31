import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { PurchaseOrderDto } from '@saas/shared';
import { PurchaseOrderDetail } from './purchase-order-detail';

const mutateAsync = vi.fn().mockResolvedValue({});
const mutate = vi.fn();
let order: PurchaseOrderDto;
let supplier: { companyName: string; contactName: string | null; email: string | null } | undefined;

vi.mock('@/lib/session-context', () => ({
  useSession: () => ({ check: () => true }),
  useCan: () => true,
}));
vi.mock('@/hooks/use-purchase-orders', () => ({
  usePurchaseOrder: () => ({ data: order, isPending: false, isError: false }),
  usePurchaseOrderGuardrails: () => ({ data: [] }),
  usePurchaseOrderAction: () => ({ mutate, mutateAsync, isPending: false }),
}));
vi.mock('@/hooks/use-suppliers', () => ({
  useSupplier: (id: string | null) => ({ data: id ? supplier : undefined, isPending: !id }),
}));
vi.mock('@/components/inventory/receive-dialog', () => ({ ReceiveDialog: () => null }));
vi.mock('@/components/payables/enter-bill-dialog', () => ({ EnterBillDialog: () => null }));
vi.mock('@/components/platform/attachments-panel', () => ({ AttachmentsPanel: () => null }));
vi.mock('@/components/platform/activity-timeline', () => ({ ActivityTimeline: () => null }));

function makeOrder(overrides: Partial<PurchaseOrderDto> = {}): PurchaseOrderDto {
  return {
    id: 'po1',
    tenantId: 't1',
    poNumber: 'PO-2026-0007',
    supplierId: 's1',
    supplierName: 'Caledon Board Mills',
    status: 'APPROVED',
    currency: 'AED',
    orderDate: '2026-10-01',
    expectedDate: null,
    subtotalAmount: 1250,
    totalAmount: 1250,
    notes: null,
    lines: [
      { id: 'l1', materialId: null, description: '350gsm boxboard', qtyOrdered: 500, qtyReceived: 300, uom: 'SHEET', unitCost: 2, lineTotal: 1000 },
      { id: 'l2', materialId: null, description: 'Carton glue', qtyOrdered: 10, qtyReceived: 10, uom: 'KG', unitCost: 25, lineTotal: 250 },
    ],
    origin: 'MANUAL',
    createdById: null,
    createdAt: '2026-10-01T00:00:00Z',
    ...overrides,
  } as PurchaseOrderDto;
}

describe('PurchaseOrderDetail', () => {
  beforeEach(() => {
    mutate.mockReset();
    mutateAsync.mockClear();
    order = makeOrder();
    supplier = { companyName: 'Caledon Board Mills', contactName: 'Ana Reyes', email: 'orders@caledon.example' };
  });

  it('asks before emailing the supplier, naming who it goes to and the total', async () => {
    render(<PurchaseOrderDetail id="po1" />);

    fireEvent.click(screen.getByRole('button', { name: /email to supplier/i }));

    expect(mutate).not.toHaveBeenCalled();
    expect(mutateAsync).not.toHaveBeenCalled();
    expect(screen.getByText('Email PO-2026-0007 to Caledon Board Mills?')).toBeInTheDocument();
    expect(screen.getByText('Ana Reyes <orders@caledon.example>')).toBeInTheDocument();
    expect(screen.getAllByText('AED 1,250.00').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: 'Email order' }));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledWith({ id: 'po1', action: 'send' }));
  });

  it('does not offer to send when the supplier has no email address', () => {
    supplier = { companyName: 'Caledon Board Mills', contactName: null, email: null };
    render(<PurchaseOrderDetail id="po1" />);

    fireEvent.click(screen.getByRole('button', { name: /email to supplier/i }));

    expect(screen.getByText('Caledon Board Mills has no email address')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Email order' })).not.toBeInTheDocument();
  });

  it('lists what is still to come before closing an order short', async () => {
    order = makeOrder({ status: 'PARTIALLY_RECEIVED' });
    render(<PurchaseOrderDetail id="po1" />);

    fireEvent.click(screen.getByRole('button', { name: /^close short$/i }));

    expect(mutate).not.toHaveBeenCalled();
    expect(screen.getByText('200 sheet not received')).toBeInTheDocument();
    // A line received in full is not part of the decision.
    expect(screen.queryByText(/kg not received/)).not.toBeInTheDocument();

    const confirm = screen.getAllByRole('button', { name: /^close short$/i }).at(-1)!;
    fireEvent.click(confirm);
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledWith({ id: 'po1', action: 'closeShort' }));
  });
});
