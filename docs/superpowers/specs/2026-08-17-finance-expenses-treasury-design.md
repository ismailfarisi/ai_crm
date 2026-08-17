# Design Specification: SME Finance, Expenses, Treasury & Cashflow Engine

## Overview
This specification defines the architecture, data models, user interface, and workflow engine for **Module 1 (Finance & Expenses)** of the SME ERP suite. The module provides a complete treasury and cashflow command center, multi-account bank management, employee expense claims with AI receipt OCR extraction, category budget burn meters, recurring SaaS subscription schedules, and automated double-entry accounting records orchestrated by **Temporal.io** and connected to the **Visual Automation Studio**.

---

## 1. User Interface & Frontend Architecture (`apps/web`)

### 1.1 Routes & Views
1. **Treasury & Cashflow Cockpit (`/finance`)**:
   - **Executive Stat Strip**: Total Available Liquidity, 30-Day Net Cashflow (+Inflows / -Outflows), Average Monthly Burn Rate, and Runway Months Calculator (*e.g., 8.2 months remaining*).
   - **Cashflow Inflow vs. Outflow Trend Chart**: Interactive visual monthly/weekly projection showing revenues from paid Invoices vs. disbursements from Expenses & Subscriptions.
   - **Multi-Account Balance Grid**: Bank Accounts (Checking, Savings), Petty Cash Vault, Credit Cards, and Stripe Clearing account cards with quick "Transfer Funds" action.

2. **Expense Claims Workspace (`/finance/expenses` & `/finance/expenses/[id]`)**:
   - **Claims Table**: Filterable list with status pills (`DRAFT`, `SUBMITTED`, `APPROVED`, `PAID`, `REJECTED`), submitting employee avatar, category tag, merchant, amount, and receipt preview thumbnail.
   - **Submit Expense Modal with AI Receipt OCR**:
     - Drag-and-drop receipt/bill image (JPEG/PNG/PDF).
     - AI OCR automatically scans image and pre-populates Merchant Name, Total Amount, Date, Tax, and Expense Category.
     - Manual line-item breakdown adjustments.
   - **Expense Detail View (`/finance/expenses/[id]`)**:
     - Side-by-side view with zoomable receipt image on the left and claim details on the right.
     - Odoo/Relay-style approval pipeline ribbon (`Draft` ➔ `Submitted` ➔ `Approved` ➔ `Paid`).
     - "Approve Claim", "Reject Claim (with reason)", and "Mark Reimbursed / Pay" action buttons.

3. **Department & Category Budgets (`/finance/budgets`)**:
   - Visual progress meter cards for each expense category (Marketing, Software, Travel, Office, Payroll).
   - Shows allocated budget, actual spend, remaining balance, and warning states when spend exceeds threshold (e.g., >85%).
   - "New Budget Cap" modal for configuring monthly/quarterly limits.

4. **Recurring SaaS & Vendor Subscriptions (`/finance/subscriptions`)**:
   - Calendar & table of recurring vendor commitments (AWS, GitHub, Office Lease, Google Workspace).
   - Renewal date alerts, billing cycle (Monthly/Annual), and payment source account.

---

## 2. Database Schema & Models (`apps/api`)

### 2.1 `FinanceAccount` Entity
```typescript
@Entity('finance_accounts')
export class FinanceAccount {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 100 })
  tenantId: string;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({ type: 'varchar', length: 50 })
  accountType: 'BANK' | 'CASH' | 'CREDIT_CARD' | 'CLEARING';

  @Column({ type: 'varchar', length: 10, default: 'USD' })
  currency: string;

  @Column({ type: 'decimal', precision: 14, scale: 2, default: 0 })
  balance: number;

  @Column({ type: 'varchar', length: 50, nullable: true })
  accountNumber?: string | null;

  @Column({ type: 'boolean', default: false })
  isDefault: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
```

### 2.2 `ExpenseClaim` Entity
```typescript
@Entity('expense_claims')
export class ExpenseClaim {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 100 })
  tenantId: string;

  @Column({ type: 'varchar', length: 50 })
  claimNumber: string;

  @Column({ type: 'uuid' })
  employeeId: string;

  @Column({ type: 'varchar', length: 255 })
  employeeName: string;

  @Column({ type: 'varchar', length: 100 })
  category: string; // TRAVEL, MEALS, SOFTWARE, OFFICE_SUPPLIES, MARKETING, OTHER

  @Column({ type: 'decimal', precision: 12, scale: 2 })
  amount: number;

  @Column({ type: 'varchar', length: 10, default: 'USD' })
  currency: string;

  @Column({ type: 'varchar', length: 50, default: 'DRAFT' })
  status: 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'PAID' | 'REJECTED';

  @Column({ type: 'varchar', length: 255, nullable: true })
  merchantName?: string | null;

  @Column({ type: 'date' })
  expenseDate: Date;

  @Column({ type: 'text', nullable: true })
  receiptUrl?: string | null;

  @Column({ type: 'text', nullable: true })
  rejectionReason?: string | null;

  @Column({ type: 'uuid', nullable: true })
  approvedById?: string | null;

  @Column({ type: 'timestamp with time zone', nullable: true })
  approvedAt?: Date | null;

  @Column({ type: 'timestamp with time zone', nullable: true })
  reimbursedAt?: Date | null;

  @Column({ type: 'varchar', length: 150, nullable: true })
  temporalWorkflowId?: string | null;

  @Column({ type: 'jsonb', default: [] })
  items: Array<{
    description: string;
    quantity: number;
    unitPrice: number;
    amount: number;
  }>;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
```

### 2.3 `CategoryBudget` Entity
```typescript
@Entity('category_budgets')
export class CategoryBudget {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 100 })
  tenantId: string;

  @Column({ type: 'varchar', length: 100 })
  category: string;

  @Column({ type: 'varchar', length: 50, default: 'MONTHLY' })
  period: 'MONTHLY' | 'QUARTERLY' | 'ANNUAL';

  @Column({ type: 'decimal', precision: 12, scale: 2 })
  budgetAmount: number;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  spentAmount: number;

  @Column({ type: 'int', default: 85 })
  alertThresholdPercent: number;

  @Column({ type: 'date' })
  startDate: Date;

  @Column({ type: 'date' })
  endDate: Date;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
```

### 2.4 `RecurringExpense` Entity
```typescript
@Entity('recurring_expenses')
export class RecurringExpense {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 100 })
  tenantId: string;

  @Column({ type: 'varchar', length: 255 })
  vendorName: string;

  @Column({ type: 'varchar', length: 100 })
  category: string;

  @Column({ type: 'decimal', precision: 12, scale: 2 })
  amount: number;

  @Column({ type: 'varchar', length: 50, default: 'MONTHLY' })
  billingInterval: 'MONTHLY' | 'ANNUAL';

  @Column({ type: 'date' })
  nextBillingDate: Date;

  @Column({ type: 'uuid', nullable: true })
  financeAccountId?: string | null;

  @Column({ type: 'varchar', length: 50, default: 'ACTIVE' })
  status: 'ACTIVE' | 'PAUSED' | 'CANCELLED';

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
```

### 2.5 `JournalEntry` Entity (Audit Ledger)
```typescript
@Entity('journal_entries')
export class JournalEntry {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 100 })
  tenantId: string;

  @Column({ type: 'varchar', length: 50 })
  entryNumber: string;

  @Column({ type: 'varchar', length: 50 })
  referenceType: 'EXPENSE' | 'INVOICE' | 'TRANSFER' | 'MANUAL';

  @Column({ type: 'varchar', length: 100 })
  referenceId: string;

  @Column({ type: 'date' })
  entryDate: Date;

  @Column({ type: 'jsonb', default: [] })
  lines: Array<{
    accountId?: string;
    accountName: string;
    debit: number;
    credit: number;
    description: string;
  }>;

  @Column({ type: 'decimal', precision: 14, scale: 2 })
  totalAmount: number;

  @CreateDateColumn()
  createdAt: Date;
}
```

---

## 3. Temporal Expense Lifecycle & AI Parsing

### 3.1 `expenseApprovalWorkflow` Flow
1. **Auto-Approval Check**: If claim amount is under auto-approve limit (e.g., < $50 for meals), auto-approves immediately.
2. **Approval Condition Wait**: If manual approval required, sets status to `SUBMITTED` and waits on `condition(() => isApproved || isRejected, '7 days')`.
3. **Approval Resolution**:
   - If approved via `approveExpenseSignal`:
     - Creates double-entry `JournalEntry` (Debit: Expense Category Account, Credit: Accounts Payable).
     - Emits `EXPENSE_APPROVED` to `AutomationEventBridgeService`.
     - Updates Category Budget `spentAmount`.
4. **Reimbursement / Payment**:
   - On `reimburseExpenseSignal`:
     - Deducts payment from specified `FinanceAccount.balance`.
     - Posts closing `JournalEntry` (Debit: Accounts Payable, Credit: Bank Account).
     - Updates status to `PAID`.

### 3.2 AI Receipt Scanner
- Endpoint `POST /api/finance/expenses/scan-receipt`:
  - Accepts image/PDF (base64 or URL).
  - Uses AI model prompt with JSON schema output:
    ```json
    {
      "merchantName": "Delta Air Lines",
      "expenseDate": "2026-08-16",
      "totalAmount": 420.50,
      "currency": "USD",
      "taxAmount": 38.20,
      "category": "TRAVEL",
      "items": [
        { "description": "Flight Ticket NYC - SFO", "quantity": 1, "unitPrice": 420.50, "amount": 420.50 }
      ]
    }
    ```

---

## 4. Automation Event Bridge Triggers
The module triggers visual workflows built in the **Automation Studio**:
- `EXPENSE_SUBMITTED`: Custom fraud or multi-level escalation checks.
- `EXPENSE_APPROVED`: Slack notifications or automatic accounting sync.
- `BUDGET_THRESHOLD_REACHED`: When category hits >85% spend, warns department heads.
- `CASH_RESERVE_DEFICIT`: When total cash balance drops below reserve target.

---

## 5. RBAC Permissions
- `FINANCE_READ`: View treasury dashboards, accounts, budgets, and expense claims.
- `FINANCE_MANAGE`: Create/edit bank accounts, transfer funds, manage budgets and recurring subscriptions.
- `EXPENSE_SUBMIT`: Submit personal expense claims and upload receipts.
- `EXPENSE_APPROVE`: Approve, reject, and authorize expense claim payouts.
