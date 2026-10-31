import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import type { AgingReportDto, FinanceAccountDto, ReceivablesAgingDto } from '@saas/shared';
import { formatFinanceCurrency, splitByBase, totalsByCurrency } from '../money';
import {
  CashHeadline,
  PayablesHeadline,
  ReceivablesHeadline,
  VatHeadline,
  summariseCash,
  summarisePayables,
  summariseReceivables,
} from './finance-headlines';
import { CashByAccount } from './cash-by-account';
import { CashForecastTable } from './cash-forecast-table';
import { AccountBalanceGrid, getAccountTypeMetadata, formatAccountNumber } from './account-balance-grid';
import { useFinancialReport } from '@/hooks/use-platform';
import { useBillAging } from '@/hooks/use-bills';
import { useVatReturn } from '@/hooks/use-books';
import { useTaxReport, useUaeVatStatus } from '@/hooks/use-credits';

vi.mock('@/hooks/use-platform', () => ({ useFinancialReport: vi.fn() }));
vi.mock('@/hooks/use-bills', () => ({ useBillAging: vi.fn() }));
vi.mock('@/hooks/use-books', () => ({ useVatReturn: vi.fn() }));
vi.mock('@/hooks/use-credits', () => ({ useTaxReport: vi.fn(), useUaeVatStatus: vi.fn() }));

const account = (over: Partial<FinanceAccountDto>): FinanceAccountDto => ({
  id: 'acc',
  tenantId: 'tenant-1',
  name: 'Account',
  accountType: 'BANK',
  currency: 'AED',
  balance: 0,
  accountNumber: null,
  isDefault: false,
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-01T00:00:00Z',
  ...over,
});

/** A shop's accounts: three in AED and one in dollars for imported board. */
const mockAccounts: FinanceAccountDto[] = [
  account({ id: 'acc-1', name: 'Emirates NBD current', balance: 245000, accountNumber: 'AE070331234567890123000', isDefault: true }),
  account({ id: 'acc-2', name: 'Mashreq savings', balance: 45000, accountNumber: 'AE440532013000893704' }),
  account({ id: 'acc-3', name: 'Petty cash', accountType: 'CASH', balance: 850.5 }),
  account({ id: 'acc-4', name: 'USD supplier account', currency: 'USD', balance: 5000, accountNumber: 'US-0912' }),
];

const nbsp = (s: string) => s.replace(/\s/g, ' ');

describe('money helpers', () => {
  it('formats in the currency given and never falls back to dollars', () => {
    expect(nbsp(formatFinanceCurrency(1000, 'AED'))).toBe('AED 1,000.00');
    expect(formatFinanceCurrency(1000, 'USD', { decimals: false })).toBe('$1,000');
    // Before the organisation has loaded there is no currency: the figure alone.
    expect(formatFinanceCurrency(null, '')).toBe('0.00');
    expect(formatFinanceCurrency(12.5, '')).not.toContain('$');
  });

  it('adds amounts only within a currency', () => {
    const totals = totalsByCurrency(mockAccounts, (a) => a.balance, (a) => a.currency);
    expect(totals).toEqual([
      { currency: 'AED', amount: 290850.5 },
      { currency: 'USD', amount: 5000 },
    ]);
    expect(splitByBase(totals, 'AED')).toEqual({ base: 290850.5, others: [{ currency: 'USD', amount: 5000 }] });
    expect(summariseCash(mockAccounts, 'AED').baseAccounts).toBe(3);
  });
});

describe('CashHeadline', () => {
  it('totals the AED accounts and lists the dollar balance apart, not added in', () => {
    render(<CashHeadline accounts={mockAccounts} base="AED" />);
    expect(nbsp(screen.getByTestId('headline-cash-figure').textContent!)).toBe('AED 290,850.50');
    expect(screen.getByText('In 3 AED accounts.')).toBeInTheDocument();
    expect(screen.getByTestId('cash-other-currencies')).toHaveTextContent('Not in this total: $5,000.00');
    expect(screen.getByRole('link', { name: 'See accounts' })).toHaveAttribute('href', '/finance/accounts');
  });

  it('waits for the base currency rather than guessing one', () => {
    render(<CashHeadline accounts={mockAccounts} base={undefined} />);
    expect(screen.queryByTestId('headline-cash-figure')).not.toBeInTheDocument();
  });
});

const receivables: ReceivablesAgingDto = {
  asOf: '2026-10-30',
  baseCurrency: 'AED',
  rows: [
    { invoiceId: 'i1', invoiceNumber: 'INV-1', customerName: 'Al Noor Sweets', currency: 'AED', outstanding: 10500, outstandingBase: 10500, dueDate: '2026-11-15', daysOverdue: 0, bucket: 'CURRENT' },
    { invoiceId: 'i2', invoiceNumber: 'INV-2', customerName: 'Gulf Pack', currency: 'AED', outstanding: 4200, outstandingBase: 4200, dueDate: '2026-10-10', daysOverdue: 20, bucket: 'DAYS_1_30' },
    { invoiceId: 'i3', invoiceNumber: 'INV-3', customerName: 'Gulf Pack', currency: 'USD', outstanding: 1000, outstandingBase: 3672.5, dueDate: '2026-08-01', daysOverdue: 90, bucket: 'DAYS_61_90' },
  ],
  buckets: { CURRENT: 10500, DAYS_1_30: 4200, DAYS_31_60: 0, DAYS_61_90: 3672.5, DAYS_OVER_90: 0 },
  total: 18372.5,
  ledgerBalance: 18372.5,
  difference: 0,
};

const payables: AgingReportDto = {
  asOf: '2026-10-30',
  buckets: { CURRENT: 9000, DAYS_1_30: 2500, DAYS_31_60: 0, DAYS_61_90: 0, DAYS_OVER_90: 0 },
  total: 11500,
  ledgerBalance: 11500,
  difference: 0,
  bills: [
    { id: 'b1', billNumber: 'BILL-1', supplierName: 'Board Mills', dueDate: '2026-11-02T00:00:00Z', outstanding: 6000, currency: 'AED', outstandingBase: 6000, bucket: 'CURRENT' },
    { id: 'b2', billNumber: 'BILL-2', supplierName: 'Ink Co', dueDate: '2026-12-15T00:00:00Z', outstanding: 3000, currency: 'AED', outstandingBase: 3000, bucket: 'CURRENT' },
    { id: 'b3', billNumber: 'BILL-3', supplierName: 'Glue LLC', dueDate: '2026-10-20T00:00:00Z', outstanding: 2500, currency: 'AED', outstandingBase: 2500, bucket: 'DAYS_1_30' },
  ],
};

describe('receivables and payables figures', () => {
  it('reads what customers owe and what is overdue straight off the aging report', () => {
    expect(summariseReceivables(receivables)).toEqual({ total: 18372.5, overdue: 7872.5, overdueCount: 2, invoiceCount: 3 });
  });

  it('splits supplier bills into overdue and due in the next week', () => {
    expect(summarisePayables(payables, new Date('2026-10-30T09:00:00Z'))).toEqual({
      total: 11500,
      overdue: 2500,
      overdueCount: 1,
      dueThisWeek: 6000,
      dueThisWeekCount: 1,
    });
  });
});

describe('headline tiles that load their own report', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows receivables in base currency with the overdue amount and count, linking to the aging report', () => {
    vi.mocked(useFinancialReport).mockReturnValue({ data: receivables, isLoading: false, isError: false } as never);
    render(<ReceivablesHeadline />);
    expect(useFinancialReport).toHaveBeenCalledWith('receivables-aging', expect.objectContaining({ asOf: expect.any(String) }));
    expect(nbsp(screen.getByTestId('headline-receivables-figure').textContent!)).toBe('AED 18,372.50');
    expect(nbsp(screen.getByTestId('receivables-overdue').textContent!)).toBe('AED 7,872.50 overdue on 2 invoices');
    expect(screen.getByRole('link', { name: 'See receivables aging' })).toHaveAttribute(
      'href',
      '/finance/reports?report=receivables-aging',
    );
  });

  it('shows supplier bills owed, overdue, and links to the bills page', () => {
    vi.mocked(useBillAging).mockReturnValue({ data: payables, isLoading: false, isError: false } as never);
    render(<PayablesHeadline base="AED" />);
    expect(nbsp(screen.getByTestId('headline-payables-figure').textContent!)).toBe('AED 11,500.00');
    expect(nbsp(screen.getByTestId('payables-overdue').textContent!)).toBe('AED 2,500.00 overdue on 1 bill');
    expect(screen.getByRole('link', { name: 'See supplier bills' })).toHaveAttribute('href', '/purchasing/bills');
  });

  it('in UAE mode shows box 14 of the current VAT period and opens the Tax page on that period', () => {
    vi.mocked(useUaeVatStatus).mockReturnValue({
      isLoading: false,
      data: { enabled: true, problems: [], suggestedVatStartDate: null, settings: { periodFrequency: 'QUARTERLY', firstPeriodStart: '2026-02-01' } },
    } as never);
    vi.mocked(useVatReturn).mockReturnValue({ data: { payableTax: 4321.25, warnings: [] }, isLoading: false, isError: false } as never);
    vi.mocked(useTaxReport).mockReturnValue({ data: undefined, isLoading: false, isError: false } as never);
    render(<VatHeadline base="AED" />);
    const [from, to] = vi.mocked(useVatReturn).mock.calls[0];
    // Quarters counted from February: the one holding today starts on the 1st of Feb, May, Aug or Nov.
    expect(from).toMatch(/^\d{4}-(02|05|08|11)-01$/);
    expect(to > from).toBe(true);
    expect(screen.getByText('VAT due')).toBeInTheDocument();
    expect(nbsp(screen.getByTestId('headline-vat-figure').textContent!)).toBe('AED 4,321.25');
    expect(screen.getByRole('link', { name: 'See the VAT return' })).toHaveAttribute('href', `/finance/tax?from=${from}&to=${to}`);
    expect(useTaxReport).not.toHaveBeenCalled();
  });

  it('calls a negative return a refund', () => {
    vi.mocked(useUaeVatStatus).mockReturnValue({ isLoading: false, data: { enabled: true, settings: null } } as never);
    vi.mocked(useVatReturn).mockReturnValue({ data: { payableTax: -800, warnings: ['Check box 1'] }, isLoading: false, isError: false } as never);
    render(<VatHeadline base="AED" />);
    expect(screen.getByText('VAT refund due')).toBeInTheDocument();
    expect(nbsp(screen.getByTestId('headline-vat-figure').textContent!)).toBe('AED 800.00');
    expect(screen.getByText('1 thing to check before filing')).toBeInTheDocument();
  });
});

describe('CashByAccount', () => {
  it('lists each balance in its own currency and totals only the base-currency accounts', () => {
    render(<CashByAccount accounts={mockAccounts} base="AED" />);
    expect(nbsp(within(screen.getByTestId('cash-row-acc-3')).getByText(/850/).textContent!)).toBe('AED 850.50');
    expect(within(screen.getByTestId('cash-row-acc-4')).getByText('$5,000.00')).toBeInTheDocument();
    expect(nbsp(screen.getByTestId('cash-total').textContent!)).toBe('AED 290,850.50');
    expect(screen.getByText('Total in AED')).toBeInTheDocument();
    expect(screen.getByText(/Not in this total/)).toHaveTextContent('$5,000.00');
  });
});

describe('CashForecastTable', () => {
  const forecast = {
    baseCurrency: 'AED',
    months: [
      { month: '2026-11', opening: 1000, inflows: 500, billsOut: 200, recurringOut: 100, payrollOut: 3000, pensionOut: 250, closing: 1200 },
      { month: '2026-12', opening: 1200, inflows: 0, billsOut: 0, recurringOut: 5000, payrollOut: 0, pensionOut: 0, closing: -3800 },
    ],
  };

  it('shows each month with payroll and pension, and marks a month that ends short', () => {
    render(<CashForecastTable forecast={forecast} />);
    expect(screen.getByRole('columnheader', { name: 'Payroll' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Pension' })).toBeInTheDocument();
    const nov = screen.getByTestId('forecast-2026-11');
    expect(nbsp(nov.textContent!)).toContain('AED 3,000.00');
    expect(within(nov).queryByText('Short')).not.toBeInTheDocument();
    const dec = screen.getByTestId('forecast-2026-12');
    expect(within(dec).getByText('Short')).toBeInTheDocument();
    expect(nbsp(dec.textContent!)).toContain('-AED 3,800.00');
  });

  it('counts a pension-only month as a movement, and says so when nothing is expected', () => {
    const { unmount } = render(
      <CashForecastTable forecast={{ baseCurrency: 'AED', months: [{ ...forecast.months[0], inflows: 0, billsOut: 0, recurringOut: 0, payrollOut: 0, closing: 0 }] }} />,
    );
    expect(screen.queryByTestId('cash-forecast-empty')).not.toBeInTheDocument();
    unmount();
    render(<CashForecastTable forecast={{ baseCurrency: 'AED', months: [] }} />);
    expect(screen.getByTestId('cash-forecast-empty')).toBeInTheDocument();
  });
});

describe('AccountBalanceGrid Component', () => {
  it('renders each account with its balance in its own currency', () => {
    render(<AccountBalanceGrid accounts={mockAccounts} />);

    expect(screen.getByTestId('account-balance-grid')).toBeInTheDocument();
    for (const id of ['acc-1', 'acc-2', 'acc-3', 'acc-4']) {
      expect(screen.getByTestId(`account-card-${id}`)).toBeInTheDocument();
    }
    expect(screen.getByTestId('account-name-acc-1')).toHaveTextContent('Emirates NBD current');
    expect(nbsp(screen.getByTestId('account-balance-acc-1').textContent!)).toBe('AED 245,000.00');
    expect(screen.getByTestId('account-balance-acc-4')).toHaveTextContent('$5,000.00');

    expect(screen.getByTestId('default-badge-acc-1')).toHaveTextContent('Default');
    expect(screen.queryByTestId('default-badge-acc-2')).not.toBeInTheDocument();

    expect(screen.getByText('•••• 3000')).toBeInTheDocument();
  });

  it('triggers onTransfer and onNewAccount callbacks when clicked', () => {
    const handleTransfer = vi.fn();
    const handleNewAccount = vi.fn();
    render(<AccountBalanceGrid accounts={mockAccounts} onTransfer={handleTransfer} onNewAccount={handleNewAccount} />);

    fireEvent.click(screen.getByTestId('transfer-funds-btn'));
    expect(handleTransfer).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId('new-account-btn'));
    expect(handleNewAccount).toHaveBeenCalledTimes(1);
  });

  it('triggers onTransfer with specific accountId when card transfer button is clicked', () => {
    const handleTransfer = vi.fn();
    render(<AccountBalanceGrid accounts={mockAccounts} onTransfer={handleTransfer} />);
    fireEvent.click(screen.getByTestId('account-transfer-btn-acc-2'));
    expect(handleTransfer).toHaveBeenCalledWith('acc-2');
  });

  it('triggers onSelectAccount when card is clicked', () => {
    const handleSelect = vi.fn();
    render(<AccountBalanceGrid accounts={mockAccounts} onSelectAccount={handleSelect} />);
    fireEvent.click(screen.getByTestId('account-card-acc-3'));
    expect(handleSelect).toHaveBeenCalledWith(mockAccounts[2]);
  });

  it('renders empty state when no accounts exist', () => {
    const handleNewAccount = vi.fn();
    render(<AccountBalanceGrid accounts={[]} onNewAccount={handleNewAccount} />);
    expect(screen.getByTestId('account-grid-empty')).toBeInTheDocument();
    expect(screen.getByText('No bank accounts registered')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /create first account/i }));
    expect(handleNewAccount).toHaveBeenCalledTimes(1);
  });

  it('renders loading skeleton state', () => {
    render(<AccountBalanceGrid isLoading={true} />);
    expect(screen.getByTestId('account-grid-loading')).toBeInTheDocument();
  });

  it('labels account types in neutral tags, since a type is not a status', () => {
    expect(getAccountTypeMetadata('BANK')).toMatchObject({ label: 'Bank Account', badgeTone: 'neutral' });
    expect(getAccountTypeMetadata('CASH')).toMatchObject({ label: 'Petty Cash', badgeTone: 'neutral' });
    expect(getAccountTypeMetadata('CREDIT_CARD').badgeTone).toBe('neutral');
    expect(getAccountTypeMetadata('CLEARING').badgeTone).toBe('neutral');

    expect(formatAccountNumber('1234567890')).toBe('•••• 7890');
    expect(formatAccountNumber('123')).toBe('•••• 123');
    expect(formatAccountNumber(null)).toBe('•••• ----');
  });
});
