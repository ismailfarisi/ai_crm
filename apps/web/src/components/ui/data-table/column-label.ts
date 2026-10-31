import type { Column } from '@tanstack/react-table';

/** Field ids as people say them, where a plain split of the camelCase would read oddly. */
const KNOWN: Record<string, string> = {
  fullName: 'Name',
  companyName: 'Company',
  customerName: 'Customer',
  supplierName: 'Supplier',
  totalAmount: 'Total',
  invoiceNumber: 'Invoice',
  quoteNumber: 'Quote',
  orderNumber: 'Order',
  billNumber: 'Bill',
  employeeNumber: 'Employee no.',
  standardCost: 'Cost',
  listPrice: 'Price',
  dueDate: 'Due',
};

/** `createdAt` → "Created", `jobTitle` → "Job title", `payment_method` → "Payment method". */
export function humaniseColumnId(id: string): string {
  if (KNOWN[id]) return KNOWN[id];
  const words = id
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/ at$/, '');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * The name a column goes by outside its header cell: on a phone card and in
 * the Columns menu. Most headers are components (a sortable button), so the
 * text can't be read off them; `meta.label` names the column explicitly, and
 * the id is spelled out in words as a fallback rather than shown raw
 * ("CUSTOMERNAME", "TOTALAMOUNT" on every card).
 */
export function columnLabel<T>(column: Column<T, unknown>): string {
  const def = column.columnDef;
  const label = (def.meta as { label?: string } | undefined)?.label;
  if (label) return label;
  if (typeof def.header === 'string') return def.header;
  return humaniseColumnId(column.id);
}
