import type { AutomationTriggerType } from '@saas/shared';

/**
 * The CRM events an automation can start from. `when` finishes the sentence
 * "It runs every time …" in the Activate confirmation.
 */
export const CRM_EVENTS = [
  { value: 'contact.created', label: 'Contact created', when: 'a contact is created' },
  { value: 'contact.updated', label: 'Contact updated', when: 'a contact is updated' },
  { value: 'quote.created', label: 'Quote created', when: 'a quote is created' },
  { value: 'quote.updated', label: 'Quote updated', when: 'a quote is updated' },
  { value: 'quote.accepted', label: 'Customer accepted a quote', when: 'a customer accepts a quote' },
  { value: 'invoice.issued', label: 'Invoice issued', when: 'an invoice is issued' },
  { value: 'invoice.overdue', label: 'Invoice overdue', when: 'an invoice goes overdue' },
] as const;

export type CrmEvent = (typeof CRM_EVENTS)[number];

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
