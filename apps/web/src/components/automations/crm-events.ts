import { SHOP_EVENTS, type AutomationTriggerType, type ShopEventGroup } from '@saas/shared';

export type CrmEventSample = Record<string, string | number | boolean | null>;

export interface CrmEvent {
  value: string;
  label: string;
  /** Finishes the sentence "It runs every time …" in the Activate confirmation. */
  when: string;
  /** The heading the event sits under in the picker. */
  group: ShopEventGroup;
  /** A realistic payload: the test run sends it and the field list is read from it. */
  sample: CrmEventSample;
}

const sampleCustomer = {
  customerId: '5b1f6f0e-3c0a-4f57-9d0e-2b9f6a1c7e11',
  customerName: 'Al Noor Bakery',
  customerEmail: 'orders@alnoorbakery.ae',
};

const sampleContact = {
  id: '6f5e4d3c-2b1a-4f0e-9d8c-7b6a5f4e3d2c',
  firstName: 'Fatima',
  lastName: 'Al Noor',
  email: 'fatima@alnoorbakery.ae',
  phone: '+971501234567',
  company: 'Al Noor Bakery',
};

const sampleQuote = {
  id: '8a4c2d6e-91b3-4e0a-b7f4-0c5d3e2a1f90',
  quoteNumber: 'Q-2026-0142',
  title: '5,000 printed cake boxes',
  ...sampleCustomer,
  totalAmount: 18375,
  currency: 'AED',
  status: 'APPROVED',
};

const sampleInvoice = {
  invoiceId: 'c3d1e5f7-2a4b-4c6d-9e8f-1a2b3c4d5e6f',
  invoiceNumber: 'INV-2026-0211',
  ...sampleCustomer,
  amount: 9187.5,
  paidAmount: 0,
  status: 'ISSUED',
  dueDate: '2026-11-27T00:00:00.000Z',
};

/** The events that predate the shop list; their payloads are the record itself. */
const RECORD_EVENTS: CrmEvent[] = [
  { value: 'contact.created', label: 'Contact created', when: 'a contact is created', group: 'Contacts', sample: sampleContact },
  { value: 'contact.updated', label: 'Contact updated', when: 'a contact is updated', group: 'Contacts', sample: sampleContact },
  { value: 'quote.created', label: 'Quote created', when: 'a quote is created', group: 'Quotes', sample: { ...sampleQuote, status: 'DRAFT' } },
  { value: 'quote.updated', label: 'Quote updated', when: 'a quote is updated', group: 'Quotes', sample: sampleQuote },
  { value: 'quote.accepted', label: 'Customer accepted a quote', when: 'a customer accepts a quote', group: 'Quotes', sample: sampleQuote },
  { value: 'invoice.issued', label: 'Invoice issued', when: 'an invoice is issued', group: 'Invoices and payments', sample: sampleInvoice },
  { value: 'invoice.overdue', label: 'Invoice overdue', when: 'an invoice goes overdue', group: 'Invoices and payments', sample: sampleInvoice },
];

/**
 * Every event an automation can start from: the record events above, then
 * what a shop reacts to (`SHOP_EVENTS`, the list the API publishes from).
 */
export const CRM_EVENTS: readonly CrmEvent[] = [...RECORD_EVENTS, ...SHOP_EVENTS];

/** The headings of the event picker, in the order a job moves through the shop. */
export const CRM_EVENT_GROUPS: readonly ShopEventGroup[] = [
  'Quotes',
  'Artwork proofs',
  'Orders',
  'Production',
  'Invoices and payments',
  'Purchasing and stock',
  'Expenses',
  'Customer messages',
  'Contacts',
];

/**
 * What a run started by this event receives: the test run sends it as is, so
 * `$trigger.payload.<field>` reads the same in a test as in a real run.
 */
export function sampleTriggerFor(event: string | null | undefined): Record<string, unknown> | null {
  const known = findCrmEvent(event);
  if (!known) return null;
  const entityId =
    Object.entries(known.sample).find(([key]) => key === 'id' || key.endsWith('Id'))?.[1] ?? 'sample';
  return {
    eventType: known.value,
    entityId,
    timestamp: '2026-11-21T08:00:00.000Z',
    payload: known.sample,
  };
}


/**
 * The event a CRM trigger node listens for. The field is `event` (what the
 * API reads); nodes saved by older builds carry it as `eventType`, which is
 * still read so they keep showing what they listen for.
 */
export function crmEventOf(config: Record<string, unknown> | undefined | null): string | null {
  const value = config?.event ?? config?.eventType;
  return typeof value === 'string' && value ? value : null;
}

export function findCrmEvent(value: string | null | undefined): CrmEvent | undefined {
  return value ? CRM_EVENTS.find((ev) => ev.value === value) : undefined;
}

/** Moves a legacy `eventType` to `event`, so only one field is ever saved. */
export function normalizeCrmEventConfig<T extends Record<string, unknown>>(config: T): T {
  if (!('eventType' in config)) return config;
  const event = crmEventOf(config);
  const rest: Record<string, unknown> = { ...config };
  delete rest.eventType;
  return (event ? { ...rest, event } : rest) as unknown as T;
}

type NodeLike = { type?: string; data?: { config?: Record<string, unknown> } & Record<string, unknown> };

/** The same, across a graph: only CRM trigger nodes are touched. */
export function normalizeTriggerNodes<N extends NodeLike>(nodes: N[]): N[] {
  return nodes.map((node) => {
    const config = node.data?.config;
    if (node.type !== 'crmEventTrigger' || !config || !('eventType' in config)) return node;
    return { ...node, data: { ...node.data, config: normalizeCrmEventConfig(config) } };
  });
}

/** Finishes "It runs …" for the Activate confirmation. */
export function runsWhenPhrase(
  triggerType: AutomationTriggerType | undefined,
  event: string | null,
): string {
  switch (triggerType) {
    case 'CRM_EVENT': {
      const known = findCrmEvent(event);
      if (known) return `every time ${known.when}`;
      return event ? `every time the event "${event}" happens` : 'once you choose the CRM event that starts it';
    }
    case 'SCHEDULE':
      return 'on its schedule';
    case 'WEBHOOK':
      return 'every time its webhook address is called';
    case 'MANUAL':
    default:
      return 'when someone starts it';
  }
}
