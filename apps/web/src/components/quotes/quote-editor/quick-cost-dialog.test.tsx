import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { QuoteLineItem } from '@saas/shared';
import { api } from '@/lib/api/endpoints';
import { QuickCostDialog } from './quick-cost-dialog';

vi.mock('@/lib/api/endpoints', () => ({
  api: { catalog: { quickCostOptions: vi.fn(), quickCost: vi.fn() } },
  queryKeys: { quickCostOptions: ['catalog', 'quick-cost', 'options'] },
}));

const ACRYLIC = '33333333-3333-4333-8333-333333333333';
const ROUTER = '44444444-4444-4444-8444-444444444444';

const line: QuoteLineItem = {
  id: 'line-1',
  type: 'product',
  description: 'Shop sign, 2m',
  quantity: 1,
  unitPrice: 1000,
  discount: 0,
  subtotal: 1000,
};

const breakdown = {
  materials: [{ materialId: ACRYLIC, name: 'Acrylic', uom: 'SHEET', quantity: 2, wastePct: 0.1, purchaseUnits: 3, unitCost: 180, cost: 540 }],
  hours: [],
  boughtIn: [],
  materialCost: 540,
  machineCost: 0,
  laborCost: 0,
  boughtInCost: 0,
  directCost: 540,
  overheadPct: 0,
  overheadCost: 0,
  totalCost: 540,
  unitCost: 540,
  quantity: 1,
  scale: 1,
};

function renderDialog(onApply = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <QuickCostDialog line={line} currency="AED" onClose={() => {}} onApply={onApply} />
    </QueryClientProvider>,
  );
  return onApply;
}

describe('QuickCostDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    HTMLDialogElement.prototype.showModal ??= function showModal(this: HTMLDialogElement) {
      this.setAttribute('open', '');
    };
    vi.mocked(api.catalog.quickCostOptions).mockResolvedValue({
      materials: [{ id: ACRYLIC, sku: 'ACR-5', name: 'Acrylic 5mm', uom: 'SHEET', costPerUom: 180, wastePct: 0.1 }],
      workCenters: [{ id: ROUTER, name: 'CNC router', ratePerHour: 100, minChargeMinutes: 0 }],
      defaultOverheadPct: 0,
      targetMarginPct: 0.25,
      floorEnforced: true,
    });
    vi.mocked(api.catalog.quickCost).mockResolvedValue({
      breakdown,
      subtotal: 1000,
      marginAmount: 460,
      marginPct: 0.46,
      targetMarginPct: 0.25,
      suggestedUnitPrice: 720,
    } as never);
  });

  it('costs the chosen material on the server and applies the suggested price', async () => {
    const onApply = renderDialog();
    fireEvent.click(await screen.findByRole('button', { name: /add material/i }));
    fireEvent.change(screen.getByLabelText('Material'), { target: { value: ACRYLIC } });
    fireEvent.change(screen.getByLabelText('Quantity used'), { target: { value: '2' } });

    await waitFor(() =>
      expect(api.catalog.quickCost).toHaveBeenCalledWith({
        quickCost: {
          materials: [{ materialId: ACRYLIC, quantity: 2 }],
          hours: [],
          boughtIn: [],
          overheadPct: 0,
          costedForQuantity: 1,
        },
        quantity: 1,
        unitPrice: 1000,
        discount: 0,
      }),
    );
    expect(await screen.findByText(/3 sheets with 10% waste/)).toBeTruthy();
    expect(screen.getByText(/46% \(/)).toBeTruthy();
    expect(screen.getByText(/keeps your 25% margin floor/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /^Use AED/ }));
    expect(onApply).toHaveBeenCalledWith(
      'line-1',
      expect.objectContaining({
        unitPrice: 720,
        cost: expect.objectContaining({ totalCost: 540, source: 'QUICK' }),
      }),
    );
  });

  it('asks for an input before it shows a cost', async () => {
    renderDialog();
    expect(await screen.findByText(/Add a material, some hours or a bought-in item/)).toBeTruthy();
    expect(api.catalog.quickCost).not.toHaveBeenCalled();
  });
});
