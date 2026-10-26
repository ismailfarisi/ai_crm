import type { EntityTarget, ObjectLiteral } from 'typeorm';
import { Invoice } from '../quotes/entities/invoice.entity';
import { Quote } from '../quotes/entities/quote.entity';
import { PurchaseOrder } from '../purchasing/entities/purchase-order.entity';
import { SupplierBill } from '../payables/entities/supplier-bill.entity';
import { Supplier } from '../purchasing/entities/supplier.entity';
import { Customer } from '../customers/entities/customer.entity';
import { Contact } from '../contacts/entities/contact.entity';
import { SalesOrder } from '../orders/entities/sales-order.entity';
import { WorkOrder } from '../production/entities/work-order.entity';
import {
  CreditNote,
  DeliveryNote,
} from '../credits/entities/credit-note.entity';
import { ExpenseClaim } from '../finance/entities/expense-claim.entity';
import { FinanceAccount } from '../finance/entities/finance-account.entity';
import { RecurringExpense } from '../finance/entities/recurring-expense.entity';
import { PrepaidSchedule } from '../payables/entities/prepaid-schedule.entity';
import { StockItem } from '../inventory/entities/stock-item.entity';
import { User } from '../users/entities/user.entity';
import { Employee } from '../payroll/entities/employee.entity';
import { PayrollRun } from '../payroll/entities/payroll-run.entity';
import { PayrollSettings } from '../payroll/entities/payroll-settings.entity';
import { PensionScheme } from '../payroll/entities/pension-scheme.entity';
import { PensionRemittance } from '../payroll/entities/pension-remittance.entity';
import { LeaveLedgerEntry } from '../payroll/entities/leave-ledger-entry.entity';
import { Settlement } from '../payroll/entities/settlement.entity';
import { Role } from '../rbac/entities/role.entity';
import { TimesheetEntry } from '../job-costing/entities/timesheet-entry.entity';
import { Branch } from '../organizations/entities/branch.entity';
import { VatSettings } from '../tax/entities/vat-settings.entity';
import { JournalEntry } from '../finance/entities/journal-entry.entity';
import { LedgerAccount } from '../finance/entities/ledger-account.entity';
import { BankStatementLine } from '../finance/entities/bank-statement-line.entity';

/**
 * The one file to touch when a sprint adds a document type worth auditing.
 *
 * Maps the first segment of a route, or the first two for routes nested under
 * a module prefix such as /finance, to the entity behind it. The interceptor
 * uses it to photograph a record either side of a write, so `before` and
 * `after` come from the database rather than from whatever the handler chose
 * to return. A route whose segment is absent here is still audited — it just
 * records the action without the two snapshots.
 */
export interface AuditSubject {
  subject: string;
  entity: EntityTarget<ObjectLiteral>;
  /**
   * One row per tenant, written by a route with no id in it (`PUT
   * /finance/vat-settings`). The interceptor finds the tenant's row itself so
   * the change still gets its `before`.
   */
  singleton?: boolean;
}

export const AUDIT_SUBJECTS: Record<string, AuditSubject> = {
  quotes: { subject: 'QUOTE', entity: Quote },
  invoices: { subject: 'INVOICE', entity: Invoice },
  'purchase-orders': { subject: 'PURCHASE_ORDER', entity: PurchaseOrder },
  bills: { subject: 'BILL', entity: SupplierBill },
  suppliers: { subject: 'SUPPLIER', entity: Supplier },
  customers: { subject: 'CUSTOMER', entity: Customer },
  contacts: { subject: 'CONTACT', entity: Contact },
  'sales-orders': { subject: 'SALES_ORDER', entity: SalesOrder },
  'work-orders': { subject: 'WORK_ORDER', entity: WorkOrder },
  'credit-notes': { subject: 'CREDIT_NOTE', entity: CreditNote },
  'delivery-notes': { subject: 'DELIVERY_NOTE', entity: DeliveryNote },
  users: { subject: 'USER', entity: User },
  roles: { subject: 'ROLE', entity: Role },
  'stock-items': { subject: 'STOCK_ITEM', entity: StockItem },
  employees: { subject: 'EMPLOYEE', entity: Employee },
  'payroll-runs': { subject: 'PAYROLL_RUN', entity: PayrollRun },
  'payroll/opening-gratuity': { subject: 'PAYROLL', entity: PayrollRun },
  'payroll/opening-leave': { subject: 'PAYROLL', entity: LeaveLedgerEntry },
  'payroll/settings': { subject: 'PAYROLL_SETTINGS', entity: PayrollSettings },
  'payroll/pension-schemes': {
    subject: 'PENSION_SCHEME',
    entity: PensionScheme,
  },
  'payroll/pension': {
    subject: 'PENSION_REMITTANCE',
    entity: PensionRemittance,
  },
  settlements: { subject: 'SETTLEMENT', entity: Settlement },
  timesheets: { subject: 'TIMESHEET', entity: TimesheetEntry },
  branches: { subject: 'BRANCH', entity: Branch },
  'finance/expenses': { subject: 'EXPENSE_CLAIM', entity: ExpenseClaim },
  'finance/accounts': { subject: 'FINANCE_ACCOUNT', entity: FinanceAccount },
  'finance/subscriptions': {
    subject: 'RECURRING_EXPENSE',
    entity: RecurringExpense,
  },
  'finance/prepaid-schedules': {
    subject: 'PREPAID_SCHEDULE',
    entity: PrepaidSchedule,
  },
  'finance/vat-settings': {
    subject: 'VAT_SETTINGS',
    entity: VatSettings,
    singleton: true,
  },
  'finance/journal-entries': { subject: 'JOURNAL_ENTRY', entity: JournalEntry },
  'finance/ledger-accounts': {
    subject: 'LEDGER_ACCOUNT',
    entity: LedgerAccount,
  },
  'finance/bank-statement-lines': {
    subject: 'BANK_STATEMENT_LINE',
    entity: BankStatementLine,
  },
};

/**
 * Routes whose bodies are credentials, or whose traffic would bury everything
 * else. Their actions are still recorded — `auth.login` is worth having — but
 * never their request or response bodies.
 */
export const AUDIT_BODYLESS_PREFIXES = ['auth', 'ai', 'channels', 'assistant'];

/**
 * Request-body keys never written to the trail, at any depth. The fallback
 * `after` is the raw body, so a failed snapshot must not leak a plaintext
 * IBAN or password. Superset of `AUDIT_REDACTED_COLUMNS` (snapshots).
 */
export const AUDIT_REDACTED_BODY_KEYS = new Set(
  [
    'iban',
    'ibanEncrypted',
    'password',
    'passwordHash',
    'token',
    'accessToken',
    'refreshToken',
    'currentPassword',
    'newPassword',
  ].map((k) => k.toLowerCase()),
);

/** Copies `value` with every sensitive key replaced by '[redacted]'. */
export function redactBody(value: unknown, depth = 0): unknown {
  if (depth > 8 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => redactBody(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = AUDIT_REDACTED_BODY_KEYS.has(k.toLowerCase())
      ? '[redacted]'
      : redactBody(v, depth + 1);
  }
  return out;
}

/** Not recorded at all: reads dressed as writes, and the audit trail itself. */
export const AUDIT_SKIPPED_PREFIXES = ['audit', 'health', 'notifications'];

/** Resolves the audit key, mapping and record-id segment for a route. */
export function auditSubjectFor(segments: string[]): {
  key: string;
  mapped?: AuditSubject;
  idSegment: string | undefined;
} {
  const two = segments.length > 1 ? `${segments[0]}/${segments[1]}` : null;
  if (two && AUDIT_SUBJECTS[two]) {
    return { key: two, mapped: AUDIT_SUBJECTS[two], idSegment: segments[2] };
  }
  if (two && segments[0] === 'finance') {
    return { key: two, mapped: undefined, idSegment: segments[2] };
  }
  return {
    key: segments[0],
    mapped: AUDIT_SUBJECTS[segments[0]],
    idSegment: segments[1],
  };
}

/** The subject an unmapped segment gets: its last part, singularised. */
export function subjectForSegment(segment: string): string {
  const mapped = AUDIT_SUBJECTS[segment];
  if (mapped) return mapped.subject;
  const last = segment.split('/').pop()!;
  return last.replace(/s$/, '').replace(/-/g, '_').toUpperCase();
}

/**
 * Fields that name a record, best first.
 *
 * The trail used to read "Created by Daniel Whitfield", "Decision recorded
 * by…", "Status by…" with nothing saying *which* quote or invoice — so the
 * only way to tell one row from another was to open it. The snapshots the
 * interceptor already takes carry the document number; this picks it out.
 *
 * Ordered so a document number beats a human name: `QT-2026-0001` identifies
 * the record, "Rigid gift boxes" only describes it.
 */
const LABEL_FIELDS = [
  'quoteNumber',
  'invoiceNumber',
  'orderNumber',
  'poNumber',
  'billNumber',
  'claimNumber',
  'noteNumber',
  'workOrderNumber',
  'entryNumber',
  'number',
  'sku',
  'code',
  'name',
  'companyName',
  'fullName',
  'title',
  'email',
] as const;

/**
 * A short human label for the record a snapshot describes, or null.
 *
 * Truncated to fit `audit_logs.summary`, which is 200 characters.
 */
export function labelForRecord(
  snapshot: Record<string, unknown> | null | undefined,
): string | null {
  if (!snapshot) return null;

  for (const field of LABEL_FIELDS) {
    const value = snapshot[field];
    if (typeof value === 'string' && value.trim()) {
      return value.trim().slice(0, 200);
    }
  }
  return null;
}
