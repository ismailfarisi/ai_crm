import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { OrderJobCostDto } from '@saas/shared';
import { JobCostBody } from './job-cost-card';

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const base: OrderJobCostDto = {
  orderId: 'so-1',
  currency: 'AED',
  price: 22890,
  quotedCost: 13640,
  quotedCostComplete: true,
  quotedMargin: 9250,
  actual: { material: 0, labour: 0, machineAndOverhead: 0, boughtIn: 5850, total: 5850 },
  onOrder: 1800,
  marginLeft: 17040,
  marginLeftPct: 0.7444,
  overByPct: -0.5711,
  alertPct: 0.1,
  overBudget: false,
  workOrders: 0,
  sources: [
    {
      kind: 'SUPPLIER_BILL',
      id: 'bill-1',
      number: 'BILL-2026-0003',
      party: 'Gulf Crane & Lift Hire',
      description: 'Crane hire, 4 hours',
      counted: 2200,
      onOrder: 0,
    },
  ],
};

describe('JobCostBody', () => {
  it('shows the margin left and what is still on order', () => {
    render(<JobCostBody cost={base} />);
    expect(screen.getByRole('heading', { name: /margin left/i })).toBeTruthy();
    expect(screen.getByText(/ordered from suppliers but has not arrived/)).toBeTruthy();
    expect(screen.getByRole('link', { name: /Supplier bill BILL-2026-0003/ }).getAttribute('href')).toBe(
      '/purchasing/bills/bill-1',
    );
  });

  it('warns when the job is past the threshold', () => {
    render(
      <JobCostBody
        cost={{ ...base, overBudget: true, overByPct: 0.19, actual: { ...base.actual, boughtIn: 16232, total: 16232 }, marginLeft: 6658, onOrder: 0 }}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Over budget: 19% more than quoted' })).toBeTruthy();
    expect(screen.getByText(/warned past 10%/)).toBeTruthy();
  });

  it('works for typed lines with no quoted cost', () => {
    render(<JobCostBody cost={{ ...base, quotedCost: null, quotedMargin: null, overByPct: null }} />);
    expect(screen.getByText(/The quote had no cost, so there is nothing to compare against/)).toBeTruthy();
    expect(screen.getByText('The quote had no cost on its lines')).toBeTruthy();
  });
});
