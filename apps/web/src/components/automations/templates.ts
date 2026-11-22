import type {
  AutomationEdge,
  AutomationNode,
  AutomationNotifyGroup,
  CreateAutomationWorkflowPayload,
} from '@saas/shared';

export type AutomationTemplateCategory =
  | 'Quotes'
  | 'Artwork'
  | 'Production'
  | 'Stock and purchasing'
  | 'Money'
  | 'Customers'
  | 'Every day';

/** The headings of the recipe gallery, in the order a job moves through the shop. */
export const AUTOMATION_TEMPLATE_CATEGORIES: readonly AutomationTemplateCategory[] = [
  'Quotes',
  'Artwork',
  'Production',
  'Stock and purchasing',
  'Money',
  'Customers',
  'Every day',
];

export interface AutomationTemplate {
  id: string;
  name: string;
  description: string;
  /** The badge on the card: what starts it. */
  label: string;
  blurb: string;
  category: AutomationTemplateCategory;
  /** Who hears from it, in a few words, shown under the blurb. */
  reaches: string;
}

export const AUTOMATION_TEMPLATES = [
  {
    id: 'quote-follow-up',
    name: 'Follow up a quote nobody answered',
    description: 'Emails the customer three days after a quote was sent, if they have not replied.',
    label: 'CRM event',
    blurb: 'Three days after you send a quote, checks it is still unanswered and emails the customer a short nudge.',
    category: 'Quotes',
    reaches: 'Emails the customer',
  },
  {
    id: 'quote-accepted-notify',
    name: 'Notify the team when a quote is accepted',
    description: 'Emails your team the moment a customer accepts a quote.',
    label: 'CRM event',
    blurb: 'When a quote is accepted, emails your team who accepted it and for how much.',
    category: 'Quotes',
    reaches: 'Emails you',
  },
  {
    id: 'quote-changes-requested',
    name: 'Tell sales when a customer wants changes',
    description: 'Alerts the people who write quotes when a customer asks for changes or declines.',
    label: 'CRM event',
    blurb: 'When a customer asks for changes to a quote, alerts sales in the app with what the customer wrote.',
    category: 'Quotes',
    reaches: 'Alerts sales in the app',
  },
  {
    id: 'proof-reminder',
    name: 'Remind the customer about a proof',
    description: 'Emails the customer two days after an artwork proof was sent, if it is still waiting on them.',
    label: 'CRM event',
    blurb: 'Two days after a proof goes out, checks it is still waiting and reminds the customer that the job cannot start without it.',
    category: 'Artwork',
    reaches: 'Emails the customer',
  },
  {
    id: 'proof-approved-production',
    name: 'Tell production the artwork is approved',
    description: 'Alerts production when a customer approves the artwork proof.',
    label: 'CRM event',
    blurb: 'When the customer approves the proof, alerts production that the artwork is final.',
    category: 'Artwork',
    reaches: 'Alerts production in the app',
  },
  {
    id: 'proof-changes-requested',
    name: 'Tell sales the proof needs changes',
    description: 'Alerts the people who write quotes when a customer asks for changes to the artwork proof.',
    label: 'CRM event',
    blurb: 'When the customer asks for changes to a proof, alerts sales with the customer’s comment.',
    category: 'Artwork',
    reaches: 'Alerts sales in the app',
  },
  {
    id: 'deposit-paid-start-job',
    name: 'Tell production the deposit is in',
    description: 'Alerts production when a deposit is paid, so the job can start.',
    label: 'CRM event',
    blurb: 'When a deposit is paid, online or recorded by hand, alerts production that the job can start.',
    category: 'Production',
    reaches: 'Alerts production in the app',
  },
  {
    id: 'materials-arrived',
    name: 'Tell production the materials arrived',
    description: 'Alerts production when a purchase order is fully received.',
    label: 'CRM event',
    blurb: 'When a purchase order is fully received, alerts production that the materials are in.',
    category: 'Production',
    reaches: 'Alerts production in the app',
  },
  {
    id: 'order-ready-customer',
    name: 'Tell the customer their order is ready',
    description: 'Emails the customer when every job on their order is finished.',
    label: 'CRM event',
    blurb: 'When the last job on an order is finished, emails the customer that it is ready.',
    category: 'Production',
    reaches: 'Emails the customer',
  },
  {
    id: 'stock-low-buyer',
    name: 'Alert the buyer when stock runs low',
    description: 'Alerts the people who raise purchase orders when a material falls to its minimum.',
    label: 'CRM event',
    blurb: 'When a material falls to its minimum, alerts your buyers with how much is left and how much to reorder.',
    category: 'Stock and purchasing',
    reaches: 'Alerts buyers in the app',
  },
  {
    id: 'invoice-overdue-reminder',
    name: 'Remind customers about overdue invoices',
    description: 'Drafts a polite payment reminder with AI when an invoice goes overdue.',
    label: 'CRM event',
    blurb: 'When an invoice goes overdue, AI writes a short reminder and emails it.',
    category: 'Money',
    reaches: '',
  },
  {
    id: 'payment-thank-you',
    name: 'Thank the customer for paying',
    description: 'Emails the customer a thank-you when an invoice is paid in full.',
    label: 'CRM event',
    blurb: 'When an invoice is paid in full, emails the customer a short thank-you that doubles as a receipt note.',
    category: 'Money',
    reaches: 'Emails the customer',
  },
  {
    id: 'expense-claim-submitted',
    name: 'Tell approvers about a new expense claim',
    description: 'Alerts the people who approve expenses when a claim is submitted.',
    label: 'CRM event',
    blurb: 'When someone submits an expense claim, alerts the people who can approve it.',
    category: 'Money',
    reaches: 'Alerts approvers in the app',
  },
  {
    id: 'handover-alert',
    name: 'Email me when a customer needs a person',
    description: 'Emails you when a customer conversation is handed over to a person.',
    label: 'CRM event',
    blurb: 'When the assistant hands a customer chat to a person, emails you the reason and a summary.',
    category: 'Customers',
    reaches: 'Emails you',
  },
  {
    id: 'order-delivered-feedback',
    name: 'Ask for feedback after delivery',
    description: 'Emails the customer three days after their order was delivered or collected.',
    label: 'CRM event',
    blurb: 'Three days after an order is delivered or collected, emails the customer to ask how it went.',
    category: 'Customers',
    reaches: 'Emails the customer',
  },
  {
    id: 'daily-summary',
    name: 'Morning summary',
    description: 'Emails you the numbers that matter every morning at 8:00.',
    label: 'Schedule',
    blurb: 'Every morning at 8:00, emails you what is waiting on customers, due today, overdue and running low.',
    category: 'Every day',
    reaches: 'Emails you',
  },
] as const satisfies readonly AutomationTemplate[];

export type AutomationTemplateId = (typeof AUTOMATION_TEMPLATES)[number]['id'];

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

  const P = (field: string) => `{{ $trigger.payload.${field} }}`;
  const eventRecipe = (event: string, eventLabel: string, steps: AutomationNode[], edges?: AutomationEdge[]) => ({
    name: meta.name,
    description: meta.description,
    triggerType: 'CRM_EVENT' as const,
    triggerConfig: { event },
    nodes: [node('trigger-1', 'crmEventTrigger', 0, eventLabel, { event }), ...steps],
    edges: edges ?? chain(['trigger-1', ...steps.map((step) => step.id)]),
  });
  const notify = (
    label: string,
    group: AutomationNotifyGroup,
    title: string,
    body: string,
    link: string,
  ): AutomationNode => node('notify-1', 'notifyStaffNode', 1, label, { audience: 'group', group, title, body, link });
  /** Wait, look the record up again, and go on only if it still waits on the customer. */
  const stillWaiting = (
    wait: string,
    entity: 'quote' | 'proof',
    idField: string,
    email: { label: string; subject: string; body: string },
  ) => {
    const steps = [
      node('delay-1', 'delayNode', 1, `Wait ${wait}`, { durationMs: wait }),
      node('lookup-1', 'crmMutateNode', 2, entity === 'quote' ? 'Look up the quote' : 'Look up the proof', {
        entity,
        action: 'get',
        recordId: P(idField),
      }),
      node('check-1', 'conditionNode', 3, 'Still waiting on the customer?', {
        condition: '$json.awaitingCustomer == true',
      }),
      // A condition card is taller than the others; leave room below it.
      node('email-1', 'sendEmailNode', 4.6, email.label, {
        to: P('customerEmail'),
        subject: email.subject,
        body: email.body,
      }),
    ];
    return {
      steps,
      edges: [
        ...chain(['trigger-1', 'delay-1', 'lookup-1', 'check-1']),
        { id: 'e-check-1-email-1', source: 'check-1', target: 'email-1', sourceHandle: 'true' },
      ] as AutomationEdge[],
    };
  };

  switch (id) {
    case 'quote-follow-up': {
      const { steps, edges } = stillWaiting('3 days', 'quote', 'quoteId', {
        label: 'Follow up',
        subject: `Your quote ${P('quoteNumber')}`,
        body:
          `Hello ${P('customerName')},\n\n` +
          `We sent you quote ${P('quoteNumber')} (${P('title')}) a few days ago. ` +
          'Do you have any questions, or would you like us to change anything?\n\n' +
          'You can accept it from the link in our earlier email, or just reply to this one.\n\nThank you',
      });
      return eventRecipe('quote.sent', 'Quote sent', steps, edges);
    }
    case 'quote-changes-requested':
      return eventRecipe('quote.changes_requested', 'Customer asked for changes', [
        notify(
          'Alert sales',
          'sales',
          `${P('customerName')} wants changes to quote ${P('quoteNumber')}`,
          `${P('respondedByName')} wrote: ${P('note')}`,
          `/quotes/${P('quoteId')}`,
        ),
      ]);
    case 'proof-reminder': {
      const { steps, edges } = stillWaiting('2 days', 'proof', 'proofId', {
        label: 'Remind the customer',
        subject: `Your artwork proof is waiting (${P('quoteNumber')})`,
        body:
          `Hello ${P('customerName')},\n\n` +
          `We sent you the artwork proof for ${P('title')} and are waiting for your approval. ` +
          'We cannot start the job until you approve it or tell us what to change.\n\n' +
          'You can do either from the link in our earlier email.\n\nThank you',
      });
      return eventRecipe('proof.sent', 'Proof sent', steps, edges);
    }
    case 'proof-approved-production':
      return eventRecipe('proof.approved', 'Proof approved', [
        notify(
          'Alert production',
          'production',
          `Artwork approved: ${P('title')}`,
          `${P('customerName')} approved proof version ${P('proofVersion')} for quote ${P('quoteNumber')}.`,
          `/quotes/${P('quoteId')}`,
        ),
      ]);
    case 'proof-changes-requested':
      return eventRecipe('proof.changes_requested', 'Customer asked for proof changes', [
        notify(
          'Alert sales',
          'sales',
          `${P('customerName')} wants changes to the proof (${P('quoteNumber')})`,
          `${P('respondedByName')} wrote: ${P('comment')}`,
          `/quotes/${P('quoteId')}`,
        ),
      ]);
    case 'deposit-paid-start-job':
      return eventRecipe('deposit.paid', 'Deposit paid', [
        notify(
          'Alert production',
          'production',
          `Deposit paid: order ${P('orderNumber')} can start`,
          `${P('customerName')} paid ${P('currency')} ${P('paidAmount')} on invoice ${P('invoiceNumber')}.`,
          `/orders/${P('orderId')}`,
        ),
      ]);
    case 'materials-arrived':
      return eventRecipe('purchase_order.received', 'Materials arrived', [
        notify(
          'Alert production',
          'production',
          `Materials arrived: ${P('poNumber')}`,
          `Everything on purchase order ${P('poNumber')} from ${P('supplierName')} has been received.`,
          '/purchasing/orders',
        ),
      ]);
    case 'order-ready-customer':
      return eventRecipe('sales_order.ready', 'Order ready', [
        node('email-1', 'sendEmailNode', 1, 'Tell the customer', {
          to: P('customerEmail'),
          subject: `Your order ${P('orderNumber')} is ready`,
          body:
            `Hello ${P('customerName')},\n\n` +
            `Good news: your order ${P('orderNumber')} is finished and ready. ` +
            'Reply to this email to arrange collection or delivery.\n\nThank you',
        }),
      ]);
    case 'stock-low-buyer':
      return eventRecipe('stock.low', 'Stock fell to its minimum', [
        notify(
          'Alert the buyers',
          'purchasing',
          `Running low: ${P('materialName')}`,
          `${P('qtyOnHand')} ${P('unit')} left; the minimum is ${P('reorderPoint')}. Usual reorder: ${P('reorderQty')} ${P('unit')}.`,
          '/inventory',
        ),
      ]);
    case 'payment-thank-you':
      return eventRecipe('invoice.paid', 'Invoice paid in full', [
        node('email-1', 'sendEmailNode', 1, 'Thank the customer', {
          to: P('customerEmail'),
          subject: `Payment received: invoice ${P('invoiceNumber')}`,
          body:
            `Hello ${P('customerName')},\n\n` +
            `We have received your payment and invoice ${P('invoiceNumber')} is now paid in full. Thank you.`,
        }),
      ]);
    case 'expense-claim-submitted':
      return eventRecipe('expense.submitted', 'Expense claim submitted', [
        notify(
          'Alert the approvers',
          'expense_approvers',
          `Expense claim from ${P('employeeName')}`,
          `${P('claimNumber')}: ${P('currency')} ${P('amount')} at ${P('merchantName')} (${P('category')}).`,
          '/finance/expenses',
        ),
      ]);
    case 'handover-alert':
      return eventRecipe('conversation.handover', 'Conversation needs a person', [
        node('email-1', 'sendEmailNode', 1, 'Email me', {
          to: opts.teamEmail,
          subject: `${P('contactName')} is waiting for a person`,
          body:
            `${P('contactName')} is waiting for a reply on ${P('channel')}.\n\n` +
            `Why: ${P('reasonLabel')}\n\n${P('summary')}\n\nOpen the Inbox in Kerf to reply.`,
        }),
      ]);
    case 'order-delivered-feedback':
      return eventRecipe('sales_order.fulfilled', 'Order delivered or collected', [
        node('delay-1', 'delayNode', 1, 'Wait 3 days', { durationMs: '3 days' }),
        node('email-1', 'sendEmailNode', 2, 'Ask for feedback', {
          to: P('customerEmail'),
          subject: `How did we do with order ${P('orderNumber')}?`,
          body:
            `Hello ${P('customerName')},\n\n` +
            `Your order ${P('orderNumber')} was completed a few days ago. Is everything as you expected? ` +
            'If anything is not right, reply to this email and we will sort it out. ' +
            'If you are happy with it, a short review would mean a lot to us.\n\nThank you',
        }),
      ]);
    case 'daily-summary':
      return {
        name: meta.name,
        description: meta.description,
        triggerType: 'SCHEDULE',
        triggerConfig: { schedule: { frequency: 'daily', time: '08:00', timezone: 'Asia/Dubai' } },
        nodes: [
          node('trigger-1', 'scheduleTrigger', 0, 'Every morning at 8:00', {}),
          node('summary-1', 'crmMutateNode', 1, "Get today's numbers", { entity: 'summary', action: 'daily' }),
          node('email-1', 'sendEmailNode', 2, 'Email me', {
            to: opts.teamEmail,
            subject: 'Your shop this morning ({{ $json.date }})',
            body: 'Good morning. Here is where things stand:\n\n{{ $json.summaryText }}',
          }),
        ],
        edges: chain(['trigger-1', 'summary-1', 'email-1']),
      };
    default:
      break;
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
