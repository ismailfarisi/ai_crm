import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
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
const aging = vi.hoisted(() => ({
  data: undefined as unknown,
  loading: false,
  asOf: [] as (string | undefined)[],
}));
vi.mock('@/hooks/use-bills', () => ({
  useBills: () => ({ data: { items: [bill] }, isPending: false, isError: false }),
  useBillAging: (asOf?: string) => {
    aging.asOf.push(asOf);
    return { data: aging.data, isPlaceholderData: aging.loading };
  },
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

describe('BillsView: what is owed', () => {
  const buckets = { CURRENT: 3175, DAYS_1_30: 0, DAYS_31_60: 0, DAYS_61_90: 0, DAYS_OVER_90: 0 };
  const report = (over: object) => ({ asOf: '2026-11-24T00:00:00Z', buckets, total: 3175, ledgerBalance: 3175, difference: 0, bills: [], ...over });

  it('shows an approved claim awaiting reimbursement plainly, with no warning', () => {
    aging.data = report({
      ledgerBalance: 3490,
      staffClaimsTotal: 315,
      staffClaims: [{ id: 'c1', claimNumber: 'EXP-2026-0004', employeeName: 'Layla Haddad', outstanding: 315 }],
    });
    render(<BillsView />);
    const note = screen.getByTestId('staff-claims-owed');
    expect(note).toHaveTextContent('Also owed to staff: 315.00 on expense claim EXP-2026-0004 (Layla Haddad)');
    expect(note).toHaveTextContent('the payables account holds 3,490.00');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('warns only when the account holds something neither bills nor claims explain', () => {
    aging.data = report({ ledgerBalance: 3530, staffClaimsTotal: 315, staffClaims: [], difference: -40 });
    render(<BillsView />);
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Bills and approved expense claims total 3,490.00 but the payables account holds 3,530.00',
    );
  });

  it('asks for the report as of the date chosen', () => {
    aging.data = report({});
    render(<BillsView />);
    fireEvent.change(screen.getByLabelText('As of date'), { target: { value: '2026-11-01' } });
    expect(aging.asOf.at(-1)).toBe('2026-11-01');
  });

  it('does not put the new date on the last report while the new one loads', () => {
    aging.data = report({});
    aging.loading = true;
    render(<BillsView />);
    fireEvent.change(screen.getByLabelText('As of date'), { target: { value: '2026-11-18' } });
    expect(screen.queryByTestId('bills-owed-on-date')).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'What is owed' })).toHaveAttribute('aria-busy', 'true');
    aging.loading = false;
  });

  it('waits for a whole year while a date is typed by hand', () => {
    aging.data = report({});
    render(<BillsView />);
    const input = screen.getByLabelText('As of date');
    fireEvent.change(input, { target: { value: '0002-11-23' } });
    expect(aging.asOf.at(-1)).toBeUndefined();
    expect(input).toHaveValue('0002-11-23');
    fireEvent.change(input, { target: { value: '2026-11-23' } });
    expect(aging.asOf.at(-1)).toBe('2026-11-23');
  });

  it('lists each bill at its balance on a past date, apart from the list of bills as they stand today', () => {
    aging.data = report({
      total: 120000,
      ledgerBalance: 120000,
      bills: [
        {
          id: 'bill-1',
          billNumber: 'BILL-2026-0001',
          supplierName: 'Steel Co',
          dueDate: null,
          outstanding: 120000,
          bucket: 'CURRENT',
        },
      ],
    });
    render(<BillsView />);
    expect(screen.queryByTestId('bills-owed-on-date')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('As of date'), { target: { value: '2026-11-22' } });
    const owed = screen.getByTestId('bills-owed-on-date');
    expect(owed).toHaveTextContent('Bills owed on 2026-11-22');
    expect(owed).toHaveTextContent('BILL-2026-0001');
    expect(owed).toHaveTextContent('120,000.00');
    expect(owed).toHaveTextContent('as it stands today, not on 2026-11-22');
  });
});
