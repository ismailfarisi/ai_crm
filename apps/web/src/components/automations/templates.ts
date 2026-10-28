import type { AutomationEdge, AutomationNode, CreateAutomationWorkflowPayload } from '@saas/shared';

export type AutomationTemplateId = 'quote-accepted-notify' | 'invoice-overdue-reminder';

export interface AutomationTemplate {
  id: AutomationTemplateId;
  name: string;
  description: string;
  label: string;
  blurb: string;
}

export const AUTOMATION_TEMPLATES: AutomationTemplate[] = [
  {
    id: 'quote-accepted-notify',
    name: 'Notify the team when a quote is accepted',
    description: 'Emails your team the moment a customer accepts a quote.',
    label: 'CRM event',
    blurb: 'When a quote is accepted, emails your team who accepted it and for how much.',
  },
  {
    id: 'invoice-overdue-reminder',
    name: 'Remind customers about overdue invoices',
    description: 'Drafts a polite payment reminder with AI when an invoice goes overdue.',
    label: 'CRM event',
    blurb: 'When an invoice goes overdue, AI writes a short reminder and emails it.',
  },
];

/** What the overdue template does with the AI-written email, for the card text. */
export function overdueRecipientNote(aiEmailToCustomers: boolean): string {
  return aiEmailToCustomers
    ? 'Sends straight to the customer'
    : 'Drafts go to your team to review';
}

const X = 100;
const STEP = 150;

const node = (
  id: string,
  type: string,
  index: number,
  label: string,
  config: Record<string, unknown>,
): AutomationNode => ({ id, type, position: { x: X, y: 100 + index * STEP }, data: { label, config } }) as AutomationNode;

const chain = (ids: string[]): AutomationEdge[] =>
  ids.slice(1).map((target, i) => ({ id: `e-${ids[i]}-${target}`, source: ids[i], target }));

export function buildTemplateGraph(
  id: AutomationTemplateId,
  /** `teamEmail` is the signed-in user, a real inbox and an allowed recipient. */
  opts: { aiEmailToCustomers: boolean; teamEmail: string },
): CreateAutomationWorkflowPayload & {
  nodes: AutomationNode[];
  edges: AutomationEdge[];
  triggerConfig: Record<string, unknown>;
} {
  const meta = AUTOMATION_TEMPLATES.find((t) => t.id === id);
  if (!meta) throw new Error(`Unknown automation template: ${id}`);

  if (id === 'quote-accepted-notify') {
    return {
      name: meta.name,
      description: meta.description,
      triggerType: 'CRM_EVENT',
      triggerConfig: { event: 'quote.accepted' },
      nodes: [
        node('trigger-1', 'crmEventTrigger', 0, 'Quote accepted', { event: 'quote.accepted' }),
        node('email-1', 'sendEmailNode', 1, 'Email the team', {
          to: opts.teamEmail,
          subject: 'Quote {{ $trigger.payload.quoteNumber }} accepted',
          body:
            '{{ $trigger.payload.acceptedByName }} accepted quote {{ $trigger.payload.quoteNumber }} ' +
            'for {{ $trigger.payload.totalAmount }}.\n\nCustomer: {{ $trigger.payload.customerEmail }}',
        }),
      ],
      edges: chain(['trigger-1', 'email-1']),
    };
  }

  const prompt =
    'Write a short, polite plain-text payment reminder email to a customer about an overdue invoice. ' +
    'Use only these details: invoice number {{ $trigger.payload.invoiceNumber }}, ' +
    'amount {{ $trigger.payload.amount }}, amount paid so far {{ $trigger.payload.paidAmount }}, ' +
    'due date {{ $trigger.payload.dueDate }}. ' +
    'Do not include a subject line, placeholders or any detail not listed here. Do not invent anything.';

  return {
    name: meta.name,
    description: meta.description,
    triggerType: 'CRM_EVENT',
    triggerConfig: { event: 'invoice.overdue' },
    nodes: [
      node('trigger-1', 'crmEventTrigger', 0, 'Invoice overdue', { event: 'invoice.overdue' }),
      node('ai-1', 'aiPromptNode', 1, 'Write reminder', { prompt }),
      node('email-1', 'sendEmailNode', 2, 'Send reminder', {
        to: opts.aiEmailToCustomers ? '{{ $trigger.payload.customerEmail }}' : opts.teamEmail,
        subject: 'Payment reminder: invoice {{ $trigger.payload.invoiceNumber }}',
        body: opts.aiEmailToCustomers
          ? '{{ $json.text }}'
          : 'Draft for {{ $trigger.payload.customerEmail }}:\n\n{{ $json.text }}',
      }),
    ],
    edges: chain(['trigger-1', 'ai-1', 'email-1']),
  };
}
