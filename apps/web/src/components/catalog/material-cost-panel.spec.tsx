import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { MaterialCostReview, QuoteCostCheck } from '@saas/shared';
import { MaterialCostPanel } from './material-cost-panel';
import * as hooks from '@/hooks/use-catalog-admin';

vi.mock('@/hooks/use-catalog-admin', () => ({
  useMaterialCosts: vi.fn(),
  useQuoteCostChanges: vi.fn(),
  useApplyMaterialCost: vi.fn(),
  useRecostQuote: vi.fn(),
}));
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));

const review: MaterialCostReview = {
  checked: 1,
  notes: [],
  rows: [
    {
      id: 'MATERIAL:m1',
      target: { type: 'MATERIAL', id: 'm1', name: 'Corrugated board C-flute' },
      field: 'costPerUom',
      uom: 'sheet',
      current: 7.5,
      suggested: 'LAST_PURCHASE',
      reason: 'Quotes use 7.50 per sheet; the last price paid is 8.35, 11.3% more.',
      figures: [
        { basis: 'LAST_PURCHASE', unitCost: 8.35, gapPct: 0.1133, detail: 'Paid 8.35 per sheet on 2026-11-25.' },
        { basis: 'AVERAGE', unitCost: 8.01, gapPct: 0.068, detail: 'Stock on hand (1000 sheet) cost 8.01 per sheet on average.' },
      ],
    },
  ],
};

const stale = {
  quoteId: 'q1',
  quoteNumber: 'QT-2026-0001',
  customerName: 'Gulf Fresh Dates LLC',
  currency: 'AED',
  status: 'DRAFT',
  moved: true,
  savedCost: 10218.11,
  currentCost: 11198.67,
  subtotal: 12800,
  savedMarginPct: 0.2017,
  currentMarginPct: 0.1251,
  repricedSubtotal: 14940,
  repricedMarginPct: 0.25,
  canReprice: true,
  lines: [],
} as unknown as QuoteCostCheck;

describe('MaterialCostPanel', () => {
  const apply = vi.fn();
  const recost = vi.fn();
  beforeEach(() => {
    vi.mocked(hooks.useMaterialCosts).mockReturnValue({ data: review, isPending: false, isError: false } as never);
    vi.mocked(hooks.useQuoteCostChanges).mockReturnValue({ data: [stale], isPending: false } as never);
    vi.mocked(hooks.useApplyMaterialCost).mockReturnValue({ mutate: apply, isPending: false } as never);
    vi.mocked(hooks.useRecostQuote).mockReturnValue({ mutate: recost, isPending: false } as never);
  });

  it('shows the gap and sends only the chosen figure, never an amount', () => {
    render(<MaterialCostPanel currency="AED" />);
    expect(screen.getByText(/the last price paid is 8.35, 11.3% more/)).toBeTruthy();
    expect(screen.getByText(/Quoting too low by 11.3%/)).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: 'Use this' })[1]);
    fireEvent.click(screen.getByRole('button', { name: 'Update cost' }));
    expect(apply).toHaveBeenCalledWith(
      { row: review.rows[0], basis: 'AVERAGE' },
      expect.anything(),
    );
  });

  it('lists open quotes on old costs and re-costs keeping prices', () => {
    render(<MaterialCostPanel currency="AED" />);
    expect(screen.getByText(/QT-2026-0001 · Gulf Fresh Dates LLC/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Re-cost' }));
    fireEvent.click(screen.getByRole('button', { name: 'Update costs, keep prices' }));
    expect(recost).toHaveBeenCalledWith({ id: 'q1', mode: 'COSTS' }, expect.anything());
  });
});
