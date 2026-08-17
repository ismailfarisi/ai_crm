import { describe, it, expect } from 'vitest';
import {
  FINANCE_PERMISSIONS,
  calculateRunwayMonths,
  type AccountType,
  type ExpenseStatus,
  type BudgetPeriod,
  type FinanceAccountDto,
  type ExpenseItemDto,
  type ExpenseClaimDto,
  type CategoryBudgetDto,
  type RecurringExpenseDto,
  type JournalLineDto,
  type JournalEntryDto,
  type TreasuryOverviewDto,
} from './types';

describe('Finance Types & Helpers', () => {
  it('defines required finance and expense permissions', () => {
    expect(FINANCE_PERMISSIONS.FINANCE_READ).toBe('finance:read');
    expect(FINANCE_PERMISSIONS.FINANCE_MANAGE).toBe('finance:manage');
    expect(FINANCE_PERMISSIONS.EXPENSE_SUBMIT).toBe('expense:submit');
    expect(FINANCE_PERMISSIONS.EXPENSE_APPROVE).toBe('expense:approve');
  });

  it('calculates runway months accurately with standard numbers', () => {
    const totalCash = 120000;
    const monthlyBurn = 15000;
    const runway = calculateRunwayMonths(totalCash, monthlyBurn);
    expect(runway).toBe(8);
  });

  it('calculates runway months with rounding to 1 decimal place', () => {
    const totalCash = 100000;
    const monthlyBurn = 15000;
    const runway = calculateRunwayMonths(totalCash, monthlyBurn);
    expect(runway).toBe(6.7);
  });

  it('handles zero or positive net burn (zero or negative burn rate) gracefully', () => {
    expect(calculateRunwayMonths(100000, 0)).toBe(Infinity);
    expect(calculateRunwayMonths(100000, -5000)).toBe(Infinity);
  });

  it('handles zero cash balance correctly', () => {
    expect(calculateRunwayMonths(0, 5000)).toBe(0);
  });

  it('allows building valid DTO structures matching the specification', () => {
    const item: ExpenseItemDto = {
      description: 'Client Lunch',
      quantity: 1,
      unitPrice: 75.5,
      amount: 75.5,
    };

    const claim: ExpenseClaimDto = {
      id: 'claim-1',
      tenantId: 'tenant-1',
      claimNumber: 'EXP-0001',
      employeeId: 'emp-1',
      employeeName: 'Jane Doe',
      category: 'Meals & Entertainment',
      amount: 75.5,
      currency: 'USD',
      status: 'SUBMITTED',
      expenseDate: '2026-08-17',
      items: [item],
      createdAt: '2026-08-17T12:00:00Z',
      updatedAt: '2026-08-17T12:00:00Z',
    };

    const account: FinanceAccountDto = {
      id: 'acc-1',
      tenantId: 'tenant-1',
      name: 'Silicon Valley Operating',
      accountType: 'BANK',
      currency: 'USD',
      balance: 250000,
      isDefault: true,
      createdAt: '2026-08-17T12:00:00Z',
      updatedAt: '2026-08-17T12:00:00Z',
    };

    const budget: CategoryBudgetDto = {
      id: 'bgt-1',
      tenantId: 'tenant-1',
      category: 'Software',
      period: 'MONTHLY',
      budgetAmount: 5000,
      spentAmount: 3200,
      alertThresholdPercent: 80,
      startDate: '2026-08-01',
      endDate: '2026-08-31',
      createdAt: '2026-08-17T12:00:00Z',
      updatedAt: '2026-08-17T12:00:00Z',
    };

    const recurring: RecurringExpenseDto = {
      id: 'rec-1',
      tenantId: 'tenant-1',
      vendorName: 'AWS Cloud Services',
      category: 'Infrastructure',
      amount: 1200,
      billingInterval: 'MONTHLY',
      nextBillingDate: '2026-09-01',
      status: 'ACTIVE',
      createdAt: '2026-08-17T12:00:00Z',
      updatedAt: '2026-08-17T12:00:00Z',
    };

    const line: JournalLineDto = {
      accountName: 'Operating Account',
      debit: 0,
      credit: 75.5,
      description: 'Reimbursement for Client Lunch',
    };

    const journal: JournalEntryDto = {
      id: 'jnl-1',
      tenantId: 'tenant-1',
      entryNumber: 'JE-0001',
      referenceType: 'EXPENSE',
      referenceId: claim.id,
      entryDate: '2026-08-17',
      lines: [line],
      totalAmount: 75.5,
      createdAt: '2026-08-17T12:00:00Z',
    };

    const treasury: TreasuryOverviewDto = {
      totalCash: 250000,
      currency: 'USD',
      monthlyInflow: 45000,
      monthlyOutflow: 20000,
      netCashflow: 25000,
      monthlyBurnRate: 20000,
      runwayMonths: 12.5,
      accounts: [account],
      recentCashflowSeries: [
        { date: '2026-08-01', inflow: 10000, outflow: 5000, net: 5000 },
      ],
    };

    expect(claim.claimNumber).toBe('EXP-0001');
    expect(account.balance).toBe(250000);
    expect(budget.budgetAmount).toBe(5000);
    expect(recurring.vendorName).toBe('AWS Cloud Services');
    expect(journal.totalAmount).toBe(75.5);
    expect(treasury.runwayMonths).toBe(12.5);
  });
});
