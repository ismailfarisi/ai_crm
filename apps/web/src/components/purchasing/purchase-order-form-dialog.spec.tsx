import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { PurchaseOrderFormDialog } from './purchase-order-form-dialog';
import { useSuppliers } from '@/hooks/use-suppliers';
import { useMaterials } from '@/hooks/use-catalog-admin';
import { useCreatePurchaseOrder } from '@/hooks/use-purchase-orders';

vi.mock('@/hooks/use-suppliers', () => ({ useSuppliers: vi.fn() }));
vi.mock('@/hooks/use-catalog-admin', () => ({ useMaterials: vi.fn() }));
vi.mock('@/hooks/use-purchase-orders', () => ({ useCreatePurchaseOrder: vi.fn() }));

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

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

describe('PurchaseOrderFormDialog', () => {
  let mutateAsync: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    push.mockReset();
    mutateAsync = vi.fn().mockResolvedValue({ id: '33333333-3333-4333-8333-333333333333', poNumber: 'PO-2026-0001' });

    vi.mocked(useSuppliers).mockReturnValue({
      data: { items: [{ id: '11111111-1111-4111-8111-111111111111', companyName: 'Caledon Board Mills' }] },
    } as never);
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

  // Picking a material should save the buyer retyping what the catalog knows,
  // while leaving every field editable for the price on the day.
  it('fills a line from the material picked, and totals it', () => {
    render(<PurchaseOrderFormDialog open onClose={vi.fn()} />);

    fireEvent.change(screen.getByLabelText('Material'), { target: { value: '22222222-2222-4222-8222-222222222222' } });

    expect(screen.getByLabelText(/^Description/)).toHaveValue('350gsm folding boxboard');
    expect(screen.getByLabelText('Unit cost')).toHaveValue(0.42);

    fireEvent.change(screen.getByLabelText('Quantity'), { target: { value: '500' } });

    // Once on the line, once as the order total.
    expect(screen.getAllByText('$210.00')).toHaveLength(2);
  });

  it('submits a draft and opens the order it created', async () => {
    const onClose = vi.fn();
    render(<PurchaseOrderFormDialog open onClose={onClose} />);

    fireEvent.change(screen.getByLabelText(/^Supplier/), { target: { value: '11111111-1111-4111-8111-111111111111' } });
    fireEvent.change(screen.getByLabelText('Material'), { target: { value: '22222222-2222-4222-8222-222222222222' } });
    fireEvent.change(screen.getByLabelText('Quantity'), { target: { value: '500' } });

    fireEvent.click(screen.getByRole('button', { name: /create draft/i }));

    await waitFor(() => expect(mutateAsync).toHaveBeenCalled());

    expect(mutateAsync.mock.calls[0][0]).toMatchObject({
      supplierId: '11111111-1111-4111-8111-111111111111',
      lines: [
        {
          materialId: '22222222-2222-4222-8222-222222222222',
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

    fireEvent.change(screen.getByLabelText(/^Supplier/), { target: { value: '11111111-1111-4111-8111-111111111111' } });
    fireEvent.click(screen.getByRole('button', { name: /create draft/i }));

    expect(await screen.findByText('Each line needs a description')).toBeInTheDocument();
    expect(mutateAsync).not.toHaveBeenCalled();
  });
});
