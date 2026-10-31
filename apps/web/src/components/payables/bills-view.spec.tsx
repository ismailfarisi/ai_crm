import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { SupplierBillDto } from '@saas/shared';
import { BillsView, BillStatusPill } from './bills-view';

const bill = {
  id: 'b1',
  billNumber: 'BILL-2026-0003',
  supplierInvoiceNumber: 'INV-881',
  supplierId: 's1',
  supplierName: 'Caledon Board Mills',
  purchaseOrderId: 'po1',
  status: 'DRAFT',
  matchStatus: 'VARIANCE',
  currency: 'AED',
  billDate: '2026-10-10',
  dueDate: null,
  subtotalAmount: 1000,
  taxAmount: 50,
  totalAmount: 1050,
  paidAmount: 0,
  notes: null,
  varianceApproved: false,
  disputeReason: null,
  lines: [],
  createdAt: '2026-10-10T00:00:00Z',
} satisfies SupplierBillDto;

vi.mock('@/lib/session-context', () => ({
  useSession: () => ({ check: () => true }),
  useCan: () => true,
}));
vi.mock('@/hooks/use-bills', () => ({
  useBills: () => ({ data: { items: [bill] }, isPending: false, isError: false }),
  useBillAging: () => ({ data: undefined }),
}));
vi.mock('./capture-bill-flow', () => ({ CaptureBillFlow: () => null }));

describe('BillsView', () => {
  // Colour alone, behind a hover, said nothing on a phone or to a screen reader.
  it('marks a draft that does not match its order with a word', () => {
    render(<BillsView />);
    expect(screen.getAllByText('Mismatch').length).toBeGreaterThan(0);
  });

  it('links the bill number', () => {
    render(<BillsView />);
    const link = screen.getAllByRole('link', { name: 'BILL-2026-0003' })[0];
    expect(link).toHaveAttribute('href', '/purchasing/bills/b1');
    expect(link.className).toContain('underline');
  });

  it('shows Approved as an info badge', () => {
    render(<BillStatusPill status="APPROVED" />);
    expect(screen.getByText('Approved').className).toContain('text-info');
  });
});
