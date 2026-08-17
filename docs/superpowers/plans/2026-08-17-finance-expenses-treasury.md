# SME Finance, Expenses, Treasury & Cashflow Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a complete SME Finance & Expenses module including multi-bank treasury management, cashflow runway forecasting, employee expense claims with AI receipt OCR, category budget burn meters, recurring SaaS bill schedules, and double-entry accounting records orchestrated by Temporal.io and connected to the Automation Studio.

**Architecture:**
1. **Frontend (`apps/web`)**: Next.js 16 App Router views under `/finance` (Treasury Overview, Expenses with Receipt OCR, Budgets, Bank Accounts, Subscriptions) with responsive widgets, SVG cashflow charts, and approval ribbons.
2. **Backend (`apps/api`)**: NestJS `FinanceModule` managing `FinanceAccount`, `ExpenseClaim`, `CategoryBudget`, `RecurringExpense`, and `JournalEntry` PostgreSQL entities.
3. **Temporal Workflows**: `expenseApprovalWorkflow` handling claim submissions, manager approvals, auto-journaling, and payment disbursements.
4. **Automation Bridge**: Emits events to `AutomationEventBridgeService` for real-time visual automation triggers.

**Tech Stack:** Next.js 16, React 19, NestJS 11, TypeORM, PostgreSQL, `@temporalio/workflow`, `@temporalio/activity`, TypeScript, Vitest, Jest.

---

## Global Constraints
- Enforce tenant isolation on all database queries and endpoints using `@CurrentUser() user: AuthenticatedUser`.
- Follow the established warm/amber CRM theme and design system.
- Write unit tests first following strict TDD.

---

### Task 1: Shared RBAC Permissions, Finance & Expense Types

**Files:**
- Modify: `packages/shared/src/rbac/permissions.ts`
- Modify: `packages/shared/src/rbac/roles.ts`
- Create: `packages/shared/src/finance/types.ts`
- Create: `packages/shared/src/finance/types.test.ts`
- Modify: `packages/shared/src/index.ts`

**Interfaces:**
- Produces: `FINANCE_*` and `EXPENSE_*` permissions, `FinanceAccountDto`, `ExpenseClaimDto`, `CategoryBudgetDto`, `RecurringExpenseDto`, `JournalEntryDto`, `TreasuryOverviewDto`, `calculateRunwayMonths`.

- [ ] **Step 1: Write failing tests for finance types & calculations**

```typescript
// packages/shared/src/finance/types.test.ts
import { describe, it, expect } from 'vitest';
import {
  FINANCE_PERMISSIONS,
  calculateRunwayMonths,
  type FinanceAccountDto,
} from './types';

describe('Finance Types & Helpers', () => {
  it('defines required finance and expense permissions', () => {
    expect(FINANCE_PERMISSIONS.FINANCE_READ).toBe('finance:read');
    expect(FINANCE_PERMISSIONS.FINANCE_MANAGE).toBe('finance:manage');
    expect(FINANCE_PERMISSIONS.EXPENSE_SUBMIT).toBe('expense:submit');
    expect(FINANCE_PERMISSIONS.EXPENSE_APPROVE).toBe('expense:approve');
  });

  it('calculates runway months accurately', () => {
    const totalCash = 120000;
    const monthlyBurn = 15000;
    const runway = calculateRunwayMonths(totalCash, monthlyBurn);
    expect(runway).toBe(8);
  });

  it('handles zero or positive net burn gracefully', () => {
    expect(calculateRunwayMonths(100000, 0)).toBe(Infinity);
    expect(calculateRunwayMonths(100000, -5000)).toBe(Infinity);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @saas/shared test`
Expected: FAIL.

- [ ] **Step 3: Implement shared finance types and permissions**

```typescript
// packages/shared/src/rbac/permissions.ts
export const FINANCE_PERMISSIONS = {
  FINANCE_READ: 'finance:read',
  FINANCE_MANAGE: 'finance:manage',
  EXPENSE_SUBMIT: 'expense:submit',
  EXPENSE_APPROVE: 'expense:approve',
} as const;
```

```typescript
// packages/shared/src/finance/types.ts
export const FINANCE_PERMISSIONS = {
  FINANCE_READ: 'finance:read',
  FINANCE_MANAGE: 'finance:manage',
  EXPENSE_SUBMIT: 'expense:submit',
  EXPENSE_APPROVE: 'expense:approve',
} as const;

export type AccountType = 'BANK' | 'CASH' | 'CREDIT_CARD' | 'CLEARING';
export type ExpenseStatus = 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'PAID' | 'REJECTED';
export type BudgetPeriod = 'MONTHLY' | 'QUARTERLY' | 'ANNUAL';

export interface FinanceAccountDto {
  id: string;
  tenantId: string;
  name: string;
  accountType: AccountType;
  currency: string;
  balance: number;
  accountNumber?: string | null;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ExpenseItemDto {
  description: string;
  quantity: number;
  unitPrice: number;
  amount: number;
}

export interface ExpenseClaimDto {
  id: string;
  tenantId: string;
  claimNumber: string;
  employeeId: string;
  employeeName: string;
  category: string;
  amount: number;
  currency: string;
  status: ExpenseStatus;
  merchantName?: string | null;
  expenseDate: string;
  receiptUrl?: string | null;
  rejectionReason?: string | null;
  approvedById?: string | null;
  approvedAt?: string | null;
  reimbursedAt?: string | null;
  temporalWorkflowId?: string | null;
  items: ExpenseItemDto[];
  createdAt: string;
  updatedAt: string;
}

export interface CategoryBudgetDto {
  id: string;
  tenantId: string;
  category: string;
  period: BudgetPeriod;
  budgetAmount: number;
  spentAmount: number;
  alertThresholdPercent: number;
  startDate: string;
  endDate: string;
  createdAt: string;
  updatedAt: string;
}

export interface RecurringExpenseDto {
  id: string;
  tenantId: string;
  vendorName: string;
  category: string;
  amount: number;
  billingInterval: 'MONTHLY' | 'ANNUAL';
  nextBillingDate: string;
  financeAccountId?: string | null;
  status: 'ACTIVE' | 'PAUSED' | 'CANCELLED';
  createdAt: string;
  updatedAt: string;
}

export interface JournalLineDto {
  accountId?: string;
  accountName: string;
  debit: number;
  credit: number;
  description: string;
}

export interface JournalEntryDto {
  id: string;
  tenantId: string;
  entryNumber: string;
  referenceType: 'EXPENSE' | 'INVOICE' | 'TRANSFER' | 'MANUAL';
  referenceId: string;
  entryDate: string;
  lines: JournalLineDto[];
  totalAmount: number;
  createdAt: string;
}

export interface TreasuryOverviewDto {
  totalCash: number;
  currency: string;
  monthlyInflow: number;
  monthlyOutflow: number;
  netCashflow: number;
  monthlyBurnRate: number;
  runwayMonths: number;
  accounts: FinanceAccountDto[];
  recentCashflowSeries: Array<{
    date: string;
    inflow: number;
    outflow: number;
    net: number;
  }>;
}

export function calculateRunwayMonths(totalCash: number, monthlyBurnRate: number): number {
  if (monthlyBurnRate <= 0) return Infinity;
  return Math.round((totalCash / monthlyBurnRate) * 10) / 10;
}
```

- [ ] **Step 4: Export in `packages/shared/src/index.ts` and run tests**

Run: `pnpm --filter @saas/shared test`
Expected: PASS.

- [ ] **Step 5: Commit shared types**

```bash
git add packages/shared/
git commit -m "feat(shared): add finance, treasury, expense types, and RBAC permissions"
```

---

### Task 2: Backend Database Entities & TypeORM Migration

**Files:**
- Create: `apps/api/src/modules/finance/entities/finance-account.entity.ts`
- Create: `apps/api/src/modules/finance/entities/expense-claim.entity.ts`
- Create: `apps/api/src/modules/finance/entities/category-budget.entity.ts`
- Create: `apps/api/src/modules/finance/entities/recurring-expense.entity.ts`
- Create: `apps/api/src/modules/finance/entities/journal-entry.entity.ts`
- Create: `apps/api/src/database/migrations/1786060000000-CreateFinanceTables.ts`

**Interfaces:**
- Produces: TypeORM entities for all finance tables and database schema migration.

- [ ] **Step 1: Create TypeORM entities**

Create entities in `apps/api/src/modules/finance/entities/` matching the specification (`FinanceAccount`, `ExpenseClaim`, `CategoryBudget`, `RecurringExpense`, `JournalEntry`).

- [ ] **Step 2: Create Migration `1786060000000-CreateFinanceTables.ts`**

Generate tables: `finance_accounts`, `expense_claims`, `category_budgets`, `recurring_expenses`, and `journal_entries` with indices on `tenantId` and status fields.

- [ ] **Step 3: Verify build**

Run: `pnpm --filter api build`
Expected: PASS.

- [ ] **Step 4: Commit entities and migration**

```bash
git add apps/api/src/modules/finance/entities/ apps/api/src/database/migrations/
git commit -m "feat(api): add finance, expenses, budgets, and journal entities with migration"
```

---

### Task 3: Temporal Expense Approval Workflow & Activities

**Files:**
- Create: `apps/api/src/modules/finance/workflows/interfaces.ts`
- Create: `apps/api/src/modules/finance/workflows/expense-approval.workflow.ts`
- Create: `apps/api/src/modules/finance/workflows/activities/expense.activities.ts`
- Create: `apps/api/src/modules/finance/workflows/expense-approval.workflow.spec.ts`

**Interfaces:**
- Produces: `expenseApprovalWorkflow`, `approveExpenseSignal`, `rejectExpenseSignal`, `reimburseExpenseSignal`.

- [ ] **Step 1: Write failing tests for `expenseApprovalWorkflow`**

Verify auto-approval under threshold, manager approval signals, timeout routing, and reimbursement signals.

- [ ] **Step 2: Implement workflow interfaces & activities**

Implement `expenseApprovalWorkflow` with auto-posting of double-entry `JournalEntry` and emission of `EXPENSE_APPROVED` event.

- [ ] **Step 3: Run workflow tests**

Run: `pnpm --filter api test expense-approval.workflow.spec.ts`
Expected: PASS.

- [ ] **Step 4: Commit workflow engine**

```bash
git add apps/api/src/modules/finance/workflows/
git commit -m "feat(api): implement Temporal expense approval workflow and financial activities"
```

---

### Task 4: Finance & Expense Backend Services, Controllers, AI OCR & Tests

**Files:**
- Create: `apps/api/src/modules/finance/finance.service.ts`
- Create: `apps/api/src/modules/finance/expenses.service.ts`
- Create: `apps/api/src/modules/finance/finance.controller.ts`
- Create: `apps/api/src/modules/finance/expenses.controller.ts`
- Create: `apps/api/src/modules/finance/finance.module.ts`
- Create: `apps/api/src/modules/finance/finance.service.spec.ts`
- Create: `apps/api/src/modules/finance/expenses.service.spec.ts`
- Modify: `apps/api/src/app.module.ts`

**Interfaces:**
- Produces: REST endpoints for `/finance/overview`, `/finance/accounts`, `/finance/expenses`, `/finance/expenses/scan-receipt`, `/finance/budgets`, `/finance/subscriptions`.

- [ ] **Step 1: Write failing unit tests for `FinanceService` and `ExpensesService`**

- [ ] **Step 2: Implement `FinanceService`, `ExpensesService`, and AI OCR receipt parsing endpoint**

- [ ] **Step 3: Register `FinanceModule` in `app.module.ts`**

- [ ] **Step 4: Run all API tests**

Run: `pnpm --filter api test`
Expected: PASS.

- [ ] **Step 5: Commit finance backend module**

```bash
git add apps/api/src/modules/finance/ apps/api/src/app.module.ts
git commit -m "feat(api): implement finance and expenses services, AI OCR receipt scanner, and controllers"
```

---

### Task 5: Frontend Finance API Client & State Hooks

**Files:**
- Modify: `apps/web/src/lib/api/endpoints.ts`
- Create: `apps/web/src/hooks/use-finance.ts`
- Create: `apps/web/src/hooks/use-expenses.ts`
- Create: `apps/web/src/hooks/use-finance.spec.ts`

**Interfaces:**
- Produces: `api.finance`, `useFinanceOverview()`, `useFinanceAccounts()`, `useCategoryBudgets()`, `useRecurringExpenses()`, `useExpenses()`, `useExpense(id)`.

- [ ] **Step 1: Add API client endpoints for finance and expenses**

- [ ] **Step 2: Implement React Query state hooks**

- [ ] **Step 3: Write tests for hooks and run validation**

Run: `pnpm --filter web test` and `pnpm --filter web typecheck`
Expected: PASS.

- [ ] **Step 4: Commit frontend hooks**

```bash
git add apps/web/
git commit -m "feat(web): add finance & expense API endpoints and state hooks"
```

---

### Task 6: Treasury & Cashflow Dashboard Components

**Files:**
- Create: `apps/web/src/components/finance/dashboard/treasury-stat-cards.tsx`
- Create: `apps/web/src/components/finance/dashboard/cashflow-trend-chart.tsx`
- Create: `apps/web/src/components/finance/dashboard/account-balance-grid.tsx`
- Create: `apps/web/src/components/finance/dashboard/dashboard.spec.tsx`

**Interfaces:**
- Produces: Executive treasury cards (Total Cash, Inflows/Outflows, Burn Rate, Runway Months), SVG cashflow chart, and multi-bank balance cards with transfer action.

- [ ] **Step 1: Implement stat cards, SVG cashflow chart, and account cards**

- [ ] **Step 2: Write tests in `dashboard.spec.tsx` and verify**

Run: `pnpm --filter web test`
Expected: PASS.

- [ ] **Step 3: Commit dashboard components**

```bash
git add apps/web/src/components/finance/dashboard/
git commit -m "feat(web): add treasury stat cards, cashflow runway chart, and bank balance grid"
```

---

### Task 7: Expense Claims Components, Receipt Zoomer & AI OCR Scanner

**Files:**
- Create: `apps/web/src/components/finance/expenses/expense-claims-table.tsx`
- Create: `apps/web/src/components/finance/expenses/submit-expense-modal.tsx`
- Create: `apps/web/src/components/finance/expenses/receipt-preview-card.tsx`
- Create: `apps/web/src/components/finance/expenses/expense-status-ribbon.tsx`
- Create: `apps/web/src/components/finance/expenses/expenses.spec.tsx`

**Interfaces:**
- Produces: Claims data table, submission modal with AI receipt drag-and-drop, zoomable receipt image viewer, and status approval ribbon.

- [ ] **Step 1: Implement expense table, submit modal with AI scan, and receipt viewer**

- [ ] **Step 2: Write tests in `expenses.spec.tsx`**

Run: `pnpm --filter web test`
Expected: PASS.

- [ ] **Step 3: Commit expense components**

```bash
git add apps/web/src/components/finance/expenses/
git commit -m "feat(web): add expense claims table, AI receipt OCR scanner, and receipt previewer"
```

---

### Task 8: Category Budgets, Accounts & Subscriptions Components

**Files:**
- Create: `apps/web/src/components/finance/budgets/budget-meter-card.tsx`
- Create: `apps/web/src/components/finance/budgets/create-budget-modal.tsx`
- Create: `apps/web/src/components/finance/accounts/create-account-modal.tsx`
- Create: `apps/web/src/components/finance/accounts/transfer-funds-modal.tsx`
- Create: `apps/web/src/components/finance/subscriptions/subscriptions-table.tsx`
- Create: `apps/web/src/components/finance/budgets/budgets.spec.tsx`

**Interfaces:**
- Produces: Visual budget progress bars, create budget modal, bank transfer modal, and recurring subscriptions schedule.

- [ ] **Step 1: Implement budget meters, account creation/transfer modals, and subscriptions table**

- [ ] **Step 2: Write tests in `budgets.spec.tsx`**

Run: `pnpm --filter web test`
Expected: PASS.

- [ ] **Step 3: Commit budget & account components**

```bash
git add apps/web/src/components/finance/
git commit -m "feat(web): add category budget meters, account transfer modal, and subscriptions table"
```

---

### Task 9: Full Finance Routes, Navigation & E2E Verification

**Files:**
- Create: `apps/web/src/app/(app)/finance/page.tsx`
- Create: `apps/web/src/app/(app)/finance/expenses/page.tsx`
- Create: `apps/web/src/app/(app)/finance/expenses/[id]/page.tsx`
- Create: `apps/web/src/app/(app)/finance/budgets/page.tsx`
- Create: `apps/web/src/app/(app)/finance/accounts/page.tsx`
- Create: `apps/web/src/app/(app)/finance/subscriptions/page.tsx`
- Modify: `apps/web/src/components/layout/app-shell.tsx` (Add Finance nav link with `Wallet` or `Landmark` icon)

**Interfaces:**
- Produces: Complete `/finance` module in web app and navigation link.

- [ ] **Step 1: Build all `/finance/*` routes**

- [ ] **Step 2: Update `app-shell.tsx` navigation**

- [ ] **Step 3: Run full repository verification**

Run: `pnpm test` and `pnpm --filter web build`
Expected: ALL PASS.

- [ ] **Step 4: Commit and push**

```bash
git add .
git commit -m "feat(finance): add full finance routes, navigation, and verify all tests"
```
