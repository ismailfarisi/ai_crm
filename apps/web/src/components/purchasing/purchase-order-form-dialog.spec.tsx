import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { PurchaseOrderFormDialog } from './purchase-order-form-dialog';
import { useSuppliers } from '@/hooks/use-suppliers';
import { useMaterials } from '@/hooks/use-catalog-admin';
import { useCreatePurchaseOrder } from '@/hooks/use-purchase-orders';

vi.mock('@/hooks/use-suppliers', () => ({ useSuppliers: vi.fn() }));
vi.mock('@/hooks/use-catalog-admin', () => ({ useMaterials: vi.fn() }));
vi.mock('@/hooks/use-purchase-orders', () => ({ useCreatePurchaseOrder: vi.fn() }));
vi.mock('@/hooks/use-organization', () => ({
  useOrganization: () => ({ data: { baseCurrency: 'AED' } }),
}));

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

const SUPPLIER_ID = '11111111-1111-4111-8111-111111111111';
const EURO_SUPPLIER_ID = '44444444-4444-4444-8444-444444444444';

const material = {
  id: '22222222-2222-4222-8222-222222222222',
  sku: 'FBB-350',
  name: '350gsm folding boxboard',
  uom: 'SHEET',
  costPerUom: 0.42,
  sheetWidthMm: 700,
  sheetHeightMm: 1000,
  grain: 'LENGTH',
  wastePct: 0.05,
  isActive: true,
  createdAt: '2026-09-16T00:00:00Z',
  updatedAt: '2026-09-16T00:00:00Z',
};

const suppliers = [
  { id: SUPPLIER_ID, companyName: 'Caledon Board Mills', currency: null },
  { id: EURO_SUPPLIER_ID, companyName: 'Rotterdam Karton', currency: 'EUR' },
];

function loaded() {
  return {
    data: { items: suppliers, meta: { total: suppliers.length } },
    isPending: false,
    isError: false,
    isFetching: false,
    refetch: vi.fn(),
  };
}

describe('PurchaseOrderFormDialog', () => {
  let mutateAsync: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    push.mockReset();
    vi.mocked(useSuppliers).mockReset();
    mutateAsync = vi.fn().mockResolvedValue({ id: '33333333-3333-4333-8333-333333333333', poNumber: 'PO-2026-0001' });

    vi.mocked(useSuppliers).mockReturnValue(loaded() as never);
    vi.mocked(useMaterials).mockReturnValue({ data: [material] } as never);
    vi.mocked(useCreatePurchaseOrder).mockReturnValue({ mutateAsync } as never);
  });

  it('offers the suppliers and materials the tenant actually has', () => {
    render(<PurchaseOrderFormDialog open onClose={vi.fn()} />);

    expect(screen.getByRole('option', { name: 'Caledon Board Mills' })).toBeInTheDocument();
    expect(
      screen.getByRole('option', { name: '350gsm folding boxboard (FBB-350)' }),
    ).toBeInTheDocument();
  });

  // The list endpoint answers 400 above 100, which left the picker empty and
  // no purchase order could be raised.
  it('never asks for more suppliers than the API will return', () => {
    render(<PurchaseOrderFormDialog open onClose={vi.fn()} />);

    for (const [params] of vi.mocked(useSuppliers).mock.calls) {
      expect(params.limit).toBeLessThanOrEqual(100);
    }
  });

  it('searches the suppliers as the buyer types', async () => {
    render(<PurchaseOrderFormDialog open onClose={vi.fn()} />);

    fireEvent.change(screen.getByLabelText('Find a supplier'), { target: { value: 'rotter' } });

    await waitFor(() =>
      expect(vi.mocked(useSuppliers)).toHaveBeenLastCalledWith(
        expect.objectContaining({ search: 'rotter', limit: 100 }),
      ),
    );
  });

  it('says the suppliers failed to load, and retries, instead of claiming there are none', () => {
    const refetch = vi.fn();
    vi.mocked(useSuppliers).mockReturnValue({
      data: undefined,
      isPending: false,
      isError: true,
      isFetching: false,
      error: new Error('limit must be at most 100'),
      refetch,
    } as never);

    render(<PurchaseOrderFormDialog open onClose={vi.fn()} />);

    expect(screen.queryByRole('option', { name: 'No suppliers yet' })).not.toBeInTheDocument();
    expect(screen.getByText(/Suppliers did not load: limit must be at most 100/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(refetch).toHaveBeenCalled();
  });

  // Picking a material should save the buyer retyping what the catalog knows,
  // while leaving every field editable for the price on the day.
  it('fills a line from the material picked, and totals it in the base currency', () => {
    render(<PurchaseOrderFormDialog open onClose={vi.fn()} />);

    fireEvent.change(screen.getByLabelText('Material'), { target: { value: material.id } });

    expect(screen.getByLabelText(/^Description/)).toHaveValue('350gsm folding boxboard');
    expect(screen.getByLabelText('Unit cost (AED)')).toHaveValue(0.42);

    fireEvent.change(screen.getByLabelText('Quantity'), { target: { value: '500' } });

    // Once on the line, once as the order total. Never dollars.
    expect(screen.getAllByText('AED 210.00')).toHaveLength(2);
    expect(screen.queryByText(/\$/)).not.toBeInTheDocument();
  });

  it('prices the order in the chosen supplier’s currency', () => {
    render(<PurchaseOrderFormDialog open onClose={vi.fn()} />);

    fireEvent.change(screen.getByLabelText(/^Supplier/), { target: { value: EURO_SUPPLIER_ID } });
    fireEvent.change(screen.getByLabelText('Material'), { target: { value: material.id } });
    fireEvent.change(screen.getByLabelText('Quantity'), { target: { value: '500' } });

    expect(screen.getByLabelText('Unit cost (EUR)')).toHaveValue(0.42);
    expect(screen.getAllByText('€210.00')).toHaveLength(2);
  });

  it('labels every field on every line', () => {
    render(<PurchaseOrderFormDialog open onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /add line/i }));

    const second = within(screen.getByRole('group', { name: 'Line 2' }));
    for (const name of ['Material', /^Description/, 'Quantity', 'Unit', 'Unit cost (AED)']) {
      expect(second.getByLabelText(name)).toBeInTheDocument();
    }
  });

  it('submits a draft and opens the order it created', async () => {
    const onClose = vi.fn();
    render(<PurchaseOrderFormDialog open onClose={onClose} />);

    fireEvent.change(screen.getByLabelText(/^Supplier/), { target: { value: SUPPLIER_ID } });
    fireEvent.change(screen.getByLabelText('Material'), { target: { value: material.id } });
    fireEvent.change(screen.getByLabelText('Quantity'), { target: { value: '500' } });

    fireEvent.click(screen.getByRole('button', { name: /create draft/i }));

    await waitFor(() => expect(mutateAsync).toHaveBeenCalled());

    expect(mutateAsync.mock.calls[0][0]).toMatchObject({
      supplierId: SUPPLIER_ID,
      lines: [
        {
          materialId: material.id,
          description: '350gsm folding boxboard',
          qtyOrdered: 500,
          uom: 'SHEET',
          unitCost: 0.42,
        },
      ],
    });
    expect(push).toHaveBeenCalledWith('/purchasing/orders/33333333-3333-4333-8333-333333333333');
    expect(onClose).toHaveBeenCalled();
  });

  it('refuses an order with no description on a line', async () => {
    render(<PurchaseOrderFormDialog open onClose={vi.fn()} />);

    fireEvent.change(screen.getByLabelText(/^Supplier/), { target: { value: SUPPLIER_ID } });
    fireEvent.click(screen.getByRole('button', { name: /create draft/i }));

    expect(await screen.findByText('Each line needs a description')).toBeInTheDocument();
    expect(mutateAsync).not.toHaveBeenCalled();
  });
});
