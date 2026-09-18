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
import { StockItem } from '../inventory/entities/stock-item.entity';
import { User } from '../users/entities/user.entity';
import { Role } from '../rbac/entities/role.entity';

/**
 * The one file to touch when a sprint adds a document type worth auditing.
 *
 * Maps the first segment of a route to the entity behind it. The interceptor
 * uses it to photograph a record either side of a write, so `before` and
 * `after` come from the database rather than from whatever the handler chose
 * to return. A route whose segment is absent here is still audited — it just
 * records the action without the two snapshots.
 */
export const AUDIT_SUBJECTS: Record<
  string,
  { subject: string; entity: EntityTarget<ObjectLiteral> }
> = {
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
  'expense-claims': { subject: 'EXPENSE_CLAIM', entity: ExpenseClaim },
  users: { subject: 'USER', entity: User },
  roles: { subject: 'ROLE', entity: Role },
  'stock-items': { subject: 'STOCK_ITEM', entity: StockItem },
  'finance-accounts': { subject: 'FINANCE_ACCOUNT', entity: FinanceAccount },
};

/**
 * Routes whose bodies are credentials, or whose traffic would bury everything
 * else. Their actions are still recorded — `auth.login` is worth having — but
 * never their request or response bodies.
 */
export const AUDIT_BODYLESS_PREFIXES = ['auth', 'ai', 'channels'];

/** Not recorded at all: reads dressed as writes, and the audit trail itself. */
export const AUDIT_SKIPPED_PREFIXES = ['audit', 'health', 'notifications'];

/** The subject an unmapped segment gets: the segment itself, singularised. */
export function subjectForSegment(segment: string): string {
  const mapped = AUDIT_SUBJECTS[segment];
  if (mapped) return mapped.subject;
  return segment.replace(/s$/, '').replace(/-/g, '_').toUpperCase();
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
