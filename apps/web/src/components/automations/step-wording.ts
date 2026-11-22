import type { AutomationEdge, AutomationNode, AutomationNodeType } from '@saas/shared';
import { crmEventOf, findCrmEvent } from './crm-events';
import { eventFieldsFor, triggerFieldExpression, type EventFieldType } from './event-data';

/**
 * The words the builder uses for each kind of step, written for a workshop
 * owner rather than a developer. Everything that names a step (the step
 * chooser, the canvas, the settings panel) reads from here.
 */
export interface StepWording {
  /** Name of the step, also the default name of a new one. */
  label: string;
  /** One line saying what it does. */
  description: string;
  /** The small heading above the step's name on the canvas. */
  kind: 'Starts it' | 'Do something' | 'Decide or wait';
  /** Shown under "More options" in the step chooser. */
  advanced?: boolean;
}

/**
 * Typed loosely on purpose: a kind of step can be described here before, or
 * in the same change as, it joins `AutomationNodeType`.
 */
export const STEP_WORDING: Record<AutomationNodeType, StepWording> & Record<string, StepWording> = {
  crmEventTrigger: {
    label: 'When something happens in Kerf',
    description: 'A quote is accepted, an invoice goes overdue, a contact is added…',
    kind: 'Starts it',
  },
  scheduleTrigger: {
    label: 'On a schedule',
    description: 'Every day, every week or every month at a time you choose',
    kind: 'Starts it',
  },
  manualTrigger: {
    label: 'When someone starts it',
    description: 'Runs only when you press Run',
    kind: 'Starts it',
  },
  webhookTrigger: {
    label: 'When another app sends data',
    description: 'Another system calls a web address that Kerf gives you',
    kind: 'Starts it',
    advanced: true,
  },
  sendEmailNode: {
    label: 'Send an email',
    description: 'Email your team or the customer',
    kind: 'Do something',
  },
  sendMessageNode: {
    label: 'Send a message',
    description: 'WhatsApp, Telegram or Slack, to a customer or a colleague',
    kind: 'Do something',
  },
  notifyStaffNode: {
    label: 'Alert the team in Kerf',
    description: 'Put an alert in the bell for a colleague or a whole team',
    kind: 'Do something',
  },
  crmMutateNode: {
    label: 'Update a record',
    description: 'Add or change a contact, or approve or reject a quote',
    kind: 'Do something',
  },
  approvalNode: {
    label: 'Ask for approval',
    description: 'Pause until someone on your team approves or rejects',
    kind: 'Decide or wait',
  },
  delayNode: {
    label: 'Wait',
    description: 'Pause for minutes, hours or days before the next step',
    kind: 'Decide or wait',
  },
  conditionNode: {
    label: 'Only continue if…',
    description: 'Take one path when a rule is met and another when it is not',
    kind: 'Decide or wait',
  },
  aiPromptNode: {
    label: 'Write with AI',
    description: 'Have AI draft a message or summarise what happened',
    kind: 'Do something',
  },
  aiAgentNode: {
    label: 'AI agent',
    description: 'Give one of your agents a task; it asks for approval before it changes anything',
    kind: 'Do something',
  },
  httpRequestNode: {
    label: 'Send data to another app',
    description: 'Call a web address in another system',
    kind: 'Do something',
    advanced: true,
  },
  transformNode: {
    label: 'Reshape data',
    description: 'Work out new values with a small script',
    kind: 'Do something',
    advanced: true,
  },
};

const TRIGGER_TYPES = new Set<string>([
  'crmEventTrigger',
  'scheduleTrigger',
  'manualTrigger',
  'webhookTrigger',
]);

export function isTriggerType(type: string | undefined): boolean {
  return !!type && TRIGGER_TYPES.has(type);
}

export function stepWording(type: string | undefined): StepWording | undefined {
  return type ? STEP_WORDING[type as AutomationNodeType] : undefined;
}

/** The name to show for a step: its own, else what its kind is called. */
export function stepName(node: Pick<AutomationNode, 'type'> & { data?: { label?: string } }): string {
  return node.data?.label?.trim() || stepWording(node.type)?.label || 'Step';
}

/** Names saved by older builds, shown in plain words until the user renames the step. */
const LEGACY_LABELS: Record<string, AutomationNodeType> = {
  'Webhook Trigger': 'webhookTrigger',
  'Inbound Webhook Trigger': 'webhookTrigger',
  'Schedule Trigger': 'scheduleTrigger',
  'Cron Schedule Trigger': 'scheduleTrigger',
  'CRM Event Trigger': 'crmEventTrigger',
  'Manual Trigger': 'manualTrigger',
  'Condition Branch': 'conditionNode',
  'Data Transform': 'transformNode',
  'Delay Execution': 'delayNode',
  'HTTP Request': 'httpRequestNode',
  'AI Prompt / LLM': 'aiPromptNode',
  'Autonomous AI Agent': 'aiAgentNode',
  'Send Email': 'sendEmailNode',
  'CRM Mutation': 'crmMutateNode',
  'Human Approval': 'approvalNode',
};

/** A default name from an older build reads as today's wording; any other name is kept. */
export function plainStepName(type: string | undefined, label: string | undefined): string {
  const own = label?.trim();
  if (own && LEGACY_LABELS[own] !== type) return own;
  return stepWording(type)?.label ?? own ?? 'Step';
}

// ---------------------------------------------------------------------------
// Data an earlier step makes available to a later one
// ---------------------------------------------------------------------------

export interface DataItem {
  /** Plain name, e.g. "Quote number". */
  label: string;
  /** What is stored and evaluated, e.g. `$trigger.payload.quoteNumber`. */
  expression: string;
  type: EventFieldType;
  sample?: string | number;
  options?: readonly string[];
}

export interface DataGroup {
  id: string;
  /** e.g. "From: Customer accepted a quote". */
  title: string;
  items: DataItem[];
}

/** What each kind of step hands on to later steps; `key` is the field in its output. */
const STEP_OUTPUTS: Partial<Record<AutomationNodeType, (Omit<DataItem, 'expression'> & { key: string })[]>> = {
  aiPromptNode: [{ key: 'text', label: 'What the AI wrote', type: 'text', sample: 'Hi team, quote Q-2026-0042 was accepted…' }],
  aiAgentNode: [{ key: 'solution', label: 'What the assistant answered', type: 'text', sample: 'I checked the order and…' }],
  approvalNode: [
    {
      key: 'decision',
      label: 'Decision',
      type: 'choice',
      sample: 'APPROVED',
      options: ['APPROVED', 'REJECTED', 'TIMEOUT'],
    },
    { key: 'comment', label: "Approver's comment", type: 'text', sample: 'Looks fine, go ahead.' },
  ],
  httpRequestNode: [
    { key: 'status', label: 'Response code', type: 'number', sample: 200 },
    { key: 'data', label: 'What the other app sent back', type: 'text' },
  ],
  // For a later step that works on the same record: "Create a contact", then update it.
  crmMutateNode: [
    { key: 'recordId', label: 'ID of the record it changed', type: 'text', sample: '3f2a9c1e-5b7d-4e8a-9c21-7d5e4f3a2b10' },
  ],
};

/** Where a step's output lives at run time. Steps are addressed by id, which never changes. */
export function stepOutputExpression(nodeId: string, key: string): string {
  return `$node[${JSON.stringify(nodeId)}].json.${key}`;
}

type GraphNode = Pick<AutomationNode, 'id' | 'type'> & { data?: { label?: string; config?: Record<string, unknown> } };

/** Ids of every step that runs before `nodeId`, nearest first. */
export function stepsBefore(nodeId: string, edges: Pick<AutomationEdge, 'source' | 'target'>[]): string[] {
  const seen = new Set<string>([nodeId]);
  const order: string[] = [];
  const queue = [nodeId];
  while (queue.length > 0) {
    const current = queue.shift() as string;
    for (const edge of edges) {
      if (edge.target !== current || seen.has(edge.source)) continue;
      seen.add(edge.source);
      order.push(edge.source);
      queue.push(edge.source);
    }
  }
  return order;
}

/**
 * Everything the step `nodeId` can use: the data of whatever started the
 * automation, then what each earlier step produced. A step that isn't
 * connected yet still sees the trigger's data, since that is where it will
 * end up.
 */
export function availableData(
  nodeId: string,
  nodes: GraphNode[],
  edges: Pick<AutomationEdge, 'source' | 'target'>[],
): DataGroup[] {
  const groups: DataGroup[] = [];
  const trigger = nodes.find((n) => isTriggerType(n.type));

  if (trigger && trigger.id !== nodeId && trigger.type === 'crmEventTrigger') {
    const event = crmEventOf(trigger.data?.config);
    const fields = eventFieldsFor(event);
    if (fields.length > 0) {
      groups.push({
        id: 'trigger',
        title: findCrmEvent(event)?.label ?? 'What started it',
        items: fields.map((f) => ({
          label: f.label,
          expression: triggerFieldExpression(f.key),
          type: f.type,
          sample: f.sample,
          options: f.options,
        })),
      });
    }
  }

  const byId = new Map(nodes.map((n) => [n.id, n]));
  for (const id of stepsBefore(nodeId, edges)) {
    const step = byId.get(id);
    const outputs = step ? STEP_OUTPUTS[step.type as AutomationNodeType] : undefined;
    if (!step || !outputs) continue;
    groups.push({
      id,
      title: plainStepName(step.type, step.data?.label),
      items: outputs.map((o) => ({
        label: o.label,
        expression: stepOutputExpression(id, o.key),
        type: o.type,
        sample: o.sample,
        options: o.options,
      })),
    });
  }
  return groups;
}

/** Looks an expression up among the available data, for showing its plain name. */
export function findDataItem(groups: DataGroup[], expression: string): (DataItem & { group: string }) | undefined {
  const wanted = expression.trim();
  for (const group of groups) {
    const item = group.items.find((i) => i.expression === wanted);
    if (item) return { ...item, group: group.title };
  }
  return undefined;
}

const PLACEHOLDER = /\{\{\s*([^}]+?)\s*\}\}/g;

/**
 * What a text with `{{ … }}` placeholders will read like, using sample
 * values. A placeholder nothing is known about is shown as "[name]".
 */
export function previewText(text: string, groups: DataGroup[]): string {
  return text.replace(PLACEHOLDER, (_, expression: string) => {
    const item = findDataItem(groups, expression);
    if (item?.sample !== undefined) return String(item.sample);
    return `[${item?.label ?? expression.trim()}]`;
  });
}

/**
 * The same text with each `{{ … }}` it recognises shown by its plain name:
 * "Quote accepted: [Quote number]". For a step's card on the canvas, where
 * there is no room for an example. Anything not recognised stays as typed.
 */
export function namedText(text: string, groups: DataGroup[]): string {
  return text.replace(PLACEHOLDER, (typed: string, expression: string) => {
    const item = findDataItem(groups, expression);
    return item ? `[${item.label}]` : typed;
  });
}

export function hasPlaceholder(text: unknown): boolean {
  return typeof text === 'string' && /\{\{[^}]+\}\}/.test(text);
}
