import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import type {
  CategoryBudgetDto,
  FinanceAccountDto,
  RecurringExpenseDto,
} from '@saas/shared';

import {
  BudgetMeterCard,
  BudgetGrid,
  formatBudgetCurrency,
  formatBudgetDateRange,
  calculateBudgetStatus,
  getCategoryBudgetMetadata,
} from './budget-meter-card';

import {
  CreateBudgetModal,
  getDefaultDatesForPeriod,
  BUDGET_CATEGORIES,
} from './create-budget-modal';

import {
  CreateAccountModal,
  ACCOUNT_TYPE_OPTIONS,
} from '../accounts/create-account-modal';

import {
  TransferFundsModal,
} from '../accounts/transfer-funds-modal';

import {
  SubscriptionsTable,
  calculateNormalizedMonthlyCost,
  formatNextBillingDate,
} from '../subscriptions/subscriptions-table';

import { SubscriptionFormModal } from '../subscriptions/subscription-form-modal';

let canApprove = true;
vi.mock('@/lib/session-context', () => ({
  useSession: () => ({ check: () => canApprove }),
  useCan: () => canApprove,
}));

// Budgets and schedules without a supplier currency are in the base currency.
vi.mock('@/hooks/use-organization', () => ({ useOrganization: () => ({ data: { baseCurrency: 'AED' } }) }));

vi.mock('@/hooks/use-suppliers', () => ({
  useSuppliers: () => ({
    data: { items: [{ id: 'sup-1', companyName: 'Landlord LLC' }], meta: { total: 1, page: 1, limit: 100, totalPages: 1 } },
  }),
}));

vi.mock('@/hooks/use-finance', () => ({
  useRecurringOccurrences: () => ({
    data: [
      {
        id: 'occ-1',
        periodStart: '2026-07-01',
        periodEnd: '2026-09-30',
        amount: 30000,
        billId: 'bill-9',
        billNumber: 'INV-9',
        status: 'GENERATED',
        error: null,
        attempts: 1,
        createdAt: '2026-07-01T00:00:00Z',
      },
    ],
    isLoading: false,
    isError: false,
  }),
}));

beforeEach(() => {
  canApprove = true;
});

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

// Mock Data
const mockBudgets: CategoryBudgetDto[] = [
  {
    id: 'budget-1',
    tenantId: 'tenant-1',
    category: 'Marketing',
    period: 'MONTHLY',
    budgetAmount: 10000,
    spentAmount: 4500,
    alertThresholdPercent: 85,
    startDate: '2026-08-01',
    endDate: '2026-08-31',
    createdAt: '2026-08-01T00:00:00Z',
    updatedAt: '2026-08-15T12:00:00Z',
  },
  {
    id: 'budget-2',
    tenantId: 'tenant-1',
    category: 'Software & SaaS',
    period: 'MONTHLY',
    budgetAmount: 5000,
    spentAmount: 4600, // 92% spent -> near limit
    alertThresholdPercent: 85,
    startDate: '2026-08-01',
    endDate: '2026-08-31',
    createdAt: '2026-08-01T00:00:00Z',
    updatedAt: '2026-08-15T12:00:00Z',
  },
  {
    id: 'budget-3',
    tenantId: 'tenant-1',
    category: 'Travel & Lodging',
    period: 'QUARTERLY',
    budgetAmount: 8000,
    spentAmount: 9200, // 115% spent -> over budget
    alertThresholdPercent: 80,
    startDate: '2026-07-01',
    endDate: '2026-09-30',
    createdAt: '2026-07-01T00:00:00Z',
    updatedAt: '2026-08-15T12:00:00Z',
  },
];

const mockAccounts: FinanceAccountDto[] = [
  {
    id: 'acc-1',
    tenantId: 'tenant-1',
    name: 'SVB Operating Checking',
    accountType: 'BANK',
    currency: 'USD',
    balance: 145000.5,
    accountNumber: '4829384729',
    isDefault: true,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-08-15T00:00:00Z',
  },
  {
    id: 'acc-2',
    tenantId: 'tenant-1',
    name: 'Petty Cash Office',
    accountType: 'CASH',
    currency: 'USD',
    balance: 2400.0,
    accountNumber: null,
    isDefault: false,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-08-15T00:00:00Z',
  },
  {
    id: 'acc-3',
    tenantId: 'tenant-1',
    name: 'Stripe Clearing Gateway',
    accountType: 'CLEARING',
    currency: 'USD',
    balance: 38200.0,
    accountNumber: '•••• 1928',
    isDefault: false,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-08-15T00:00:00Z',
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
    vendorName: 'AWS Cloud Infrastructure',
    category: 'Cloud Infrastructure',
    amount: 1200.0,
    billingInterval: 'MONTHLY',
    nextBillingDate: '2026-08-25',
    financeAccountId: 'acc-1',
    status: 'ACTIVE',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-08-01T00:00:00Z',
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
    amount: 2400.0,
    billingInterval: 'ANNUAL', // $200 / mo
    nextBillingDate: '2026-08-20',
    financeAccountId: 'acc-1',
    status: 'ACTIVE',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-08-01T00:00:00Z',
  },
  {
    id: 'sub-3',
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
    vendorName: 'Figma Design Team',
    category: 'Software & SaaS',
    amount: 150.0,
    billingInterval: 'MONTHLY',
    nextBillingDate: '2026-09-10',
    financeAccountId: 'acc-1',
    status: 'PAUSED',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-08-01T00:00:00Z',
  },
  {
    id: 'sub-4',
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
    vendorName: 'Legacy Hosting Server',
    category: 'Cloud Infrastructure',
    amount: 80.0,
    billingInterval: 'MONTHLY',
    nextBillingDate: '2026-07-01',
    financeAccountId: null,
    status: 'CANCELLED',
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2026-07-01T00:00:00Z',
  },
];

// ==========================================
// 1. BudgetMeterCard & BudgetGrid Tests
// ==========================================
describe('BudgetMeterCard Component', () => {
  it('renders normal healthy budget (<85% spent) correctly', () => {
    render(<BudgetMeterCard currency="AED" budget={mockBudgets[0]} />);

    expect(screen.getByTestId('budget-meter-card-budget-1')).toBeInTheDocument();
    expect(screen.getByTestId('budget-category-budget-1')).toHaveTextContent('Marketing');
    expect(screen.getByTestId('budget-spent-amount-budget-1')).toHaveTextContent('AED 4,500.00');
    expect(screen.getByTestId('budget-total-amount-budget-1')).toHaveTextContent('cap: AED 10,000.00');
    expect(screen.getByTestId('budget-period-badge-budget-1')).toHaveTextContent('MONTHLY');
    expect(screen.getByTestId('status-badge-healthy-budget-1')).toHaveTextContent('45% spent');
    expect(screen.getByTestId('budget-remaining-budget-1')).toHaveTextContent('AED 5,500.00 left');

    const progressBar = screen.getByTestId('budget-progress-bar-budget-1');
    expect(progressBar).toHaveStyle({ width: '45%' });
  });

  it('renders warning threshold budget (>85% spent) with amber styling', () => {
    render(<BudgetMeterCard currency="AED" budget={mockBudgets[1]} />);

    expect(screen.getByTestId('budget-meter-card-budget-2')).toBeInTheDocument();
    expect(screen.getByTestId('status-badge-warning-budget-2')).toHaveTextContent('Near Cap (92%)');
    expect(screen.getByTestId('budget-remaining-budget-2')).toHaveTextContent('AED 400.00 left');

    const progressBar = screen.getByTestId('budget-progress-bar-budget-2');
    expect(progressBar).toHaveClass('bg-warning');
    expect(progressBar).toHaveStyle({ width: '92%' });
  });

  it('renders exceeded budget (>=100% spent) with danger styling and overspend text', () => {
    render(<BudgetMeterCard currency="AED" budget={mockBudgets[2]} />);

    expect(screen.getByTestId('budget-meter-card-budget-3')).toBeInTheDocument();
    expect(screen.getByTestId('status-badge-overbudget-budget-3')).toHaveTextContent('Over Budget (115%)');
    expect(screen.getByTestId('budget-remaining-budget-3')).toHaveTextContent('+AED 1,200.00 over');

    const progressBar = screen.getByTestId('budget-progress-bar-budget-3');
    expect(progressBar).toHaveClass('bg-danger');
    expect(progressBar).toHaveStyle({ width: '100%' }); // clamped to 100% visually
  });

  it('handles edit, delete, and adjust action callbacks', () => {
    const handleEdit = vi.fn();
    const handleDelete = vi.fn();
    const handleAdjust = vi.fn();

    render(
      <BudgetMeterCard
        currency="AED"
        budget={mockBudgets[0]}
        onEdit={handleEdit}
        onDelete={handleDelete}
        onAdjust={handleAdjust}
      />,
    );

    const editBtn = screen.getByTestId('btn-edit-budget-budget-1');
    fireEvent.click(editBtn);
    expect(handleEdit).toHaveBeenCalledWith(mockBudgets[0]);

    const deleteBtn = screen.getByTestId('btn-delete-budget-budget-1');
    fireEvent.click(deleteBtn);
    expect(handleDelete).toHaveBeenCalledWith(mockBudgets[0]);

    const adjustBtn = screen.getByTestId('btn-adjust-budget-budget-1');
    fireEvent.click(adjustBtn);
    expect(handleAdjust).toHaveBeenCalledWith(mockBudgets[0]);
  });

  it('renders loading skeleton when isLoading is true', () => {
    render(<BudgetMeterCard currency="AED" budget={mockBudgets[0]} isLoading={true} />);
    expect(screen.getByTestId('budget-meter-loading')).toBeInTheDocument();
  });
});

describe('BudgetGrid Component', () => {
  it('renders grid with multiple budget cards', () => {
    render(<BudgetGrid currency="AED" budgets={mockBudgets} />);

    expect(screen.getByTestId('budget-grid')).toBeInTheDocument();
    expect(screen.getByTestId('budget-meter-card-budget-1')).toBeInTheDocument();
    expect(screen.getByTestId('budget-meter-card-budget-2')).toBeInTheDocument();
    expect(screen.getByTestId('budget-meter-card-budget-3')).toBeInTheDocument();
  });

  it('renders empty state when no budgets exist and triggers onNewBudget', () => {
    const handleNew = vi.fn();
    render(<BudgetGrid currency="AED" budgets={[]} onNewBudget={handleNew} />);

    expect(screen.getByTestId('budget-grid-empty')).toBeInTheDocument();
    expect(screen.getByText('No category budgets created')).toBeInTheDocument();

    const createFirstBtn = screen.getByText('Create First Budget');
    fireEvent.click(createFirstBtn);
    expect(handleNew).toHaveBeenCalledTimes(1);
  });

  it('renders loading skeleton when isLoading is true', () => {
    render(<BudgetGrid currency="AED" budgets={[]} isLoading={true} />);
    expect(screen.getByTestId('budget-grid-loading')).toBeInTheDocument();
  });
});

describe('Budget Utility Helpers', () => {
  it('formats currency correctly', () => {
    // Always in the currency given: budgets are set in the base currency.
    const plain = (s: string) => s.replace(/\s/g, ' ');
    expect(plain(formatBudgetCurrency(12500, 'AED'))).toBe('AED 12,500.00');
    expect(plain(formatBudgetCurrency(null, 'AED'))).toBe('AED 0.00');
    expect(formatBudgetCurrency(0, 'USD')).toBe('$0.00');
  });

  it('formats date range string correctly', () => {
    const formatted = formatBudgetDateRange('2026-08-01', '2026-08-31');
    expect(formatted).toContain('Aug 1');
    expect(formatted).toContain('Aug 31, 2026');
  });

  it('calculates budget health status accurately', () => {
    const healthy = calculateBudgetStatus(500, 1000, 85);
    expect(healthy.percentage).toBe(50);
    expect(healthy.remaining).toBe(500);
    expect(healthy.isHealthy).toBe(true);

    const nearCap = calculateBudgetStatus(880, 1000, 85);
    expect(nearCap.percentage).toBe(88);
    expect(nearCap.isNearLimit).toBe(true);

    const overBudget = calculateBudgetStatus(1200, 1000, 85);
    expect(overBudget.percentage).toBe(120);
    expect(overBudget.isOverBudget).toBe(true);
    expect(overBudget.remaining).toBe(-200);
  });
});

// ==========================================
// 2. CreateBudgetModal Tests
// ==========================================
describe('CreateBudgetModal Component', () => {
  it('renders all form fields when opened', () => {
    render(
      <CreateBudgetModal
        open={true}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );

    expect(screen.getByTestId('create-budget-form')).toBeInTheDocument();
    expect(screen.getByTestId('select-budget-category')).toBeInTheDocument();
    expect(screen.getByTestId('select-budget-period')).toBeInTheDocument();
    expect(screen.getByTestId('input-budget-amount')).toBeInTheDocument();
    expect(screen.getByTestId('input-alert-threshold')).toBeInTheDocument();
    expect(screen.getByTestId('input-budget-start-date')).toBeInTheDocument();
    expect(screen.getByTestId('input-budget-end-date')).toBeInTheDocument();
  });

  it('updates alert threshold via preset buttons and calculates live trigger amount', () => {
    render(
      <CreateBudgetModal
        open={true}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );

    const amountInput = screen.getByTestId('input-budget-amount');
    fireEvent.change(amountInput, { target: { value: '10000' } });

    // Click 90% preset button
    const preset90Btn = screen.getByTestId('preset-threshold-90');
    fireEvent.click(preset90Btn);

    expect(screen.getByTestId('threshold-percent-display')).toHaveTextContent('90%');
    expect(screen.getByTestId('threshold-preview-summary')).toHaveTextContent('$9,000.00');
  });

  it('supports custom category selection and input', () => {
    render(
      <CreateBudgetModal
        open={true}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );

    const categorySelect = screen.getByTestId('select-budget-category');
    fireEvent.change(categorySelect, { target: { value: '__CUSTOM__' } });

    const customInput = screen.getByTestId('input-custom-category');
    expect(customInput).toBeInTheDocument();
    fireEvent.change(customInput, { target: { value: 'Corporate Sponsorships' } });
    expect(customInput).toHaveValue('Corporate Sponsorships');
  });

  it('submits valid form payload correctly', async () => {
    const handleSubmit = vi.fn().mockResolvedValue(undefined);
    const handleClose = vi.fn();

    render(
      <CreateBudgetModal
        open={true}
        onClose={handleClose}
        onSubmit={handleSubmit}
      />,
    );

    const amountInput = screen.getByTestId('input-budget-amount');
    fireEvent.change(amountInput, { target: { value: '7500' } });

    const submitBtn = screen.getByTestId('btn-submit-budget');
    await act(async () => {
      fireEvent.click(submitBtn);
    });

    expect(handleSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'Marketing',
        period: 'MONTHLY',
        budgetAmount: 7500,
        alertThresholdPercent: 85,
      }),
    );
    expect(handleClose).toHaveBeenCalledTimes(1);
  });

  it('shows error if budget amount is zero or negative', async () => {
    const handleSubmit = vi.fn();
    render(
      <CreateBudgetModal
        open={true}
        onClose={vi.fn()}
        onSubmit={handleSubmit}
      />,
    );

    const amountInput = screen.getByTestId('input-budget-amount');
    fireEvent.change(amountInput, { target: { value: '0' } });

    const submitBtn = screen.getByTestId('btn-submit-budget');
    await act(async () => {
      fireEvent.click(submitBtn);
    });

    expect(screen.getByTestId('budget-form-error')).toBeInTheDocument();
    expect(handleSubmit).not.toHaveBeenCalled();
  });

  it('validates start date vs end date ordering', async () => {
    const handleSubmit = vi.fn();
    render(
      <CreateBudgetModal
        open={true}
        onClose={vi.fn()}
        onSubmit={handleSubmit}
      />,
    );

    fireEvent.change(screen.getByTestId('input-budget-amount'), { target: { value: '5000' } });
    fireEvent.change(screen.getByTestId('input-budget-start-date'), { target: { value: '2026-08-31' } });
    fireEvent.change(screen.getByTestId('input-budget-end-date'), { target: { value: '2026-08-01' } });

    const submitBtn = screen.getByTestId('btn-submit-budget');
    await act(async () => {
      fireEvent.click(submitBtn);
    });

    expect(screen.getByTestId('budget-form-error')).toHaveTextContent('Start date cannot be after end date');
    expect(handleSubmit).not.toHaveBeenCalled();
  });
});

// ==========================================
// 3. CreateAccountModal Tests
// ==========================================
describe('CreateAccountModal Component', () => {
  it('renders all fields and defaults', () => {
    render(
      <CreateAccountModal
        open={true}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );

    expect(screen.getByTestId('create-account-form')).toBeInTheDocument();
    expect(screen.getByTestId('input-account-name')).toBeInTheDocument();
    expect(screen.getByTestId('account-type-option-BANK')).toBeInTheDocument();
    expect(screen.getByTestId('account-type-option-CASH')).toBeInTheDocument();
    expect(screen.getByTestId('account-type-option-CREDIT_CARD')).toBeInTheDocument();
    expect(screen.getByTestId('account-type-option-CLEARING')).toBeInTheDocument();
    expect(screen.getByTestId('select-account-currency')).toBeInTheDocument();
    expect(screen.getByTestId('input-initial-balance')).toBeInTheDocument();
    expect(screen.getByTestId('input-account-number')).toBeInTheDocument();
    expect(screen.getByTestId('input-is-default-account')).toBeInTheDocument();
    expect(screen.getByTestId('account-preview-card')).toBeInTheDocument();
  });

  it('selects account type and toggles default account badge in live preview', () => {
    render(
      <CreateAccountModal
        open={true}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );

    // Click Credit Card option
    const creditCardBtn = screen.getByTestId('account-type-option-CREDIT_CARD');
    fireEvent.click(creditCardBtn);
    expect(creditCardBtn).toHaveClass('border-brand-ring');

    // Type account name
    const nameInput = screen.getByTestId('input-account-name');
    fireEvent.change(nameInput, { target: { value: 'Corporate Amex Gold' } });

    // Check Default checkbox
    const defaultCheckbox = screen.getByTestId('input-is-default-account');
    fireEvent.click(defaultCheckbox);

    // Check preview card reflects default status and name
    expect(screen.getByTestId('account-preview-card')).toHaveTextContent('Corporate Amex Gold');
    expect(screen.getByTestId('account-preview-card')).toHaveTextContent('Default');
  });

  it('submits valid finance account payload', async () => {
    const handleSubmit = vi.fn().mockResolvedValue(undefined);
    const handleClose = vi.fn();

    render(
      <CreateAccountModal
        open={true}
        onClose={handleClose}
        onSubmit={handleSubmit}
      />,
    );

    fireEvent.change(screen.getByTestId('input-account-name'), {
      target: { value: 'Mercury Treasury Reserve' },
    });
    fireEvent.change(screen.getByTestId('input-initial-balance'), {
      target: { value: '50000.00' },
    });
    fireEvent.change(screen.getByTestId('input-account-number'), {
      target: { value: '9876543210' },
    });

    const submitBtn = screen.getByTestId('btn-submit-account');
    await act(async () => {
      fireEvent.click(submitBtn);
    });

    expect(handleSubmit).toHaveBeenCalledWith({
      name: 'Mercury Treasury Reserve',
      accountType: 'BANK',
      // A new account starts in the base currency, not dollars.
      currency: 'AED',
      balance: 50000,
      accountNumber: '9876543210',
      isDefault: false,
    });
    expect(handleClose).toHaveBeenCalledTimes(1);
  });

  it('displays error if account name is blank', async () => {
    const handleSubmit = vi.fn();
    render(
      <CreateAccountModal
        open={true}
        onClose={vi.fn()}
        onSubmit={handleSubmit}
      />,
    );

    fireEvent.change(screen.getByTestId('input-account-name'), { target: { value: '   ' } });

    const submitBtn = screen.getByTestId('btn-submit-account');
    await act(async () => {
      fireEvent.click(submitBtn);
    });

    expect(screen.getByTestId('account-form-error')).toHaveTextContent('Please provide a name');
    expect(handleSubmit).not.toHaveBeenCalled();
  });
});

// ==========================================
// 4. TransferFundsModal Tests
// ==========================================
describe('TransferFundsModal Component', () => {
  it('renders source and destination account selectors and balance info', () => {
    render(
      <TransferFundsModal
        open={true}
        onClose={vi.fn()}
        accounts={mockAccounts}
        onSubmit={vi.fn()}
      />,
    );

    expect(screen.getByTestId('transfer-funds-form')).toBeInTheDocument();
    expect(screen.getByTestId('select-from-account')).toBeInTheDocument();
    expect(screen.getByTestId('select-to-account')).toBeInTheDocument();
    expect(screen.getByTestId('from-account-balance')).toHaveTextContent('$145,000.50');
    expect(screen.getByTestId('to-account-balance')).toHaveTextContent('$2,400.00');
  });

  it('calculates amount via quick percentage buttons', () => {
    render(
      <TransferFundsModal
        open={true}
        onClose={vi.fn()}
        accounts={mockAccounts}
        onSubmit={vi.fn()}
      />,
    );

    // From Account has $145000.50. Click 50%
    const quick50Btn = screen.getByTestId('quick-amount-50');
    fireEvent.click(quick50Btn);

    const amountInput = screen.getByTestId('input-transfer-amount');
    expect(amountInput).toHaveValue(72500.25);
  });

  it('renders double-entry journal preview with balanced debit and credit entries', () => {
    render(
      <TransferFundsModal
        open={true}
        onClose={vi.fn()}
        accounts={mockAccounts}
        onSubmit={vi.fn()}
      />,
    );

    const amountInput = screen.getByTestId('input-transfer-amount');
    fireEvent.change(amountInput, { target: { value: '5000' } });

    expect(screen.getByTestId('journal-preview-card')).toBeInTheDocument();
    expect(screen.getByTestId('journal-balanced-badge')).toHaveTextContent('Balanced Entry');

    // Debit row (Destination Petty Cash +$5000)
    const debitRow = screen.getByTestId('journal-debit-row');
    expect(debitRow).toHaveTextContent('Petty Cash Office');
    expect(debitRow).toHaveTextContent('$5,000.00');

    // Credit row (Source SVB -$5000)
    const creditRow = screen.getByTestId('journal-credit-row');
    expect(creditRow).toHaveTextContent('SVB Operating Checking');
    expect(creditRow).toHaveTextContent('$5,000.00');

    // Projected balances
    const postPreview = screen.getByTestId('post-transfer-preview');
    expect(postPreview).toHaveTextContent('$140,000.50');
    expect(postPreview).toHaveTextContent('$7,400.00');
  });

  it('warns when source and destination accounts are the same', () => {
    render(
      <TransferFundsModal
        open={true}
        onClose={vi.fn()}
        accounts={mockAccounts}
        onSubmit={vi.fn()}
      />,
    );

    const toSelect = screen.getByTestId('select-to-account');
    fireEvent.change(toSelect, { target: { value: 'acc-1' } }); // same as from acc-1

    expect(screen.getByTestId('same-account-warning')).toBeInTheDocument();
    expect(screen.getByTestId('btn-submit-transfer')).toBeDisabled();
  });

  it('submits valid transfer payload', async () => {
    const handleSubmit = vi.fn().mockResolvedValue(undefined);
    const handleClose = vi.fn();

    render(
      <TransferFundsModal
        open={true}
        onClose={handleClose}
        accounts={mockAccounts}
        onSubmit={handleSubmit}
      />,
    );

    fireEvent.change(screen.getByTestId('input-transfer-amount'), {
      target: { value: '10000' },
    });
    fireEvent.change(screen.getByTestId('input-transfer-description'), {
      target: { value: 'Monthly petty cash replenishment' },
    });

    const submitBtn = screen.getByTestId('btn-submit-transfer');
    await act(async () => {
      fireEvent.click(submitBtn);
    });

    expect(handleSubmit).toHaveBeenCalledWith({
      fromAccountId: 'acc-1',
      toAccountId: 'acc-2',
      amount: 10000,
      description: 'Monthly petty cash replenishment',
    });
    expect(handleClose).toHaveBeenCalledTimes(1);
  });
});

// ==========================================
// 5. SubscriptionsTable Tests
// ==========================================
describe('SubscriptionsTable Component', () => {
  it('renders summary KPI strip and recurring rows', () => {
    render(
      <SubscriptionsTable
        subscriptions={mockSubscriptions}
        accounts={mockAccounts}
      />,
    );

    expect(screen.getByTestId('subscriptions-container')).toBeInTheDocument();
    expect(screen.getByTestId('subscriptions-table')).toBeInTheDocument();

    // No supplier currency, so both are in base (AED): 1,200 a month + 2,400 a year = 1,400 a month.
    expect(screen.getByTestId('kpi-monthly-burn')).toHaveTextContent('AED 1,400.00');
    expect(screen.getByTestId('kpi-active-count')).toHaveTextContent('2');

    // Rows
    expect(screen.getByTestId('subscription-row-sub-1')).toBeInTheDocument();
    expect(screen.getByTestId('sub-vendor-sub-1')).toHaveTextContent('AWS Cloud Infrastructure');
    expect(screen.getByTestId('sub-amount-sub-1')).toHaveTextContent('AED 1,200.00');

    // Annual sub row normalized
    expect(screen.getByTestId('sub-vendor-sub-2')).toHaveTextContent('GitHub Enterprise');
    expect(screen.getByText(/^~AED.200\.00\/mo$/)).toBeInTheDocument();
  });

  it('keeps a schedule billed in another currency out of the base-currency monthly cost', () => {
    const inDollars = mockSubscriptions.map((s, i) => (i === 0 ? { ...s, currency: 'USD' } : s));
    render(<SubscriptionsTable subscriptions={inDollars} accounts={mockAccounts} />);
    // Only GitHub (2,400 a year) is in AED; AWS's 1,200 a month is in dollars and listed apart.
    expect(screen.getByTestId('kpi-monthly-burn')).toHaveTextContent('AED 200.00');
    expect(screen.getByText(/Not in this total/)).toHaveTextContent('$1,200.00');
    expect(screen.getByTestId('sub-amount-' + inDollars[0].id)).toHaveTextContent('$1,200.00');
  });

  it('filters subscriptions by search input', () => {
    render(
      <SubscriptionsTable
        subscriptions={mockSubscriptions}
        accounts={mockAccounts}
      />,
    );

    const searchInput = screen.getByTestId('input-search-subscriptions');
    fireEvent.change(searchInput, { target: { value: 'Figma' } });

    expect(screen.getByTestId('sub-vendor-sub-3')).toHaveTextContent('Figma Design Team');
    expect(screen.queryByTestId('sub-vendor-sub-1')).toBeNull();
    expect(screen.queryByTestId('sub-vendor-sub-2')).toBeNull();
  });

  it('filters subscriptions by status tabs', () => {
    render(
      <SubscriptionsTable
        subscriptions={mockSubscriptions}
        accounts={mockAccounts}
      />,
    );

    const pausedTab = screen.getByTestId('status-tab-paused');
    fireEvent.click(pausedTab);

    expect(screen.getByTestId('sub-vendor-sub-3')).toHaveTextContent('Figma Design Team');
    expect(screen.queryByTestId('sub-vendor-sub-1')).toBeNull();
  });

  it('handles quick pause/resume status toggle action', async () => {
    const handleToggle = vi.fn().mockResolvedValue(undefined);
    render(
      <SubscriptionsTable
        subscriptions={mockSubscriptions}
        accounts={mockAccounts}
        onToggleStatus={handleToggle}
      />,
    );

    // sub-1 is ACTIVE -> clicking toggle should trigger PAUSED
    const toggleBtn = screen.getByTestId('btn-toggle-status-sub-1');
    await act(async () => {
      fireEvent.click(toggleBtn);
    });

    expect(handleToggle).toHaveBeenCalledWith(mockSubscriptions[0], 'PAUSED');
  });

  it('renders loading skeleton and empty state', () => {
    const { rerender } = render(<SubscriptionsTable isLoading={true} />);
    expect(screen.getByTestId('subscriptions-loading-skeleton')).toBeInTheDocument();

    const handleNew = vi.fn();
    rerender(<SubscriptionsTable subscriptions={[]} onNewSubscription={handleNew} />);
    expect(screen.getByTestId('subscriptions-empty-state')).toBeInTheDocument();

    const addBtn = screen.getByTestId('btn-empty-new-subscription');
    fireEvent.click(addBtn);
    expect(handleNew).toHaveBeenCalledTimes(1);
  });
});

// ==========================================
// 6. SubscriptionFormModal Tests
// ==========================================
describe('SubscriptionFormModal Component', () => {
  it('renders the fields, and the no-supplier warning', () => {
    render(<SubscriptionFormModal open={true} onClose={vi.fn()} onSubmit={vi.fn()} />);

    expect(screen.getByTestId('subscription-form')).toBeInTheDocument();
    expect(screen.getByTestId('select-sub-supplier')).toBeInTheDocument();
    expect(screen.getByTestId('input-sub-name')).toBeInTheDocument();
    expect(screen.getByTestId('input-sub-amount')).toBeInTheDocument();
    expect(screen.getByTestId('select-sub-interval')).toBeInTheDocument();
    expect(screen.getByTestId('no-supplier-note')).toBeInTheDocument();
  });

  it('offers all four intervals and shows the monthly equivalent', () => {
    render(<SubscriptionFormModal open={true} onClose={vi.fn()} onSubmit={vi.fn()} />);

    const interval = screen.getByTestId('select-sub-interval') as HTMLSelectElement;
    expect(Array.from(interval.options).map((o) => o.value)).toEqual([
      'MONTHLY',
      'QUARTERLY',
      'SEMI_ANNUAL',
      'ANNUAL',
    ]);

    fireEvent.change(screen.getByTestId('input-sub-amount'), { target: { value: '30000' } });
    fireEvent.change(interval, { target: { value: 'QUARTERLY' } });

    expect(screen.getByTestId('monthly-equivalent')).toHaveTextContent('10,000');
    expect(screen.getByTestId('check-sub-spread')).toBeInTheDocument();
  });

  it('submits a transformed payload', async () => {
    const handleSubmit = vi.fn().mockResolvedValue(undefined);
    const handleClose = vi.fn();
    render(<SubscriptionFormModal open={true} onClose={handleClose} onSubmit={handleSubmit} />);

    fireEvent.change(screen.getByTestId('input-sub-name'), { target: { value: 'Office rent' } });
    fireEvent.change(screen.getByTestId('input-sub-amount'), { target: { value: '30000' } });
    fireEvent.change(screen.getByTestId('select-sub-interval'), { target: { value: 'QUARTERLY' } });

    await act(async () => {
      fireEvent.click(screen.getByTestId('btn-submit-subscription'));
    });

    await waitFor(() => expect(handleSubmit).toHaveBeenCalledTimes(1));
    expect(handleSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        vendorName: 'Office rent',
        amount: 30000,
        billingInterval: 'QUARTERLY',
        supplierId: null,
        endDate: null,
        autoApprove: false,
        spreadOverPeriod: true,
      }),
    );
    expect(handleClose).toHaveBeenCalledTimes(1);
  });

  it('shows a validation error and does not submit without a name', async () => {
    const handleSubmit = vi.fn();
    render(<SubscriptionFormModal open={true} onClose={vi.fn()} onSubmit={handleSubmit} />);

    fireEvent.change(screen.getByTestId('input-sub-amount'), { target: { value: '100' } });
    await act(async () => {
      fireEvent.click(screen.getByTestId('btn-submit-subscription'));
    });

    expect(await screen.findByText('Name the vendor')).toBeInTheDocument();
    expect(handleSubmit).not.toHaveBeenCalled();
  });

  it('locks the interval and start date once bills exist', () => {
    render(
      <SubscriptionFormModal
        open={true}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        existing={mockSubscriptions[0]}
        hasOccurrences
      />,
    );

    expect(screen.getByTestId('select-sub-interval')).toBeDisabled();
    expect(screen.getByTestId('input-sub-start')).toBeDisabled();
  });

  it('disables auto-approve without bill:approve', () => {
    canApprove = false;
    render(<SubscriptionFormModal open={true} onClose={vi.fn()} onSubmit={vi.fn()} />);
    expect(screen.getByTestId('check-sub-auto-approve')).toBeDisabled();
  });

  it('locks money fields on an auto-approving schedule without bill:approve', () => {
    canApprove = false;
    render(
      <SubscriptionFormModal
        open={true}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        existing={{ ...mockSubscriptions[0], autoApprove: true }}
      />,
    );
    expect(screen.getByTestId('sensitive-locked-note')).toBeInTheDocument();
    expect(screen.getByTestId('input-sub-amount')).toBeDisabled();
    expect(screen.getByTestId('input-sub-name')).not.toBeDisabled();
  });
});

describe('SubscriptionsTable badges and history', () => {
  it('flags a missing supplier, a failed run and an ended schedule', () => {
    const rows: RecurringExpenseDto[] = [
      { ...mockSubscriptions[0], id: 'a', supplierId: null, supplierName: null },
      { ...mockSubscriptions[0], id: 'b', lastOccurrenceStatus: 'FAILED' },
      { ...mockSubscriptions[0], id: 'c', endDate: '2026-08-25', nextBillingDate: '2026-08-25' },
    ];
    render(<SubscriptionsTable subscriptions={rows} />);

    expect(screen.getByTestId('sub-badge-supplier-a')).toHaveTextContent('Link a supplier');
    expect(screen.getByTestId('sub-badge-failed-b')).toHaveTextContent('Failed');
    expect(screen.getByTestId('sub-badge-ended-c')).toHaveTextContent('Ended');
    expect(screen.queryByTestId('sub-badge-supplier-b')).toBeNull();
  });

  it('shows the interval and expands to the bills it created', () => {
    const rows: RecurringExpenseDto[] = [{ ...mockSubscriptions[0], billingInterval: 'QUARTERLY' }];
    render(<SubscriptionsTable subscriptions={rows} />);

    expect(screen.getByTestId('sub-interval-sub-1')).toHaveTextContent('Quarterly');
    fireEvent.click(screen.getByTestId('btn-expand-sub-sub-1'));
    expect(screen.getByTestId('occurrence-occ-1')).toHaveTextContent('INV-9');
    expect(screen.getByRole('link', { name: 'INV-9' })).toHaveAttribute('href', '/purchasing/bills/bill-9');
  });
});
