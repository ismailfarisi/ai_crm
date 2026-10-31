import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import type { SalesOrderDto } from '@saas/shared';
import { OrderDetail } from './order-detail';
import { OrderStatusPill } from './orders-view';

const setStatus = vi.fn();
const planWork = vi.fn();
let order: SalesOrderDto;

vi.mock('@/hooks/use-sales-orders', () => ({
  useSalesOrder: () => ({ data: order, isPending: false, isError: false, error: null }),
  useInvoiceStage: () => ({ mutateAsync: vi.fn(), isPending: false, variables: undefined }),
  useSalesOrderAction: () => ({ mutateAsync: setStatus, mutate: vi.fn(), isPending: false, variables: undefined }),
}));

vi.mock('@/hooks/use-work-orders', () => ({
  usePlanWorkOrders: () => ({ mutateAsync: planWork, isPending: false }),
  useWorkOrders: () => ({ data: [] }),
}));

vi.mock('@/lib/session-context', () => ({
  useCan: () => false,
  useSession: () => ({ check: () => true }),
}));

// Deliveries have their own data and are not what is under test here.
vi.mock('./order-deliveries', () => ({ OrderDeliveries: () => null }));

beforeEach(() => {
  setStatus.mockReset().mockResolvedValue({});
  planWork.mockReset().mockResolvedValue({ created: [], skipped: [] });
  order = {
    id: 'so-1',
    orderNumber: 'SO-2026-0007',
    quoteId: 'q-1',
    quoteNumber: 'QT-2026-0042',
    customerId: null,
    customerName: 'Al Noor Sweets',
    status: 'OPEN',
    currency: 'AED',
    subtotalAmount: 1000,
    discountAmount: 0,
    taxAmount: 50,
    totalAmount: 1050,
    invoicedAmount: 0,
    paidAmount: 0,
    acceptedAt: null,
    acceptedByName: null,
    lines: [
      { id: 'l-1', description: 'Rigid box', uom: 'pcs', qtyOrdered: 100, qtyFulfilled: 60, unitPrice: 6, lineTotal: 600 },
      { id: 'l-2', description: 'Sleeve', uom: 'pcs', qtyOrdered: 100, qtyFulfilled: 100, unitPrice: 4, lineTotal: 400 },
    ],
    billingSchedule: [],
    createdAt: '2026-10-01T00:00:00Z',
  } as SalesOrderDto;
});

describe('OrderDetail', () => {
  it('shows subtotal, VAT and total under the lines', () => {
    render(<OrderDetail id="so-1" />);
    const foot = screen.getByRole('rowheader', { name: 'VAT' }).closest('tfoot')!;
    expect(within(foot).getByText('AED 1,000.00')).toBeDefined();
    expect(within(foot).getByText('AED 50.00')).toBeDefined();
    expect(within(foot).getByText('AED 1,050.00')).toBeDefined();
  });

  it('has one amber button in the header: the next step', () => {
    render(<OrderDetail id="so-1" />);
    const amber = screen.getAllByRole('button').filter((b) => b.className.includes('bg-brand'));
    expect(amber.map((b) => b.textContent)).toEqual(['Start production']);
  });

  it('asks before marking fulfilled, and says what has not shipped', async () => {
    render(<OrderDetail id="so-1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Mark fulfilled' }));
    expect(setStatus).not.toHaveBeenCalled();

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/1 of 2 lines have not shipped in full/)).toBeDefined();
    expect(within(dialog).getByText('60 of 100 pcs')).toBeDefined();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Mark fulfilled' }));
    await waitFor(() => expect(setStatus).toHaveBeenCalledWith({ id: 'so-1', status: 'FULFILLED' }));
  });

  it('asks before starting production or planning work orders', async () => {
    render(<OrderDetail id="so-1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Plan production' }));
    expect(planWork).not.toHaveBeenCalled();
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Plan production' }));
    await waitFor(() => expect(planWork).toHaveBeenCalledWith({ salesOrderId: 'so-1' }));
  });
});

describe('OrderStatusPill', () => {
  it('uses the shared badge with a real token', () => {
    render(<OrderStatusPill status="OPEN" />);
    const pill = screen.getByText('Open');
    expect(pill.className).toContain('text-info');
    expect(pill.className).not.toContain('accent');
  });
});
