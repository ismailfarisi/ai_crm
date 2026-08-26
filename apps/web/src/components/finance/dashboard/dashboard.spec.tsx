import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { FinanceAccountDto, TreasuryOverviewDto } from '@saas/shared';
import {
  TreasuryStatCards,
  formatFinanceCurrency,
  getRunwayHealthInfo,
} from './treasury-stat-cards';
import { CashflowTrendChart } from './cashflow-trend-chart';
import {
  AccountBalanceGrid,
  getAccountTypeMetadata,
  formatAccountNumber,
} from './account-balance-grid';

const mockAccounts: FinanceAccountDto[] = [
  {
    id: 'acc-1',
    tenantId: 'tenant-1',
    name: 'Silicon Valley Operating',
    accountType: 'BANK',
    currency: 'USD',
    balance: 245000,
    accountNumber: 'US89370400440532013000',
    isDefault: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'acc-2',
    tenantId: 'tenant-1',
    name: 'Corporate Vault Savings',
    accountType: 'BANK',
    currency: 'USD',
    balance: 450000,
    accountNumber: 'US44053201300089370400',
    isDefault: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'acc-3',
    tenantId: 'tenant-1',
    name: 'Executive Petty Cash',
    accountType: 'CASH',
    currency: 'USD',
    balance: 8500,
    accountNumber: null,
    isDefault: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'acc-4',
    tenantId: 'tenant-1',
    name: 'Stripe Merchant Clearing',
    accountType: 'CLEARING',
    currency: 'USD',
    balance: 89400,
    accountNumber: 'STRIPE-ACC-0912',
    isDefault: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

const mockTreasuryOverview: TreasuryOverviewDto = {
  totalCash: 792900,
  currency: 'USD',
  monthlyInflow: 185000,
  monthlyOutflow: 94000,
  netCashflow: 91000,
  monthlyBurnRate: 65000,
  runwayMonths: 12.2,
  accounts: mockAccounts,
  recentCashflowSeries: [
    { date: 'Aug 01', inflow: 25000, outflow: 12000, net: 13000 },
    { date: 'Aug 08', inflow: 38000, outflow: 19000, net: 19000 },
    { date: 'Aug 15', inflow: 52000, outflow: 27000, net: 25000 },
    { date: 'Aug 22', inflow: 70000, outflow: 36000, net: 34000 },
  ],
};

describe('TreasuryStatCards Component', () => {
  it('renders all metrics correctly from TreasuryOverviewDto', () => {
    render(<TreasuryStatCards overview={mockTreasuryOverview} />);

    expect(screen.getByTestId('treasury-stat-cards')).toBeInTheDocument();
    expect(screen.getByText('Total Available Cash')).toBeInTheDocument();
    expect(screen.getByTestId('total-cash-value')).toHaveTextContent('$792,900.00');

    expect(screen.getByText('Monthly Cash Flow')).toBeInTheDocument();
    expect(screen.getByTestId('monthly-inflow-value')).toHaveTextContent('+$185,000.00');
    expect(screen.getByTestId('monthly-outflow-value')).toHaveTextContent('-$94,000.00');

    expect(screen.getByText('Monthly Burn Rate')).toBeInTheDocument();
    expect(screen.getByTestId('monthly-burn-rate-value')).toHaveTextContent('$65,000.00');

    expect(screen.getByText('Estimated Runway')).toBeInTheDocument();
    expect(screen.getByTestId('runway-months-value')).toHaveTextContent('12.2 mo');
    expect(screen.getByTestId('runway-health-badge')).toHaveTextContent('> 6 mo • Healthy');
  });

  it('renders healthy badge for runway > 6 months', () => {
    render(
      <TreasuryStatCards
        totalCash={600000}
        monthlyBurnRate={50000}
        runwayMonths={12}
        currency="USD"
      />,
    );
    const badge = screen.getByTestId('runway-health-badge');
    expect(badge).toHaveTextContent('> 6 mo • Healthy');
    expect(badge.className).toContain('text-emerald-600');
  });

  it('renders caution badge for runway between 3 and 6 months', () => {
    render(
      <TreasuryStatCards
        totalCash={200000}
        monthlyBurnRate={50000}
        runwayMonths={4}
        currency="USD"
      />,
    );
    const badge = screen.getByTestId('runway-health-badge');
    expect(badge).toHaveTextContent('3–6 mo • Caution');
    expect(badge.className).toContain('text-amber-600');
  });

  it('renders critical badge for runway < 3 months', () => {
    render(
      <TreasuryStatCards
        totalCash={80000}
        monthlyBurnRate={50000}
        runwayMonths={1.6}
        currency="USD"
      />,
    );
    const badge = screen.getByTestId('runway-health-badge');
    expect(badge).toHaveTextContent('< 3 mo • Critical');
    expect(badge.className).toContain('text-rose-600');
  });

  it('renders self-sustaining badge when burn rate is 0 or negative', () => {
    render(
      <TreasuryStatCards
        totalCash={500000}
        monthlyBurnRate={0}
        runwayMonths={Infinity}
        currency="USD"
      />,
    );
    const badge = screen.getByTestId('runway-health-badge');
    expect(badge).toHaveTextContent('Self-Sustaining');
    expect(screen.getByTestId('runway-months-value')).toHaveTextContent('∞');
  });

  it('formats other currencies properly (e.g. EUR, GBP)', () => {
    render(
      <TreasuryStatCards
        totalCash={150000}
        monthlyInflow={30000}
        monthlyOutflow={10000}
        monthlyBurnRate={10000}
        runwayMonths={15}
        currency="EUR"
      />,
    );
    expect(screen.getByTestId('total-cash-value')).toHaveTextContent('€150,000.00');
  });

  it('renders loading skeleton state', () => {
    render(<TreasuryStatCards isLoading={true} />);
    expect(screen.getByTestId('treasury-stat-cards-loading')).toBeInTheDocument();
  });

  it('verifies helper functions getRunwayHealthInfo and formatFinanceCurrency', () => {
    expect(getRunwayHealthInfo(8, 20000).status).toBe('healthy');
    expect(getRunwayHealthInfo(4.5, 20000).status).toBe('warning');
    expect(getRunwayHealthInfo(2.1, 20000).status).toBe('critical');
    expect(getRunwayHealthInfo(Infinity, 0).status).toBe('infinite');
    expect(getRunwayHealthInfo(5, 0).status).toBe('infinite');

    expect(formatFinanceCurrency(1000, 'USD', { decimals: false })).toBe('$1,000');
    expect(formatFinanceCurrency(null)).toBe('$0.00');
  });
});

describe('CashflowTrendChart Component', () => {
  it('renders chart title, summary indicators, and SVG canvas', () => {
    render(
      <CashflowTrendChart
        series={mockTreasuryOverview.recentCashflowSeries}
        currency="USD"
        title="Custom Cashflow Runway"
      />,
    );

    expect(screen.getByTestId('cashflow-trend-chart')).toBeInTheDocument();
    expect(screen.getByText('Custom Cashflow Runway')).toBeInTheDocument();
    expect(screen.getByTestId('cashflow-svg')).toBeInTheDocument();
    expect(screen.getByText('Inflow')).toBeInTheDocument();
    expect(screen.getByText('Outflow')).toBeInTheDocument();
    expect(screen.getByText('Net Cashflow')).toBeInTheDocument();
  });

  it('interactively shows tooltip on hover over hit area', () => {
    render(
      <CashflowTrendChart
        series={mockTreasuryOverview.recentCashflowSeries}
        currency="USD"
      />,
    );

    // Initial state: no tooltip
    expect(screen.queryByTestId('cashflow-tooltip')).not.toBeInTheDocument();

    // Hover over the first item
    const firstHitArea = screen.getByTestId('chart-hit-area-0');
    fireEvent.mouseEnter(firstHitArea);

    // Tooltip should be visible
    expect(screen.getByTestId('cashflow-tooltip')).toBeInTheDocument();
    expect(screen.getByText('+$25,000.00')).toBeInTheDocument();
    expect(screen.getByText('-$12,000.00')).toBeInTheDocument();
    expect(screen.getByText('+$13,000.00')).toBeInTheDocument();

    // Mouse leave removes tooltip
    fireEvent.mouseLeave(firstHitArea);
    expect(screen.queryByTestId('cashflow-tooltip')).not.toBeInTheDocument();
  });

  it('switches time periods and calls onPeriodChange', () => {
    const handlePeriodChange = vi.fn();
    render(
      <CashflowTrendChart
        onPeriodChange={handlePeriodChange}
        defaultPeriod="30D"
      />,
    );

    const btn7d = screen.getByTestId('period-btn-7D');
    fireEvent.click(btn7d);

    expect(handlePeriodChange).toHaveBeenCalledWith('7D');
    expect(screen.getByText('Active Window: 7D')).toBeInTheDocument();
  });

  it('renders empty state when series is empty', () => {
    render(<CashflowTrendChart series={[]} />);
    expect(screen.getByTestId('chart-empty-state')).toBeInTheDocument();
  });

  it('renders loading state when isLoading is true', () => {
    render(<CashflowTrendChart isLoading={true} />);
    expect(screen.getByTestId('cashflow-chart-loading')).toBeInTheDocument();
  });
});

describe('AccountBalanceGrid Component', () => {
  it('renders list of accounts with formatted balances, icons, and type tags', () => {
    render(<AccountBalanceGrid accounts={mockAccounts} />);

    expect(screen.getByTestId('account-balance-grid')).toBeInTheDocument();
    expect(screen.getByTestId('account-card-acc-1')).toBeInTheDocument();
    expect(screen.getByTestId('account-card-acc-2')).toBeInTheDocument();
    expect(screen.getByTestId('account-card-acc-3')).toBeInTheDocument();
    expect(screen.getByTestId('account-card-acc-4')).toBeInTheDocument();

    // Names and balances
    expect(screen.getByTestId('account-name-acc-1')).toHaveTextContent('Silicon Valley Operating');
    expect(screen.getByTestId('account-balance-acc-1')).toHaveTextContent('$245,000.00');

    // Default badge
    expect(screen.getByTestId('default-badge-acc-1')).toHaveTextContent('Default');
    expect(screen.queryByTestId('default-badge-acc-2')).not.toBeInTheDocument();

    // Account number masking
    expect(screen.getByText('•••• 3000')).toBeInTheDocument();
  });

  it('triggers onTransfer and onNewAccount callbacks when clicked', () => {
    const handleTransfer = vi.fn();
    const handleNewAccount = vi.fn();

    render(
      <AccountBalanceGrid
        accounts={mockAccounts}
        onTransfer={handleTransfer}
        onNewAccount={handleNewAccount}
      />,
    );

    const transferBtn = screen.getByTestId('transfer-funds-btn');
    fireEvent.click(transferBtn);
    expect(handleTransfer).toHaveBeenCalledTimes(1);

    const newAccBtn = screen.getByTestId('new-account-btn');
    fireEvent.click(newAccBtn);
    expect(handleNewAccount).toHaveBeenCalledTimes(1);
  });

  it('triggers onTransfer with specific accountId when card transfer button is clicked', () => {
    const handleTransfer = vi.fn();
    render(<AccountBalanceGrid accounts={mockAccounts} onTransfer={handleTransfer} />);

    const cardTransferBtn = screen.getByTestId('account-transfer-btn-acc-2');
    fireEvent.click(cardTransferBtn);
    expect(handleTransfer).toHaveBeenCalledWith('acc-2');
  });

  it('triggers onSelectAccount when card is clicked', () => {
    const handleSelect = vi.fn();
    render(<AccountBalanceGrid accounts={mockAccounts} onSelectAccount={handleSelect} />);

    const card = screen.getByTestId('account-card-acc-3');
    fireEvent.click(card);
    expect(handleSelect).toHaveBeenCalledWith(mockAccounts[2]);
  });

  it('renders empty state when no accounts exist', () => {
    const handleNewAccount = vi.fn();
    render(<AccountBalanceGrid accounts={[]} onNewAccount={handleNewAccount} />);

    expect(screen.getByTestId('account-grid-empty')).toBeInTheDocument();
    expect(screen.getByText('No bank accounts registered')).toBeInTheDocument();

    const createFirstBtn = screen.getByRole('button', { name: /create first account/i });
    fireEvent.click(createFirstBtn);
    expect(handleNewAccount).toHaveBeenCalledTimes(1);
  });

  it('renders loading skeleton state', () => {
    render(<AccountBalanceGrid isLoading={true} />);
    expect(screen.getByTestId('account-grid-loading')).toBeInTheDocument();
  });

  it('verifies helper functions getAccountTypeMetadata and formatAccountNumber', () => {
    expect(getAccountTypeMetadata('BANK').badgeTone).toBe('info');
    expect(getAccountTypeMetadata('CASH').badgeTone).toBe('success');
    expect(getAccountTypeMetadata('CREDIT_CARD').badgeTone).toBe('warning');
    expect(getAccountTypeMetadata('CLEARING').badgeTone).toBe('brand');

    expect(formatAccountNumber('1234567890')).toBe('•••• 7890');
    expect(formatAccountNumber('123')).toBe('•••• 123');
    expect(formatAccountNumber(null)).toBe('•••• ----');
  });
});
