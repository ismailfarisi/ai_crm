import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { BillStatus, LineVariance, SupplierBillDto } from '@saas/shared';
import { BillDetail } from './bill-detail';

let bill: SupplierBillDto;
let variances: (LineVariance & { lineIndex: number })[] = [];

vi.mock('@/lib/session-context', () => ({
  useSession: () => ({ check: () => true }),
  useCan: () => true,
}));
vi.mock('@/hooks/use-bills', () => ({
  useBill: () => ({ data: bill, isPending: false, isError: false }),
  useBillMatch: (_id: string, enabled: boolean) => ({
    data: enabled ? { status: variances.length ? 'VARIANCE' : 'MATCHED', variances } : undefined,
  }),
  useBillPayments: () => ({ data: [] }),
  useBillAction: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
  usePayBill: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useReverseBillPayment: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('@/hooks/use-finance', () => ({ useFinanceAccounts: () => ({ data: [] }) }));
vi.mock('./prepaid-schedules-panel', () => ({ PrepaidSchedulesPanel: () => null }));
vi.mock('@/components/platform/attachments-panel', () => ({ AttachmentsPanel: () => null }));
vi.mock('@/components/platform/activity-timeline', () => ({ ActivityTimeline: () => null }));

function makeBill(status: BillStatus, overrides: Partial<SupplierBillDto> = {}): SupplierBillDto {
  return {
    id: 'b1',
    billNumber: 'BILL-2026-0003',
    supplierInvoiceNumber: 'INV-881',
    supplierId: 's1',
    supplierName: 'Caledon Board Mills',
    purchaseOrderId: 'po1',
    status,
    matchStatus: 'MATCHED',
    currency: 'AED',
    billDate: '2026-10-10',
    dueDate: '2026-11-09',
    subtotalAmount: 1000,
    taxAmount: 50,
    totalAmount: 1050,
    paidAmount: status === 'PARTIALLY_PAID' ? 500 : 0,
    notes: null,
    varianceApproved: false,
    disputeReason: null,
    lines: [],
    createdAt: '2026-10-10T00:00:00Z',
    ...overrides,
  };
}

const qtyOverrun: LineVariance & { lineIndex: number } = {
  code: 'QTY_EXCEEDS_RECEIVED',
  message: '"Boxboard" bills 520, but only 500 has been received and not yet billed',
  actual: 520,
  limit: 500,
  overridable: false,
  lineIndex: 0,
};

const priceOver: LineVariance & { lineIndex: number } = {
  code: 'PRICE_OUTSIDE_TOLERANCE',
  message: '"Boxboard" is billed at 2.2000, 10.0% above the ordered 2.0000 (tolerance 2.0%)',
  actual: 2.2,
  limit: 2.04,
  overridable: true,
  lineIndex: 0,
};

const approveButton = () => screen.queryByRole('button', { name: /approve/i });

describe('BillDetail', () => {
  beforeEach(() => {
    variances = [];
  });

  it('offers Approve on a draft', () => {
    bill = makeBill('DRAFT');
    render(<BillDetail id="b1" />);
    expect(approveButton()).toBeInTheDocument();
  });

  // APPROVED is reachable from PARTIALLY_PAID by the payment flow, not by hand.
  it.each<BillStatus>(['PARTIALLY_PAID', 'APPROVED', 'PAID', 'DISPUTED', 'CANCELLED'])(
    'does not offer Approve on a %s bill',
    (status) => {
      bill = makeBill(status);
      render(<BillDetail id="b1" />);
      expect(approveButton()).not.toBeInTheDocument();
    },
  );

  it('says a quantity overrun cannot be approved, and leads with Dispute', () => {
    bill = makeBill('DRAFT', { matchStatus: 'VARIANCE' });
    variances = [qtyOverrun];
    render(<BillDetail id="b1" />);

    expect(approveButton()).not.toBeInTheDocument();
    expect(screen.getByText(/can’t be approved until the delivery is booked in correctly or the supplier sends a credit note/)).toBeInTheDocument();
    expect(screen.queryByText(/permission to accept a variance/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /dispute/i }).className).toContain('bg-brand');
  });

  it('keeps Approve for a price variance, which needs variance approval', () => {
    bill = makeBill('DRAFT', { matchStatus: 'VARIANCE' });
    variances = [priceOver];
    render(<BillDetail id="b1" />);

    expect(approveButton()).toBeInTheDocument();
    expect(screen.getByText(/needs variance approval/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /dispute/i }).className).not.toContain('bg-brand');
  });
});
