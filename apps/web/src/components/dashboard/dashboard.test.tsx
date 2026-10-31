import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import {
  awaitingApproval,
  jobsOnTheFloor,
  monthlyRevenue,
  overdueInvoices,
  sumQuotes,
  type DashboardInvoice,
  type DashboardQuote,
} from './dashboard-figures';
import { DashboardKpiChart } from './dashboard-kpi-chart';
import { DashboardScheduleCards } from './dashboard-schedule-cards';

const NOW = new Date(2026, 9, 30, 12);

const quote = (overrides: Partial<DashboardQuote>): DashboardQuote => ({
  id: Math.random().toString(36).slice(2),
  quoteNumber: 'QT-2026-0001',
  title: 'Rigid boxes',
  customerName: 'Al Noor Sweets',
  status: 'DRAFT',
  totalAmount: 0,
  currency: 'AED',
  acceptedAt: null,
  createdAt: '2026-10-01T00:00:00Z',
  ...overrides,
});

const invoice = (overrides: Partial<DashboardInvoice>): DashboardInvoice => ({
  amount: 0,
  currency: 'AED',
  status: 'ISSUED',
  issuedAt: '2026-10-05T00:00:00Z',
  ...overrides,
});

describe('dashboard figures', () => {
  it('lists awaiting-approval quotes oldest first and leaves out superseded versions', () => {
    const list = awaitingApproval([
      quote({ id: 'new', status: 'AWAITING_APPROVAL', updatedAt: '2026-10-20T00:00:00Z' }),
      quote({ id: 'old', status: 'AWAITING_APPROVAL', updatedAt: '2026-10-02T00:00:00Z' }),
      quote({ id: 'gone', status: 'AWAITING_APPROVAL', supersededAt: '2026-10-21T00:00:00Z' }),
      quote({ id: 'draft', status: 'DRAFT' }),
    ]);
    expect(list.map((q) => q.id)).toEqual(['old', 'new']);
  });

  it('adds quote values in the base currency only', () => {
    const figure = sumQuotes(
      [quote({ totalAmount: '1000.50' }), quote({ totalAmount: 200 }), quote({ totalAmount: 999, currency: 'USD' })],
      'AED',
    );
    expect(figure).toEqual({ count: 3, amount: 1200.5, otherCurrencies: 1 });
  });

  it('counts overdue invoices and what is still owed on them, never a paid or voided one', () => {
    const figure = overdueInvoices(
      [
        invoice({ amount: 1000, paidAmount: 400, dueDate: '2026-10-10T00:00:00Z' }),
        invoice({ amount: 500, status: 'PARTIALLY_PAID', paidAmount: 100, dueDate: '2026-10-01T00:00:00Z' }),
        invoice({ amount: 800, status: 'PAID', dueDate: '2026-10-01T00:00:00Z' }),
        invoice({ amount: 800, status: 'CANCELLED', dueDate: '2026-10-01T00:00:00Z' }),
        invoice({ amount: 300, dueDate: '2026-11-30T00:00:00Z' }),
        invoice({ amount: 700, currency: 'USD', dueDate: '2026-10-01T00:00:00Z' }),
      ],
      'AED',
      NOW,
    );
    expect(figure).toEqual({ count: 3, amount: 1000, otherCurrencies: 1 });
  });

  it('counts released and running jobs, and the ones past their due date', () => {
    expect(
      jobsOnTheFloor(
        [
          { status: 'RELEASED', dueDate: '2026-10-29T00:00:00Z' },
          { status: 'IN_PROGRESS', dueDate: null },
          { status: 'IN_PROGRESS', dueDate: '2026-11-02T00:00:00Z' },
          { status: 'PLANNED', dueDate: '2026-10-01T00:00:00Z' },
        ],
        NOW,
      ),
    ).toEqual({ count: 3, overdue: 1 });
  });

  it('leaves voided and other-currency invoices out of monthly revenue', () => {
    const { series, otherCurrencies } = monthlyRevenue(
      [
        invoice({ amount: 1000 }),
        invoice({ amount: 5000, status: 'CANCELLED' }),
        invoice({ amount: 700, currency: 'USD' }),
        invoice({ amount: 250, issuedAt: '2026-09-15T00:00:00Z' }),
      ],
      'AED',
      NOW,
    );
    expect(series).toHaveLength(24);
    expect(series.at(-1)).toMatchObject({ label: 'Oct 2026', value: 1000 });
    expect(series.at(-2)?.value).toBe(250);
    expect(otherCurrencies).toBe(1);
  });
});

function series(values: number[]) {
  return values.map((value, i) => {
    const d = new Date(2024, 11 + i, 1);
    return {
      month: d.toLocaleDateString('en-GB', { month: 'short' }),
      label: d.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }),
      value,
    };
  });
}

describe('DashboardKpiChart', () => {
  it('labels its periods in words and links to invoices', () => {
    render(<DashboardKpiChart series={series(Array(24).fill(100))} currency="AED" />);
    for (const label of ['This month', '3 months', '12 months']) {
      expect(screen.getByRole('button', { name: label })).toBeDefined();
    }
    expect(screen.getByRole('link', { name: 'Open invoices' }).getAttribute('href')).toBe('/invoices');
  });

  it('shows a month’s value when its bar is focused or hovered', () => {
    render(<DashboardKpiChart series={series([...Array(23).fill(100), 4200])} currency="AED" />);
    const bars = screen.getByRole('list', { name: /by month/ });
    const last = within(bars).getAllByRole('button').at(-1)!;
    fireEvent.focus(last);
    expect(screen.getByTestId('revenue-readout').textContent).toMatch(/4,200/);
    fireEvent.blur(last);
    fireEvent.mouseEnter(within(bars).getAllByRole('button')[0]);
    expect(screen.getByTestId('revenue-readout').textContent).toMatch(/100/);
  });

  it('colours the growth badge by its sign', () => {
    const { unmount } = render(
      <DashboardKpiChart series={series([...Array(22).fill(100), 200, 100])} currency="AED" />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'This month' }));
    const down = screen.getByTestId('revenue-growth');
    expect(down.textContent).toContain('-50%');
    expect(down.className).toContain('text-danger');
    unmount();

    render(<DashboardKpiChart series={series([...Array(22).fill(100), 100, 150])} currency="AED" />);
    fireEvent.click(screen.getByRole('button', { name: 'This month' }));
    const up = screen.getByTestId('revenue-growth');
    expect(up.textContent).toContain('+50%');
    expect(up.className).toContain('text-success');
  });
});

describe('DashboardScheduleCards', () => {
  it('shows each group with its real count, even when it lists fewer', () => {
    render(
      <DashboardScheduleCards
        groups={[
          {
            key: 'approvals',
            title: 'Your approval',
            count: 7,
            items: [{ id: 'a', reference: 'QT-1', title: 'Gulf Cartons', href: '/quotes/a' }],
            href: '/quotes',
          },
          {
            key: 'drafts',
            title: 'Drafts not yet submitted',
            count: 1,
            items: [{ id: 'b', reference: 'QT-2', title: 'Al Noor', href: '/quotes/b' }],
            href: '/quotes',
          },
        ]}
      />,
    );
    const approvals = screen.getByTestId('waiting-approvals');
    expect(within(approvals).getByText('7')).toBeDefined();
    expect(within(approvals).getByRole('link', { name: /View all 7/ })).toBeDefined();
    expect(screen.getByTestId('waiting-drafts')).toBeDefined();
    // Approvals come first, as given.
    const order = screen.getAllByTestId(/^waiting-/).map((el) => el.dataset.testid);
    expect(order).toEqual(['waiting-approvals', 'waiting-drafts']);
  });
});
