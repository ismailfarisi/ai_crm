import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { CostingReviewDto } from '@saas/shared';
import { CostingReviewPanel } from './costing-review-panel';
import { useApplyCostingProposal, useCostingReview } from '@/hooks/use-catalog-admin';

vi.mock('@/hooks/use-catalog-admin', () => ({ useCostingReview: vi.fn(), useApplyCostingProposal: vi.fn() }));

const review = (over: Partial<CostingReviewDto> = {}): CostingReviewDto => ({
  windowDays: 180,
  from: '2026-05-02',
  jobs: 4,
  estimatedTotal: 1000,
  actualTotal: 1150,
  variancePct: 15,
  byComponent: [
    { component: 'material', estimated: 600, actual: 700 },
    { component: 'machine', estimated: 250, actual: 300 },
    { component: 'labor', estimated: 150, actual: 150 },
    { component: 'tooling', estimated: 0, actual: 0 },
    { component: 'overhead', estimated: 0, actual: 0 },
  ],
  proposals: [
    {
      id: 'MATERIAL_WASTE:m1',
      kind: 'MATERIAL_WASTE',
      target: { type: 'MATERIAL', id: 'm1', name: 'Kraft board 300gsm' },
      field: 'wastePct',
      current: 0.05,
      proposed: 0.12,
      jobs: 3,
      workOrderNumbers: ['WO-2026-0011', 'WO-2026-0014', 'WO-2026-0019'],
      impact: 50.4,
      capped: false,
      reason: '3 jobs used 336 sheet against 315 planned.',
    },
  ],
  notes: ['Laser cutter ran 30.0% faster than its templates assume across 3 jobs.'],
  ...over,
});

describe('CostingReviewPanel', () => {
  let apply: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    apply = vi.fn();
    vi.mocked(useCostingReview).mockReturnValue({ data: review(), isPending: false, isError: false } as never);
    vi.mocked(useApplyCostingProposal).mockReturnValue({ mutate: apply, isPending: false } as never);
  });

  it('shows how far actual cost ran from the estimate, by component', () => {
    render(<CostingReviewPanel currency="AED" />);
    expect(screen.getByText(/4 jobs completed since/)).toBeInTheDocument();
    expect(screen.getByText(/15\.0% over estimate/)).toBeInTheDocument();
    expect(screen.getByText('Material')).toBeInTheDocument();
    // Components with nothing on either side are left out.
    expect(screen.queryByText('Tooling')).not.toBeInTheDocument();
  });

  it('states each proposal as a change with its evidence and what it cost', () => {
    render(<CostingReviewPanel currency="AED" />);
    const card = screen.getByTestId('costing-proposal');
    expect(card).toHaveTextContent('Kraft board 300gsm');
    expect(card).toHaveTextContent('Waste allowance: 5% → 12%');
    expect(card).toHaveTextContent('WO-2026-0011');
    expect(card).toHaveTextContent('Under-quoted');
    expect(screen.getByText(/Laser cutter ran 30\.0% faster/)).toBeInTheDocument();
  });

  it('applies a proposal only after it is confirmed', () => {
    render(<CostingReviewPanel currency="AED" />);
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(apply).not.toHaveBeenCalled();
    expect(screen.getByText(/Quotes priced from now on use the new value/)).toBeInTheDocument();

    const buttons = screen.getAllByRole('button', { name: 'Apply' });
    fireEvent.click(buttons[buttons.length - 1]);
    expect(apply).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'MATERIAL_WASTE:m1', proposed: 0.12 }),
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
  });

  it('says plainly when there is nothing to correct', () => {
    vi.mocked(useCostingReview).mockReturnValue({
      data: review({ proposals: [], notes: [] }),
      isPending: false,
      isError: false,
    } as never);
    render(<CostingReviewPanel currency="AED" />);
    expect(screen.getByText('Nothing to correct')).toBeInTheDocument();
  });

  it('reads a longer window when asked', () => {
    render(<CostingReviewPanel currency="AED" />);
    fireEvent.change(screen.getByLabelText('Jobs completed in'), { target: { value: '365' } });
    expect(useCostingReview).toHaveBeenLastCalledWith(365);
  });
});
