import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ReportsView } from './reports-view';
import { useFinancialReport } from '@/hooks/use-platform';

let allowed: string[] = [];
let reportData: unknown;
let shownReport = '';

vi.mock('@/lib/session-context', () => ({
  useCan: (rule: { permission: string | string[] }) => {
    const need = Array.isArray(rule.permission) ? rule.permission : [rule.permission];
    return need.every((p) => allowed.includes(p));
  },
}));
vi.mock('@/hooks/use-platform', () => ({
  useFinancialReport: vi.fn((report: string) => ({ data: report === shownReport ? reportData : undefined, error: null })),
  downloadReportCsv: vi.fn(),
}));
vi.mock('../finance-nav', () => ({ FinanceNav: () => null }));

const zeroIndirect = { CLEANING: 0, MAINTENANCE: 0, TRAINING: 0, IDLE: 0, OTHER: 0 };
const labour = (status: 'ACTUAL' | 'PROVISIONAL') => ({
  period: '2026-09',
  status,
  rows: [
    {
      employeeId: 'e1', employeeNumber: 'E-001', employeeName: 'Asha Rao',
      standardHours: 176, directHours: 120, indirectHours: { ...zeroIndirect, CLEANING: 4, TRAINING: 6 },
      unloggedHours: 46, cost: 5000, absorbed: 3400, unabsorbed: 1600,
    },
    {
      employeeId: 'e2', employeeNumber: 'E-002', employeeName: 'Ben Cole',
      standardHours: 176, directHours: 100, indirectHours: zeroIndirect,
      unloggedHours: 76, cost: 4000, absorbed: 2000, unabsorbed: 2000,
    },
  ],
  totals: {
    standardHours: 352, directHours: 220, indirectHours: { ...zeroIndirect, CLEANING: 4, TRAINING: 6 },
    unloggedHours: 122, cost: 9000, absorbed: 5400, unabsorbed: 3600,
  },
});

const openTab = (name: string) => fireEvent.click(screen.getByRole('tab', { name }));

describe('reports: labour', () => {
  beforeEach(() => {
    allowed = ['finance:read', 'payroll:read', 'quote:view_cost', 'finance:export'];
    reportData = undefined;
    vi.mocked(useFinancialReport).mockClear();
  });

  it('flags margin rows that carry provisional labour', () => {
    shownReport = 'margins';
    reportData = {
      by: 'customer',
      rows: [
        { key: 'a', label: 'Acme', orders: 1, revenue: 100, cost: 60, margin: 40, marginPct: 0.4, measuredCostShare: 1, provisionalLabourShare: 0.25 },
        { key: 'b', label: 'Beta', orders: 1, revenue: 100, cost: 60, margin: 40, marginPct: 0.4, measuredCostShare: 1, provisionalLabourShare: 0 },
        { key: 'c', label: 'Gamma', orders: 1, revenue: 100, cost: 60, margin: 40, marginPct: 0.4, measuredCostShare: 1, provisionalLabourShare: 0.003 },
      ],
    };
    render(<ReportsView />);
    openTab('Margins');
    const badges = screen.getAllByText('provisional');
    expect(badges).toHaveLength(2);
    expect(badges[0].getAttribute('title')).toBe('25% of cost is labour waiting on payroll');
    // Under half a percent reads "<1%", never "0%".
    expect(badges[1].getAttribute('title')).toBe('<1% of cost is labour waiting on payroll');
  });

  it('does not query labour utilisation while the month is empty', () => {
    shownReport = 'labour-utilisation';
    reportData = labour('ACTUAL');
    render(<ReportsView />);
    openTab('Labour');
    fireEvent.change(screen.getByLabelText('Month'), { target: { value: '' } });
    expect(screen.getByText('Pick a month.')).toBeTruthy();
    const last = vi.mocked(useFinancialReport).mock.calls.at(-1)!;
    expect(last[0]).toBe('labour-utilisation');
    expect(last[2]).toBe(false);
  });

  it('hides the Labour tab unless the user holds finance:read and payroll:read', () => {
    allowed = ['finance:read'];
    const { unmount } = render(<ReportsView />);
    expect(screen.queryByRole('tab', { name: 'Labour' })).toBeNull();
    unmount();
    allowed = ['payroll:read'];
    render(<ReportsView />);
    expect(screen.queryByRole('tab', { name: 'Labour' })).toBeNull();
  });

  it('renders rows and totals, queries by month, and has no CSV button', () => {
    shownReport = 'labour-utilisation';
    reportData = labour('ACTUAL');
    render(<ReportsView />);
    expect(screen.getByRole('button', { name: /CSV/ })).toBeTruthy();
    openTab('Labour');
    expect(screen.getByText('Asha Rao', { exact: false })).toBeTruthy();
    expect(screen.getByText('Ben Cole', { exact: false })).toBeTruthy();
    const total = screen.getByText('Total').closest('tr')!;
    expect(total.textContent).toContain('352');
    expect(total.textContent).toContain('9,000.00');
    expect(total.textContent).toContain('3,600.00');
    expect(screen.queryByText(/Provisional — payroll not posted/)).toBeNull();
    expect(screen.queryByRole('button', { name: /CSV/ })).toBeNull();
    const asha = screen.getByText('Asha Rao', { exact: false }).closest('tr')!;
    const indirect = asha.querySelectorAll('td')[3];
    expect(indirect.textContent).toBe('10');
    expect(indirect.getAttribute('title')).toContain('Cleaning: 4 h');
    expect(indirect.getAttribute('title')).toContain('Training: 6 h');
    const last = vi.mocked(useFinancialReport).mock.calls.at(-1)!;
    expect(last[0]).toBe('labour-utilisation');
    expect(last[1]).toEqual({ period: expect.stringMatching(/^\d{4}-\d{2}$/) });
  });

  it('labels a provisional month as estimated', () => {
    shownReport = 'labour-utilisation';
    reportData = labour('PROVISIONAL');
    render(<ReportsView />);
    openTab('Labour');
    expect(screen.getByText(/Provisional — payroll not posted/)).toBeTruthy();
    expect(screen.getByText('Est. cost')).toBeTruthy();
  });
});
