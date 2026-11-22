import { CONTACT_SOURCES } from '@saas/shared';
import { CRM_EVENTS, findCrmEvent } from './crm-events';

/**
 * What each CRM event carries, in one place per event. The field list drives
 * the "Insert data" picker, the condition builder and the test run's sample,
 * so the three can never disagree about a field's name.
 *
 * Adding an event: add its entry to CRM_EVENTS. That is enough if the entry
 * carries a `sample` of its data: the field list is read off it. To choose
 * the wording, the order or a list of choices, give the entry a `fields`
 * array or add an entry to EVENT_FIELDS below. An event with none of these
 * falls back to the record its name starts with ("quote.sent" gets the quote
 * fields), so it is usable before anyone describes it.
 *
 * `key` is the name in the event's data, i.e. `$trigger.payload.<key>` at run
 * time. Keep it identical to what the API sends.
 */
export type EventFieldType = 'text' | 'number' | 'date' | 'choice';

export interface EventField {
  key: string;
  /** What a workshop owner would call it. */
  label: string;
  type: EventFieldType;
  /** A realistic value: shown beside the field and used by the test run. */
  sample: string | number;
  /** The values a `choice` field can hold. */
  options?: readonly string[];
}

/** The contact row (`snapshot.after`) sent by contact.created / contact.updated. */
const CONTACT_FIELDS: EventField[] = [
  { key: 'firstName', label: 'First name', type: 'text', sample: 'Aisha' },
  { key: 'lastName', label: 'Last name', type: 'text', sample: 'Rahman' },
  { key: 'email', label: 'Email', type: 'text', sample: 'aisha@gulfsigns.ae' },
  { key: 'phone', label: 'Phone', type: 'text', sample: '+971 50 123 4567' },
  { key: 'company', label: 'Company', type: 'text', sample: 'Gulf Signs LLC' },
  { key: 'jobTitle', label: 'Job title', type: 'text', sample: 'Purchasing Manager' },
  {
    key: 'status',
    label: 'Status',
    type: 'choice',
    sample: 'lead',
    options: ['lead', 'qualified', 'customer', 'churned', 'archived'],
  },
  {
    key: 'source',
    label: 'Where they came from',
    type: 'choice',
    sample: 'website',
    options: [...CONTACT_SOURCES],
  },
  { key: 'notes', label: 'Notes', type: 'text', sample: 'Asked about shopfront signage.' },
  { key: 'id', label: 'Contact ID', type: 'text', sample: '3f2a9c1e-5b7d-4e8a-9c21-7d5e4f3a2b10' },
];

/** The quote row (`snapshot.after`) sent by quote.created / quote.updated. */
const QUOTE_FIELDS: EventField[] = [
  { key: 'quoteNumber', label: 'Quote number', type: 'text', sample: 'Q-2026-0042' },
  { key: 'title', label: 'Quote title', type: 'text', sample: 'Shopfront signage, 3 panels' },
  { key: 'customerName', label: 'Customer name', type: 'text', sample: 'Gulf Signs LLC' },
  { key: 'customerEmail', label: 'Customer email', type: 'text', sample: 'aisha@gulfsigns.ae' },
  {
    key: 'status',
    label: 'Status',
    type: 'choice',
    sample: 'DRAFT',
    options: ['DRAFT', 'AWAITING_APPROVAL', 'APPROVED', 'REJECTED'],
  },
  { key: 'totalAmount', label: 'Quote total', type: 'number', sample: 18500 },
  { key: 'subtotalAmount', label: 'Subtotal', type: 'number', sample: 17619.05 },
  { key: 'discountAmount', label: 'Discount', type: 'number', sample: 0 },
  { key: 'taxAmount', label: 'VAT', type: 'number', sample: 880.95 },
  { key: 'currency', label: 'Currency', type: 'text', sample: 'AED' },
  { key: 'validUntil', label: 'Valid until', type: 'date', sample: '2026-12-15' },
  { key: 'paymentTerms', label: 'Payment terms', type: 'text', sample: 'net30' },
  { key: 'id', label: 'Quote ID', type: 'text', sample: '8c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f' },
  { key: 'customerId', label: 'Customer ID', type: 'text', sample: '3f2a9c1e-5b7d-4e8a-9c21-7d5e4f3a2b10' },
];

const INVOICE_FIELDS: EventField[] = [
  { key: 'invoiceNumber', label: 'Invoice number', type: 'text', sample: 'INV-2026-0117' },
  { key: 'amount', label: 'Invoice amount', type: 'number', sample: 9250 },
  { key: 'dueDate', label: 'Due date', type: 'date', sample: '2026-12-20' },
  { key: 'customerEmail', label: 'Customer email', type: 'text', sample: 'aisha@gulfsigns.ae' },
  { key: 'invoiceId', label: 'Invoice ID', type: 'text', sample: '5d6e7f80-1a2b-4c3d-9e4f-5a6b7c8d9e0f' },
  { key: 'customerId', label: 'Customer ID', type: 'text', sample: '3f2a9c1e-5b7d-4e8a-9c21-7d5e4f3a2b10' },
];

/** One entry per event. */
export const EVENT_FIELDS: Record<string, EventField[]> = {
  'contact.created': CONTACT_FIELDS,
  'contact.updated': CONTACT_FIELDS,
  'quote.created': QUOTE_FIELDS,
  'quote.updated': QUOTE_FIELDS,
  // quote-acceptance.service.ts afterAcceptance()
  'quote.accepted': [
    { key: 'quoteNumber', label: 'Quote number', type: 'text', sample: 'Q-2026-0042' },
    { key: 'totalAmount', label: 'Quote total', type: 'number', sample: 18500 },
    { key: 'acceptedByName', label: 'Accepted by', type: 'text', sample: 'Aisha Rahman' },
    { key: 'customerEmail', label: 'Customer email', type: 'text', sample: 'aisha@gulfsigns.ae' },
    { key: 'quoteId', label: 'Quote ID', type: 'text', sample: '8c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f' },
    { key: 'customerId', label: 'Customer ID', type: 'text', sample: '3f2a9c1e-5b7d-4e8a-9c21-7d5e4f3a2b10' },
  ],
  // orders.service.ts and quotes.service.ts, where the invoice is raised
  'invoice.issued': [
    { key: 'invoiceNumber', label: 'Invoice number', type: 'text', sample: 'INV-2026-0117' },
    { key: 'amount', label: 'Invoice amount', type: 'number', sample: 9250 },
    { key: 'dueDate', label: 'Due date', type: 'date', sample: '2026-12-20' },
    { key: 'stage', label: 'Payment stage', type: 'text', sample: 'Deposit (50%)' },
    { key: 'customerEmail', label: 'Customer email', type: 'text', sample: 'aisha@gulfsigns.ae' },
    { key: 'invoiceId', label: 'Invoice ID', type: 'text', sample: '5d6e7f80-1a2b-4c3d-9e4f-5a6b7c8d9e0f' },
    { key: 'quoteId', label: 'Quote ID', type: 'text', sample: '8c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f' },
    { key: 'salesOrderId', label: 'Order ID', type: 'text', sample: '1b2c3d4e-5f60-4a7b-8c9d-0e1f2a3b4c5d' },
    { key: 'customerId', label: 'Customer ID', type: 'text', sample: '3f2a9c1e-5b7d-4e8a-9c21-7d5e4f3a2b10' },
  ],
  // invoice-overdue.service.ts
  'invoice.overdue': [
    { key: 'invoiceNumber', label: 'Invoice number', type: 'text', sample: 'INV-2026-0117' },
    { key: 'amount', label: 'Invoice amount', type: 'number', sample: 9250 },
    { key: 'paidAmount', label: 'Amount paid so far', type: 'number', sample: 2500 },
    { key: 'dueDate', label: 'Due date', type: 'date', sample: '2026-11-05' },
    { key: 'customerEmail', label: 'Customer email', type: 'text', sample: 'aisha@gulfsigns.ae' },
    { key: 'invoiceId', label: 'Invoice ID', type: 'text', sample: '5d6e7f80-1a2b-4c3d-9e4f-5a6b7c8d9e0f' },
    { key: 'customerId', label: 'Customer ID', type: 'text', sample: '3f2a9c1e-5b7d-4e8a-9c21-7d5e4f3a2b10' },
  ],
};

/** Fallback for an event nobody has described yet: the record it is about. */
const RECORD_FIELDS: Record<string, EventField[]> = {
  contact: CONTACT_FIELDS,
  quote: QUOTE_FIELDS,
  invoice: INVOICE_FIELDS,
};

/** Words a field name is made of that do not read well when merely capitalised. */
const FIELD_WORDS: Record<string, string> = { id: 'ID', po: 'PO', qty: 'quantity', url: 'link', sku: 'SKU' };

/** "customerEmail" → "Customer email", "poNumber" → "PO number". */
export function fieldLabel(key: string): string {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[\s_.-]+/)
    .filter(Boolean)
    .map((w) => FIELD_WORDS[w.toLowerCase()] ?? w.toLowerCase());
  const text = words.join(' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}(T[\d:.]+(Z|[+-]\d{2}:?\d{2})?)?$/;

/**
 * The field list read off an example of the event's data, for an event that
 * is registered with a `sample` and nothing more: names come from the keys,
 * types from the values, and the ids go last because they are rarely wanted.
 */
export function fieldsFromSample(sample: Record<string, unknown>): EventField[] {
  const fields: EventField[] = [];
  for (const [key, value] of Object.entries(sample)) {
    if (typeof value === 'number') fields.push({ key, label: fieldLabel(key), type: 'number', sample: value });
    else if (typeof value === 'string')
      fields.push({ key, label: fieldLabel(key), type: ISO_DATE.test(value) ? 'date' : 'text', sample: value });
    else if (typeof value === 'boolean')
      fields.push({ key, label: fieldLabel(key), type: 'choice', sample: String(value), options: ['true', 'false'] });
  }
  const isId = (f: EventField) => f.key === 'id' || f.key.endsWith('Id');
  return [...fields.filter((f) => !isId(f)), ...fields.filter(isId)];
}

/** The fields an event carries; empty when nothing is known about it. */
export function eventFieldsFor(event: string | null | undefined): EventField[] {
  if (!event) return [];
  const known = findCrmEvent(event) as { fields?: EventField[]; sample?: Record<string, unknown> } | undefined;
  if (known?.fields?.length) return known.fields;
  if (EVENT_FIELDS[event]) return EVENT_FIELDS[event];
  const fromSample = known?.sample ? fieldsFromSample(known.sample) : [];
  if (fromSample.length > 0) return fromSample;
  return RECORD_FIELDS[event.split('.')[0]] ?? [];
}

/** The event's data with a realistic value for every field. */
export function sampleDataFor(event: string | null | undefined): Record<string, string | number> {
  return Object.fromEntries(eventFieldsFor(event).map((f) => [f.key, f.sample]));
}

/** Where a field's value lives at run time. */
export function triggerFieldExpression(key: string): string {
  return `$trigger.payload.${key}`;
}

const SAMPLE_TIMESTAMP = '2026-11-20T09:30:00.000Z';

/**
 * What a run receives as `$trigger` for this event: the same envelope the
 * event bridge builds, so a test run reads its data from the same places a
 * real run does.
 */
export function sampleTriggerFor(
  event: string | null | undefined,
  data: Record<string, unknown> = sampleDataFor(event),
): Record<string, unknown> {
  const entityId = data.id ?? data.quoteId ?? data.invoiceId ?? data.contactId ?? 'sample-record';
  return {
    eventType: event ?? 'manual.test',
    entityId,
    timestamp: SAMPLE_TIMESTAMP,
    payload: data,
  };
}

/** Every event the builder offers, for tests that guard the registry. */
export const KNOWN_EVENT_VALUES: string[] = CRM_EVENTS.map((ev) => ev.value);
