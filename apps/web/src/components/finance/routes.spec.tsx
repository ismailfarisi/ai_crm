import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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

vi.mock('@/hooks/use-finance', () => ({
  useFinanceOverview: () => ({ data: mockOverview, isLoading: false }),
  useFinanceAccounts: () => ({ data: mockAccounts, isLoading: false }),
  useCategoryBudgets: () => ({ data: mockBudgets, isLoading: false }),
  useRecurringExpenses: () => ({ data: mockSubscriptions, isLoading: false }),
  useCreateFinanceAccount: () => ({ mutateAsync: mockCreateAccount, isPending: false }),
  useTransferFunds: () => ({ mutateAsync: mockTransferFunds, isPending: false }),
  useCreateCategoryBudget: () => ({ mutateAsync: mockCreateBudget, isPending: false }),
  useCreateRecurringExpense: () => ({ mutateAsync: mockCreateSub, isPending: false }),
}));

vi.mock('@/hooks/use-expenses', () => ({
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
    it('renders overview header, stat cards, trend chart, and accounts grid', () => {
      renderWithClient(<FinanceOverviewView />);
      expect(screen.getByTestId('finance-overview-view')).toBeDefined();
      expect(screen.getByText('Finance & Treasury')).toBeDefined();
      expect(screen.getByTestId('treasury-stat-cards')).toBeDefined();
      expect(screen.getByTestId('cashflow-trend-chart')).toBeDefined();
      expect(screen.getByTestId('account-balance-grid')).toBeDefined();
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
      expect(screen.getByTestId('stat-total-claims')).toBeDefined();
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

    it('approves a submitted claim when clicking approve button', async () => {
      renderWithClient(<ExpenseDetailView id="exp-1" />);
      const approveBtn = screen.getByTestId('detail-approve-btn');
      fireEvent.click(approveBtn);
      expect(mockSignalClaim).toHaveBeenCalledWith({ action: 'APPROVE' });
    });

    it('shows reject dialog when clicking reject button', async () => {
      renderWithClient(<ExpenseDetailView id="exp-1" />);
      const rejectBtn = screen.getByTestId('detail-reject-btn');
      fireEvent.click(rejectBtn);
      expect(screen.getAllByText('Reject Expense Claim').length).toBeGreaterThan(0);
    });

    it('allows reimbursing an approved claim', async () => {
      renderWithClient(<ExpenseDetailView id="exp-2" />);
      const reimburseBtn = screen.getByTestId('detail-reimburse-btn');
      fireEvent.click(reimburseBtn);
      expect(mockSignalClaim).toHaveBeenCalledWith({ action: 'REIMBURSE' });
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
      expect(screen.getAllByText('Add Recurring Subscription').length).toBeGreaterThan(0);
    });
  });
});
