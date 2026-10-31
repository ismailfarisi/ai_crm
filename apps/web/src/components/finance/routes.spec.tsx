import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type {
  FinanceAccountDto,
  TreasuryOverviewDto,
  CategoryBudgetDto,
  RecurringExpenseDto,
  ExpenseClaimDto,
} from '@saas/shared';
import { FinanceNav, FINANCE_NAV_ITEMS } from './finance-nav';
import { FinanceOverviewView } from './finance-overview-view';
import { ExpensesView } from './expenses/expenses-view';
import { ExpenseDetailView } from './expenses/expense-detail-view';
import { BudgetsView } from './budgets/budgets-view';
import { AccountsView } from './accounts/accounts-view';
import { SubscriptionsView } from './subscriptions/subscriptions-view';

// Polyfill HTMLDialogElement for jsdom
beforeEach(() => {
  if (typeof HTMLDialogElement !== 'undefined') {
    HTMLDialogElement.prototype.showModal =
      HTMLDialogElement.prototype.showModal ||
      function (this: HTMLDialogElement) {
        this.open = true;
      };
    HTMLDialogElement.prototype.close =
      HTMLDialogElement.prototype.close ||
      function (this: HTMLDialogElement) {
        this.open = false;
      };
  }
});

// Mock Next.js navigation
const mockPush = vi.fn();
let mockPathname = '/finance';

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
    replace: vi.fn(),
    prefetch: vi.fn(),
    back: vi.fn(),
  }),
  usePathname: () => mockPathname,
}));

// Mock Test Data
const mockAccounts: FinanceAccountDto[] = [
  {
    id: 'acc-1',
    tenantId: 'tenant-1',
    name: 'SVB Operating',
    accountType: 'BANK',
    currency: 'USD',
    balance: 450000,
    accountNumber: '111122221234',
    isDefault: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'acc-2',
    tenantId: 'tenant-1',
    name: 'Petty Cash',
    accountType: 'CASH',
    currency: 'USD',
    balance: 15000,
    accountNumber: null,
    isDefault: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

const mockOverview: TreasuryOverviewDto = {
  currency: 'USD',
  totalCash: 785000,
  monthlyInflow: 184500,
  monthlyOutflow: 112000,
  monthlyBurnRate: 0,
  netCashflow: 72500,
  runwayMonths: -1,
  accounts: mockAccounts,
  recentCashflowSeries: [
    { date: '2026-08-01', inflow: 50000, outflow: 30000, net: 20000 },
    { date: '2026-08-15', inflow: 65000, outflow: 42000, net: 23000 },
  ],
};

const mockBudgets: CategoryBudgetDto[] = [
  {
    id: 'b-1',
    tenantId: 'tenant-1',
    category: 'Software & SaaS',
    period: 'MONTHLY',
    budgetAmount: 25000,
    spentAmount: 18400,
    startDate: '2026-08-01',
    endDate: '2026-08-31',
    alertThresholdPercent: 80,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'b-2',
    tenantId: 'tenant-1',
    category: 'Marketing',
    period: 'MONTHLY',
    budgetAmount: 50000,
    spentAmount: 48500,
    startDate: '2026-08-01',
    endDate: '2026-08-31',
    alertThresholdPercent: 85,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

const mockSubscriptions: RecurringExpenseDto[] = [
  {
    id: 'sub-1',
    tenantId: 'tenant-1',
    supplierId: 'sup-1',
    supplierName: 'Supplier',
    currency: null,
    startDate: '2026-01-01',
    endDate: null,
    taxCodeId: null,
    autoApprove: false,
    spreadOverPeriod: false,
    lastOccurrenceStatus: null,
    vendorName: 'AWS Cloud Services',
    category: 'Cloud Infrastructure',
    amount: 12500,
    billingInterval: 'MONTHLY',
    nextBillingDate: '2026-09-01',
    status: 'ACTIVE',
    financeAccountId: 'acc-1',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'sub-2',
    tenantId: 'tenant-1',
    supplierId: 'sup-1',
    supplierName: 'Supplier',
    currency: null,
    startDate: '2026-01-01',
    endDate: null,
    taxCodeId: null,
    autoApprove: false,
    spreadOverPeriod: false,
    lastOccurrenceStatus: null,
    vendorName: 'GitHub Enterprise',
    category: 'Software & SaaS',
    amount: 2400,
    billingInterval: 'ANNUAL',
    nextBillingDate: '2027-01-15',
    status: 'ACTIVE',
    financeAccountId: 'acc-1',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

const mockClaims: ExpenseClaimDto[] = [
  {
    id: 'exp-1',
    tenantId: 'tenant-1',
    claimNumber: 'EXP-1001',
    employeeId: 'usr-1',
    employeeName: 'Sarah Connor',
    merchantName: 'Delta Air Lines',
    category: 'Travel & Lodging',
    expenseDate: '2026-08-10',
    amount: 1450.0,
    currency: 'USD',
    status: 'SUBMITTED',
    receiptUrl: 'https://example.com/receipt1.jpg',
    items: [
      { description: 'Roundtrip Flight SFO -> JFK', quantity: 1, unitPrice: 1450.0, amount: 1450.0 },
    ],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'exp-2',
    tenantId: 'tenant-1',
    claimNumber: 'EXP-1002',
    employeeId: 'usr-2',
    employeeName: 'John Doe',
    merchantName: 'Figma Inc',
    category: 'Software & SaaS',
    expenseDate: '2026-08-12',
    amount: 180.0,
    currency: 'USD',
    status: 'APPROVED',
    approvedById: 'usr-lead',
    approvedAt: '2026-08-14T10:00:00Z',
    receiptUrl: null,
    items: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

// Mock hooks
const mockCreateClaim = vi.fn();
const mockSignalClaim = vi.fn();
const mockCreateAccount = vi.fn();
const mockTransferFunds = vi.fn();
const mockCreateBudget = vi.fn();
const mockCreateSub = vi.fn();

// The expense detail page now carries the files and history panels, which ask
// the session what the viewer may change.
vi.mock('@/lib/session-context', () => ({
  useSession: () => ({ check: () => true }),
  useCan: () => true,
}));

vi.mock('@/components/platform/attachments-panel', () => ({
  AttachmentsPanel: () => null,
}));

vi.mock('@/components/platform/activity-timeline', () => ({
  ActivityTimeline: () => null,
}));

/** Moving the default flag onto an account. */
const mockUpdateAccount = vi.fn();

vi.mock('@/hooks/use-finance', () => ({
  useCashForecast: () => ({ data: { baseCurrency: 'USD', months: [] }, isLoading: false }),
  useFinanceOverview: () => ({ data: mockOverview, isLoading: false }),
  useFinanceAccounts: () => ({ data: mockAccounts, isLoading: false }),
  useCategoryBudgets: () => ({ data: mockBudgets, isLoading: false }),
  useRecurringExpenses: () => ({ data: mockSubscriptions, isLoading: false }),
  useCreateFinanceAccount: () => ({ mutateAsync: mockCreateAccount, isPending: false }),
  useUpdateFinanceAccount: () => ({ mutate: mockUpdateAccount, isPending: false }),
  useTransferFunds: () => ({ mutateAsync: mockTransferFunds, isPending: false }),
  useCreateCategoryBudget: () => ({ mutateAsync: mockCreateBudget, isPending: false }),
  useCreateRecurringExpense: () => ({ mutateAsync: mockCreateSub, isPending: false }),
  useUpdateRecurringExpense: () => ({ mutateAsync: vi.fn(), isPending: false }),
  usePauseRecurringExpense: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useResumeRecurringExpense: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useCancelRecurringExpense: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRecurringOccurrences: () => ({ data: [], isLoading: false, isError: false }),
}));

// The overview's own reports: what customers owe, supplier bills and VAT.
vi.mock('@/hooks/use-organization', () => ({ useOrganization: () => ({ data: { baseCurrency: 'AED', country: 'AE' } }) }));
vi.mock('@/hooks/use-platform', () => ({
  useFinancialReport: () => ({
    data: { asOf: '2026-10-30', baseCurrency: 'AED', rows: [], buckets: { CURRENT: 0 }, total: 0, ledgerBalance: 0, difference: 0 },
    isLoading: false,
    isError: false,
  }),
}));
vi.mock('@/hooks/use-bills', () => ({
  useBillAging: () => ({
    data: { asOf: '2026-10-30', buckets: { CURRENT: 0 }, total: 0, ledgerBalance: 0, difference: 0, bills: [] },
    isLoading: false,
    isError: false,
  }),
}));
vi.mock('@/hooks/use-books', () => ({ useVatReturn: () => ({ data: { payableTax: 1250, warnings: [] }, isLoading: false, isError: false }) }));
vi.mock('@/hooks/use-credits', () => ({
  useUaeVatStatus: () => ({ data: { enabled: true, settings: null }, isLoading: false }),
  useTaxReport: () => ({ data: undefined, isLoading: false, isError: false }),
}));

vi.mock('@/hooks/use-suppliers', () => ({
  useSuppliers: () => ({ data: { items: [], meta: { total: 0, page: 1, limit: 100, totalPages: 0 } } }),
}));

vi.mock('@/hooks/use-expenses', () => ({
  useReceiptSource: (url?: string | null) => ({ src: url ?? null, isPdf: /\.pdf$/i.test(url ?? ''), isLoading: false }),
  useExpenses: () => ({
    claims: mockClaims,
    isLoading: false,
    createClaim: mockCreateClaim,
    signalClaim: mockSignalClaim,
    isCreating: false,
  }),
  useExpense: (id: string) => {
    const claim = mockClaims.find((c) => c.id === id) || null;
    return {
      claim,
      isLoading: false,
      isError: !claim,
      signalClaim: mockSignalClaim,
      isSignaling: false,
    };
  },
  useScanReceipt: () => ({
    mutateAsync: vi.fn().mockResolvedValue({
      merchantName: 'Delta Air Lines',
      amount: 1450.0,
      currency: 'USD',
      expenseDate: '2026-08-10',
      category: 'Travel & Lodging',
      confidence: 0.94,
    }),
    isPending: false,
  }),
}));

function renderWithClient(ui: React.ReactElement) {
  const testQueryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={testQueryClient}>{ui}</QueryClientProvider>,
  );
}

describe('Finance Routes & Views Suite', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPathname = '/finance';
  });

  describe('FinanceNav', () => {
    it('renders all finance navigation tabs', () => {
      renderWithClient(<FinanceNav />);
      expect(screen.getByTestId('finance-nav')).toBeDefined();
      FINANCE_NAV_ITEMS.forEach((item) => {
        expect(screen.getByText(item.label)).toBeDefined();
      });
    });

    it('groups the tabs into money, books and reports, without a hidden scroll strip', () => {
      renderWithClient(<FinanceNav />);
      expect(screen.getByRole('group', { name: 'Money' }).textContent).toContain('Subscriptions');
      expect(screen.getByRole('group', { name: 'Books' }).textContent).toContain('Tax');
      expect(screen.getByTestId('finance-nav').className).toContain('flex-wrap');
      expect(screen.getByTestId('finance-nav').className).not.toContain('scrollbar-none');
    });

    it('marks the current page in charcoal tokens in both themes', () => {
      mockPathname = '/finance/tax';
      renderWithClient(<FinanceNav />);
      const tax = screen.getByTestId('finance-nav-item--finance-tax');
      expect(tax.className).toContain('bg-charcoal');
      expect(tax.className).not.toMatch(/amber|dark:/);
    });

    it('highlights active tab according to pathname', () => {
      mockPathname = '/finance/expenses';
      renderWithClient(<FinanceNav />);
      const expensesTab = screen.getByTestId('finance-nav-item--finance-expenses');
      expect(expensesTab.getAttribute('aria-current')).toBe('page');

      const overviewTab = screen.getByTestId('finance-nav-item--finance');
      expect(overviewTab.getAttribute('aria-current')).toBeNull();
    });
  });

  describe('FinanceOverviewView (/finance)', () => {
    it('leads with cash, what customers owe, VAT due and bills to pay, each linking to its page', () => {
      renderWithClient(<FinanceOverviewView />);
      expect(screen.getByTestId('finance-overview-view')).toBeDefined();
      expect(screen.getByRole('heading', { level: 1, name: 'Finance' })).toBeDefined();
      const headlines = screen.getByTestId('finance-headlines');
      expect([...headlines.querySelectorAll('h2')].map((h) => h.textContent)).toEqual([
        'Cash',
        'Customers owe you',
        'VAT due',
        'Bills to pay',
      ]);
      expect(screen.getByRole('link', { name: 'See receivables aging' })).toBeDefined();
      expect(screen.getByRole('link', { name: 'See the VAT return' })).toBeDefined();
      expect(screen.getByRole('link', { name: 'See supplier bills' })).toBeDefined();
      expect(screen.getByTestId('cash-by-account')).toBeDefined();
      expect(screen.getByTestId('cash-forecast')).toBeDefined();
      // No burn-rate or runway copy.
      expect(screen.queryByText(/burn|runway|self-sustaining|velocity/i)).toBeNull();
    });

    it('never adds the dollar accounts into AED cash', () => {
      renderWithClient(<FinanceOverviewView />);
      // Both mock accounts are in USD and the base currency is AED.
      expect(screen.getByTestId('headline-cash-figure').textContent?.replace(/\s/g, ' ')).toBe('AED 0.00');
      expect(screen.getByTestId('cash-other-currencies').textContent).toContain('$465,000.00');
    });

    it('keeps one amber action on the page', () => {
      renderWithClient(<FinanceOverviewView />);
      // Closed dialogs stay in the DOM with their own submit buttons; only the page counts.
      const onPage = [...document.querySelectorAll('.bg-brand')].filter((el) => !el.closest('dialog'));
      expect(onPage.length).toBeLessThanOrEqual(1);
    });

    it('opens transfer funds modal from header quick action', async () => {
      renderWithClient(<FinanceOverviewView />);
      const transferBtn = screen.getByTestId('overview-quick-transfer-btn');
      fireEvent.click(transferBtn);
      expect(screen.getAllByText('Transfer Funds Between Accounts').length).toBeGreaterThan(0);
    });

    it('opens submit expense modal from quick action', async () => {
      renderWithClient(<FinanceOverviewView />);
      const expenseBtn = screen.getByTestId('overview-quick-expense-btn');
      fireEvent.click(expenseBtn);
      expect(screen.getAllByText('Submit Expense Claim').length).toBeGreaterThan(0);
    });
  });

  describe('ExpensesView (/finance/expenses)', () => {
    it('renders expenses summary KPIs and claims table', () => {
      renderWithClient(<ExpensesView />);
      expect(screen.getByTestId('expenses-view')).toBeDefined();
      expect(screen.getByTestId('stat-pending')).toBeDefined();
      expect(screen.getByTestId('expense-claims-table')).toBeDefined();
      expect(screen.getByText('EXP-1001')).toBeDefined();
      expect(screen.getByText('EXP-1002')).toBeDefined();
    });

    it('opens submit modal when clicking "Submit Expense Claim"', () => {
      renderWithClient(<ExpensesView />);
      const submitBtn = screen.getByTestId('submit-new-claim-btn');
      fireEvent.click(submitBtn);
      expect(screen.getAllByText('Submit Expense Claim').length).toBeGreaterThan(0);
    });

    it('navigates to claim detail view when row is clicked', () => {
      renderWithClient(<ExpensesView />);
      const claimNumberBtn = screen.getByText('EXP-1001');
      fireEvent.click(claimNumberBtn);
      expect(mockPush).toHaveBeenCalledWith('/finance/expenses/exp-1');
    });
  });

  describe('ExpenseDetailView (/finance/expenses/[id])', () => {
    it('renders claim details, workflow ribbon, and receipt preview', () => {
      renderWithClient(<ExpenseDetailView id="exp-1" />);
      expect(screen.getByTestId('expense-detail-view')).toBeDefined();
      expect(screen.getByTestId('claim-number-title')).toBeDefined();
      expect(screen.getByTestId('expense-status-ribbon')).toBeDefined();
      expect(screen.getByTestId('receipt-preview-card')).toBeDefined();
      expect(screen.getAllByText('Sarah Connor').length).toBeGreaterThan(0);
    });

    /** Approving posts to the books, so it asks first. */
    it('approves a submitted claim once the approval is confirmed', async () => {
      renderWithClient(<ExpenseDetailView id="exp-1" />);
      fireEvent.click(screen.getByTestId('detail-approve-btn'));
      expect(mockSignalClaim).not.toHaveBeenCalled();
      fireEvent.click(within(document.querySelector('dialog[open]') as HTMLElement).getByRole('button', { name: 'Approve claim' }));
      await waitFor(() =>
        expect(mockSignalClaim).toHaveBeenCalledWith(expect.objectContaining({ action: 'APPROVE' })),
      );
    });

    it('shows reject dialog when clicking reject button', async () => {
      renderWithClient(<ExpenseDetailView id="exp-1" />);
      const rejectBtn = screen.getByTestId('detail-reject-btn');
      fireEvent.click(rejectBtn);
      expect(screen.getAllByText(/^Reject .+?$/).length).toBeGreaterThan(0);
    });

    it('reimburses an approved claim once the payment is confirmed', async () => {
      renderWithClient(<ExpenseDetailView id="exp-2" />);
      fireEvent.click(screen.getByTestId('detail-reimburse-btn'));
      expect(mockSignalClaim).not.toHaveBeenCalled();
      fireEvent.click(within(document.querySelector('dialog[open]') as HTMLElement).getByRole('button', { name: 'Reimburse claim' }));
      await waitFor(() =>
        expect(mockSignalClaim).toHaveBeenCalledWith(expect.objectContaining({ action: 'REIMBURSE' })),
      );
    });

    it('renders not found state for invalid id', () => {
      renderWithClient(<ExpenseDetailView id="non-existent" />);
      expect(screen.getByTestId('expense-detail-not-found')).toBeDefined();
    });
  });

  describe('BudgetsView (/finance/budgets)', () => {
    it('renders budgets KPI summary and budget grid', () => {
      renderWithClient(<BudgetsView />);
      expect(screen.getByTestId('budgets-view')).toBeDefined();
      expect(screen.getByTestId('stat-total-allocated')).toBeDefined();
      expect(screen.getByTestId('budget-grid')).toBeDefined();
      expect(screen.getAllByText('Software & SaaS').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Marketing').length).toBeGreaterThan(0);
    });

    it('opens create budget modal when clicking new budget cap', () => {
      renderWithClient(<BudgetsView />);
      const newBudgetBtn = screen.getByTestId('create-budget-btn');
      fireEvent.click(newBudgetBtn);
      expect(screen.getAllByText('Create Category Budget Cap').length).toBeGreaterThan(0);
    });
  });

  describe('AccountsView (/finance/accounts)', () => {
    it('renders accounts liquidity KPI summary and balance grid', () => {
      renderWithClient(<AccountsView />);
      expect(screen.getByTestId('accounts-view')).toBeDefined();
      expect(screen.getByTestId('stat-total-liquidity')).toBeDefined();
      expect(screen.getByTestId('account-balance-grid')).toBeDefined();
      expect(screen.getAllByText('SVB Operating').length).toBeGreaterThan(0);
    });

    it('totals cash in the base currency and lists dollar balances apart', () => {
      renderWithClient(<AccountsView />);
      const stat = screen.getByTestId('stat-total-liquidity');
      expect(stat.textContent).toContain('Cash in AED');
      expect(stat.textContent?.replace(/\s/g, ' ')).toContain('AED 0.00');
      expect(screen.getByTestId('stat-other-currencies').textContent).toContain('$465,000.00');
    });

    it('opens create account modal when clicking new account', () => {
      renderWithClient(<AccountsView />);
      const newAccountBtn = screen.getByTestId('accounts-new-account-btn');
      fireEvent.click(newAccountBtn);
      expect(screen.getAllByText('Add Financial Account').length).toBeGreaterThan(0);
    });

    it('opens transfer funds modal when clicking transfer funds', () => {
      renderWithClient(<AccountsView />);
      const transferBtn = screen.getByTestId('accounts-transfer-funds-btn');
      fireEvent.click(transferBtn);
      expect(screen.getAllByText('Transfer Funds Between Accounts').length).toBeGreaterThan(0);
    });
  });

  describe('SubscriptionsView (/finance/subscriptions)', () => {
    it('renders SaaS run rate KPI stats and subscriptions table', () => {
      renderWithClient(<SubscriptionsView />);
      expect(screen.getByTestId('subscriptions-view')).toBeDefined();
      expect(screen.getByTestId('stat-monthly-run-rate')).toBeDefined();
      expect(screen.getByTestId('subscriptions-table')).toBeDefined();
      expect(screen.getAllByText('AWS Cloud Services').length).toBeGreaterThan(0);
      expect(screen.getAllByText('GitHub Enterprise').length).toBeGreaterThan(0);
    });

    it('opens add subscription modal when clicking Add Subscription', () => {
      renderWithClient(<SubscriptionsView />);
      const addSubBtn = screen.getByTestId('add-subscription-btn');
      fireEvent.click(addSubBtn);
      expect(screen.getAllByText('New recurring expense').length).toBeGreaterThan(0);
    });
  });
});
