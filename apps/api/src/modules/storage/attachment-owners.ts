import type { EntityTarget, ObjectLiteral } from 'typeorm';
import {
  PERMISSIONS,
  type AttachmentOwnerType,
  type Permission,
} from '@saas/shared';
import { ExpenseClaim } from '../finance/entities/expense-claim.entity';
import { SupplierBill } from '../payables/entities/supplier-bill.entity';
import { PurchaseOrder } from '../purchasing/entities/purchase-order.entity';
import { Invoice } from '../quotes/entities/invoice.entity';
import { Quote } from '../quotes/entities/quote.entity';

/**
 * What an attachment can hang off, and whose permissions it borrows.
 *
 * `read` gates listing and downloading; `write` gates uploading and removing.
 * Both are the owner record's own permissions, so an attachment is never more
 * or less visible than the document it belongs to. Adding an owner type is one
 * entry here plus the string in `@saas/shared`.
 */
export const ATTACHMENT_OWNERS: Record<
  AttachmentOwnerType,
  {
    entity: EntityTarget<ObjectLiteral>;
    read: Permission;
    write: Permission;
    label: string;
  }
> = {
  QUOTE: {
    entity: Quote,
    read: PERMISSIONS.QUOTE_READ,
    write: PERMISSIONS.QUOTE_UPDATE,
    label: 'quote',
  },
  INVOICE: {
    entity: Invoice,
    read: PERMISSIONS.INVOICE_READ,
    write: PERMISSIONS.INVOICE_MANAGE,
    label: 'invoice',
  },
  PURCHASE_ORDER: {
    entity: PurchaseOrder,
    read: PERMISSIONS.PURCHASE_ORDER_READ,
    write: PERMISSIONS.PURCHASE_ORDER_UPDATE,
    label: 'purchase order',
  },
  BILL: {
    entity: SupplierBill,
    read: PERMISSIONS.BILL_READ,
    write: PERMISSIONS.BILL_UPDATE,
    label: 'bill',
  },
  EXPENSE_CLAIM: {
    entity: ExpenseClaim,
    read: PERMISSIONS.FINANCE_READ,
    write: PERMISSIONS.FINANCE_MANAGE,
    label: 'expense claim',
  },
};
