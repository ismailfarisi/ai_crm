import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { api } from '@/lib/api/endpoints';
import {
  useFinanceOverview,
  useFinanceAccounts,
  useCreateFinanceAccount,
  useTransferFunds,
  useCategoryBudgets,
  useCreateCategoryBudget,
  useRecurringExpenses,
  useCreateRecurringExpense,
  useJournalEntries,
} from './use-finance';
import {
  useExpenses,
  useExpense,
  useCreateExpenseClaim,
  useUpdateExpenseClaim,
  useScanReceipt,
  useSignalExpenseClaim,
} from './use-expenses';
import type {
  TreasuryOverviewDto,
  FinanceAccountDto,
  CategoryBudgetDto,
  RecurringExpenseDto,
  JournalEntryDto,
  ExpenseClaimDto,
  ScannedReceiptResult,
} from '@saas/shared';

// Mock api methods
vi.mock('@/lib/api/endpoints', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/api/endpoints')>();
  return {
    ...original,
    api: {
      ...original.api,
      finance: {
        getOverview: vi.fn(),
        listAccounts: vi.fn(),
        createAccount: vi.fn(),
        transferFunds: vi.fn(),
        listBudgets: vi.fn(),
        createBudget: vi.fn(),
        listSubscriptions: vi.fn(),
        createSubscription: vi.fn(),
        listJournalEntries: vi.fn(),
      },
      expenses: {
        list: vi.fn(),
        get: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        scanReceipt: vi.fn(),
        signal: vi.fn(),
      },
    },
  };
});

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
      },
      mutations: {
        retry: false,
      },
    },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

const mockOverview: TreasuryOverviewDto = {
  totalCash: 125000,
  currency: 'USD',
  monthlyInflow: 45000,
  monthlyOutflow: 20000,
  netCashflow: 25000,
  monthlyBurnRate: 20000,
  runwayMonths: 6.3,
  accounts: [],
  recentCashflowSeries: [
    { date: '2026-08-01', inflow: 1000, outflow: 500, net: 500 },
  ],
};

const mockAccount: FinanceAccountDto = {
  id: 'acc-1',
  tenantId: 'tenant-1',
  name: 'Operating Bank Account',
  accountType: 'BANK',
  currency: 'USD',
  balance: 100000,
  accountNumber: '••••4321',
  isDefault: true,
  createdAt: '2026-08-17T00:00:00Z',
  updatedAt: '2026-08-17T00:00:00Z',
};

const mockBudget: CategoryBudgetDto = {
  id: 'bud-1',
  tenantId: 'tenant-1',
  category: 'Software & Tools',
  period: 'MONTHLY',
  budgetAmount: 5000,
  spentAmount: 3200,
  alertThresholdPercent: 80,
  startDate: '2026-08-01',
  endDate: '2026-08-31',
  createdAt: '2026-08-17T00:00:00Z',
  updatedAt: '2026-08-17T00:00:00Z',
};

const mockSubscription: RecurringExpenseDto = {
  id: 'sub-1',
  tenantId: 'tenant-1',
  vendorName: 'AWS Cloud',
  category: 'Infrastructure',
  amount: 1200,
  billingInterval: 'MONTHLY',
  nextBillingDate: '2026-09-01',
  status: 'ACTIVE',
  createdAt: '2026-08-17T00:00:00Z',
  updatedAt: '2026-08-17T00:00:00Z',
};

const mockJournalEntry: JournalEntryDto = {
  id: 'je-1',
  tenantId: 'tenant-1',
  entryNumber: 'JE-TRF-2026-001',
  referenceType: 'TRANSFER',
  referenceId: 'acc-1->acc-2',
  entryDate: '2026-08-17T00:00:00Z',
  lines: [
    { accountName: 'Operating', debit: 0, credit: 5000, description: 'Transfer' },
    { accountName: 'Payroll', debit: 5000, credit: 0, description: 'Transfer' },
  ],
  totalAmount: 5000,
  createdAt: '2026-08-17T00:00:00Z',
};

const mockExpense: ExpenseClaimDto = {
  id: 'exp-1',
  tenantId: 'tenant-1',
  claimNumber: 'EXP-2026-001',
  employeeId: 'emp-1',
  employeeName: 'Sarah Connor',
  category: 'Travel',
  amount: 450,
  currency: 'USD',
  status: 'SUBMITTED',
  merchantName: 'Delta Airlines',
  expenseDate: '2026-08-15',
  items: [
    { description: 'Flight ticket', quantity: 1, unitPrice: 450, amount: 450 },
  ],
  createdAt: '2026-08-17T00:00:00Z',
  updatedAt: '2026-08-17T00:00:00Z',
};

const mockScannedResult: ScannedReceiptResult = {
  merchantName: 'Starbucks',
  amount: 14.5,
  currency: 'USD',
  expenseDate: '2026-08-17',
  category: 'Meals & Entertainment',
  taxAmount: 1.2,
  confidence: 0.95,
  items: [
    { description: 'Latte', quantity: 2, unitPrice: 7.25, amount: 14.5 },
  ],
};

describe('API Client Endpoints for Finance & Expenses', () => {
  it('provides all required finance API client endpoints', () => {
    expect(typeof api.finance.getOverview).toBe('function');
    expect(typeof api.finance.listAccounts).toBe('function');
    expect(typeof api.finance.createAccount).toBe('function');
    expect(typeof api.finance.transferFunds).toBe('function');
    expect(typeof api.finance.listBudgets).toBe('function');
    expect(typeof api.finance.createBudget).toBe('function');
    expect(typeof api.finance.listSubscriptions).toBe('function');
    expect(typeof api.finance.createSubscription).toBe('function');
    expect(typeof api.finance.listJournalEntries).toBe('function');
  });

  it('provides all required expenses API client endpoints', () => {
    expect(typeof api.expenses.list).toBe('function');
    expect(typeof api.expenses.get).toBe('function');
    expect(typeof api.expenses.create).toBe('function');
    expect(typeof api.expenses.update).toBe('function');
    expect(typeof api.expenses.scanReceipt).toBe('function');
    expect(typeof api.expenses.signal).toBe('function');
  });
});

describe('useFinance Hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.finance.getOverview).mockResolvedValue(mockOverview);
    vi.mocked(api.finance.listAccounts).mockResolvedValue([mockAccount]);
    vi.mocked(api.finance.createAccount).mockResolvedValue(mockAccount);
    vi.mocked(api.finance.transferFunds).mockResolvedValue({
      fromAccount: mockAccount,
      toAccount: mockAccount,
      journalEntry: mockJournalEntry,
    });
    vi.mocked(api.finance.listBudgets).mockResolvedValue([mockBudget]);
    vi.mocked(api.finance.createBudget).mockResolvedValue(mockBudget);
    vi.mocked(api.finance.listSubscriptions).mockResolvedValue([mockSubscription]);
    vi.mocked(api.finance.createSubscription).mockResolvedValue(mockSubscription);
    vi.mocked(api.finance.listJournalEntries).mockResolvedValue([mockJournalEntry]);
  });

  it('fetches treasury overview data', async () => {
    const { result } = renderHook(() => useFinanceOverview(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.data).toEqual(mockOverview);
    expect(api.finance.getOverview).toHaveBeenCalledTimes(1);
  });

  it('fetches accounts and creates a new finance account', async () => {
    const { result: accountsResult } = renderHook(() => useFinanceAccounts(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(accountsResult.current.isLoading).toBe(false));
    expect(accountsResult.current.data).toEqual([mockAccount]);

    const { result: createResult } = renderHook(() => useCreateFinanceAccount(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await createResult.current.mutateAsync({
        name: 'Operating Bank Account',
        accountType: 'BANK',
        currency: 'USD',
        balance: 100000,
      });
    });

    expect(api.finance.createAccount).toHaveBeenCalledWith({
      name: 'Operating Bank Account',
      accountType: 'BANK',
      currency: 'USD',
      balance: 100000,
    });
  });

  it('transfers funds between finance accounts', async () => {
    const { result } = renderHook(() => useTransferFunds(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync({
        fromAccountId: 'acc-1',
        toAccountId: 'acc-2',
        amount: 5000,
        description: 'Monthly payroll transfer',
      });
    });

    expect(api.finance.transferFunds).toHaveBeenCalledWith({
      fromAccountId: 'acc-1',
      toAccountId: 'acc-2',
      amount: 5000,
      description: 'Monthly payroll transfer',
    });
  });

  it('lists budgets and creates a new category budget', async () => {
    const { result: budgetsResult } = renderHook(() => useCategoryBudgets(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(budgetsResult.current.isLoading).toBe(false));
    expect(budgetsResult.current.data).toEqual([mockBudget]);

    const { result: createBudgetResult } = renderHook(() => useCreateCategoryBudget(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await createBudgetResult.current.mutateAsync({
        category: 'Software & Tools',
        period: 'MONTHLY',
        budgetAmount: 5000,
        startDate: '2026-08-01',
        endDate: '2026-08-31',
      });
    });

    expect(api.finance.createBudget).toHaveBeenCalledWith({
      category: 'Software & Tools',
      period: 'MONTHLY',
      budgetAmount: 5000,
      startDate: '2026-08-01',
      endDate: '2026-08-31',
    });
  });

  it('lists subscriptions and creates recurring expense', async () => {
    const { result: subsResult } = renderHook(() => useRecurringExpenses(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(subsResult.current.isLoading).toBe(false));
    expect(subsResult.current.data).toEqual([mockSubscription]);

    const { result: createSubResult } = renderHook(() => useCreateRecurringExpense(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await createSubResult.current.mutateAsync({
        vendorName: 'AWS Cloud',
        category: 'Infrastructure',
        amount: 1200,
        billingInterval: 'MONTHLY',
        nextBillingDate: '2026-09-01',
      });
    });

    expect(api.finance.createSubscription).toHaveBeenCalledWith({
      vendorName: 'AWS Cloud',
      category: 'Infrastructure',
      amount: 1200,
      billingInterval: 'MONTHLY',
      nextBillingDate: '2026-09-01',
    });
  });

  it('fetches journal entries', async () => {
    const { result } = renderHook(() => useJournalEntries(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.data).toEqual([mockJournalEntry]);
    expect(api.finance.listJournalEntries).toHaveBeenCalledTimes(1);
  });
});

describe('useExpenses Hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.expenses.list).mockResolvedValue([mockExpense]);
    vi.mocked(api.expenses.get).mockResolvedValue(mockExpense);
    vi.mocked(api.expenses.create).mockResolvedValue(mockExpense);
    vi.mocked(api.expenses.update).mockResolvedValue(mockExpense);
    vi.mocked(api.expenses.scanReceipt).mockResolvedValue(mockScannedResult);
    vi.mocked(api.expenses.signal).mockResolvedValue({
      ...mockExpense,
      status: 'APPROVED',
    });
  });

  it('lists expenses and supports create, update, and signal actions', async () => {
    const { result } = renderHook(() => useExpenses({ status: 'SUBMITTED' }), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.expenses).toEqual([mockExpense]);
    expect(api.expenses.list).toHaveBeenCalledWith({ status: 'SUBMITTED' });

    // Create Claim
    await act(async () => {
      await result.current.createClaim({
        category: 'Travel',
        amount: 450,
        merchantName: 'Delta Airlines',
      });
    });
    expect(api.expenses.create).toHaveBeenCalledWith({
      category: 'Travel',
      amount: 450,
      merchantName: 'Delta Airlines',
    });

    // Update Claim
    await act(async () => {
      await result.current.updateClaim('exp-1', { amount: 500 });
    });
    expect(api.expenses.update).toHaveBeenCalledWith('exp-1', { amount: 500 });

    // Signal Claim
    await act(async () => {
      await result.current.signalClaim('exp-1', { action: 'APPROVE' });
    });
    expect(api.expenses.signal).toHaveBeenCalledWith('exp-1', { action: 'APPROVE' });
  });

  it('fetches single expense claim and updates/signals it', async () => {
    const { result } = renderHook(() => useExpense('exp-1'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.expense).toEqual(mockExpense);
    expect(api.expenses.get).toHaveBeenCalledWith('exp-1');

    await act(async () => {
      await result.current.updateClaim({ category: 'Airfare' });
    });
    expect(api.expenses.update).toHaveBeenCalledWith('exp-1', { category: 'Airfare' });

    await act(async () => {
      await result.current.signalClaim({ action: 'REJECT', reason: 'Missing receipt' });
    });
    expect(api.expenses.signal).toHaveBeenCalledWith('exp-1', {
      action: 'REJECT',
      reason: 'Missing receipt',
    });
  });

  it('scans receipt via useScanReceipt hook', async () => {
    const { result } = renderHook(() => useScanReceipt(), {
      wrapper: createWrapper(),
    });

    let scanned: ScannedReceiptResult | undefined;
    await act(async () => {
      scanned = await result.current.mutateAsync({
        rawText: 'Starbucks Coffee Total $14.50 Date 2026-08-17',
      });
    });

    expect(scanned).toEqual(mockScannedResult);
    expect(api.expenses.scanReceipt).toHaveBeenCalledWith({
      rawText: 'Starbucks Coffee Total $14.50 Date 2026-08-17',
    });
  });

  it('supports direct mutation hooks: useCreateExpenseClaim, useUpdateExpenseClaim, useSignalExpenseClaim', async () => {
    const { result: createHook } = renderHook(() => useCreateExpenseClaim(), {
      wrapper: createWrapper(),
    });
    await act(async () => {
      await createHook.current.mutateAsync({
        category: 'Meals',
        amount: 25,
      });
    });
    expect(api.expenses.create).toHaveBeenCalledWith({ category: 'Meals', amount: 25 });

    const { result: updateHook } = renderHook(() => useUpdateExpenseClaim(), {
      wrapper: createWrapper(),
    });
    await act(async () => {
      await updateHook.current.mutateAsync({
        id: 'exp-1',
        payload: { amount: 30 },
      });
    });
    expect(api.expenses.update).toHaveBeenCalledWith('exp-1', { amount: 30 });

    const { result: signalHook } = renderHook(() => useSignalExpenseClaim(), {
      wrapper: createWrapper(),
    });
    await act(async () => {
      await signalHook.current.mutateAsync({
        id: 'exp-1',
        payload: { action: 'REIMBURSE', accountId: 'acc-1' },
      });
    });
    expect(api.expenses.signal).toHaveBeenCalledWith('exp-1', {
      action: 'REIMBURSE',
      accountId: 'acc-1',
    });
  });
});
