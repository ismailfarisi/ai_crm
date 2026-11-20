import { describe, expect, it } from 'vitest';
import {
  AUTOMATION_LOOKUP_SAMPLES,
  AUTOMATION_NOTIFY_GROUPS,
  AUTOMATION_RECORD_ACTIONS,
  automationScheduleSchema,
  validateWorkflowGraph,
  type AutomationEdge,
  type AutomationNode,
} from '@saas/shared';
import {
  AUTOMATION_TEMPLATES,
  AUTOMATION_TEMPLATE_CATEGORIES,
  buildTemplateGraph,
  type AutomationTemplateId,
} from './templates';
import { CRM_EVENTS, CRM_EVENT_GROUPS, findCrmEvent, sampleTriggerFor } from './crm-events';

const teamEmail = 'owner@acme.test';
const ids = AUTOMATION_TEMPLATES.map((t) => t.id);

/** The step types the worker runs, and the text fields each one reads. */
const RUNNABLE_STEPS = new Set([
  'crmEventTrigger',
  'scheduleTrigger',
  'delayNode',
  'conditionNode',
  'aiPromptNode',
  'sendEmailNode',
  'notifyStaffNode',
  'sendMessageNode',
  'crmMutateNode',
]);

/** Pages a notification may open; the id segment is filled from the event. */
const APP_PAGES = [/^\/quotes\/[^/]+$/, /^\/orders\/[^/]+$/, /^\/purchasing\/orders$/, /^\/inventory$/, /^\/finance\/expenses$/];

const predecessors = (g: { nodes: AutomationNode[]; edges: AutomationEdge[] }, id: string) =>
  g.edges.filter((e) => e.target === id).map((e) => g.nodes.find((n) => n.id === e.source)!);

/** What `$json` holds when a step runs: the output of the step before it. */
function jsonKeysFor(node: AutomationNode): string[] {
  const config = (node.data.config ?? {}) as Record<string, string>;
  if (node.type === 'aiPromptNode') return ['text'];
  if (node.type === 'crmMutateNode') {
    const sample = AUTOMATION_LOOKUP_SAMPLES[config.entity as keyof typeof AUTOMATION_LOOKUP_SAMPLES];
    return sample ? Object.keys(sample) : [];
  }
  return [];
}

describe('automation recipes', () => {
  it('keeps the two original templates and offers the shop recipes asked for', () => {
    expect(ids).toEqual(
      expect.arrayContaining([
        'quote-accepted-notify',
        'invoice-overdue-reminder',
        'quote-follow-up',
        'deposit-paid-start-job',
        'proof-reminder',
        'order-ready-customer',
        'stock-low-buyer',
        'daily-summary',
      ]),
    );
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('files every recipe under a gallery heading, and every heading has a recipe', () => {
    for (const template of AUTOMATION_TEMPLATES) {
      expect(AUTOMATION_TEMPLATE_CATEGORIES).toContain(template.category);
    }
    for (const category of AUTOMATION_TEMPLATE_CATEGORIES) {
      expect(AUTOMATION_TEMPLATES.some((t) => t.category === category)).toBe(true);
    }
  });

  for (const id of ids as AutomationTemplateId[]) {
    for (const aiEmailToCustomers of [false, true]) {
      describe(`${id} (aiEmailToCustomers=${aiEmailToCustomers})`, () => {
        const g = buildTemplateGraph(id, { aiEmailToCustomers, teamEmail });
        const trigger = g.nodes[0];
        const event = (trigger.data.config as { event?: string }).event ?? null;
        const payloadKeys = event ? Object.keys(findCrmEvent(event)?.sample ?? {}) : [];

        it('passes validateWorkflowGraph and uses only steps the worker runs', () => {
          expect(validateWorkflowGraph(g.nodes, g.edges).isValid).toBe(true);
          for (const node of g.nodes) expect(RUNNABLE_STEPS).toContain(node.type);
        });

        it('starts from an event the builder offers, or a valid schedule', () => {
          if (g.triggerType === 'CRM_EVENT') {
            expect(trigger.type).toBe('crmEventTrigger');
            expect(findCrmEvent(event)).toBeDefined();
            expect((g.triggerConfig as { event: string }).event).toBe(event);
          } else {
            expect(g.triggerType).toBe('SCHEDULE');
            expect(trigger.type).toBe('scheduleTrigger');
            expect(automationScheduleSchema.safeParse(g.triggerConfig.schedule).success).toBe(true);
          }
        });

        it('reads only fields the event sends and the step before it returns', () => {
          for (const node of g.nodes) {
            const text = JSON.stringify(node.data.config ?? {});
            for (const m of text.matchAll(/\$trigger\.payload\.(\w+)/g)) {
              expect(payloadKeys, `${node.id} reads $trigger.payload.${m[1]}`).toContain(m[1]);
            }
            const jsonRefs = [...text.matchAll(/\$json\.(\w+)/g)].map((m) => m[1]);
            if (jsonRefs.length) {
              const before = predecessors(g, node.id);
              expect(before).toHaveLength(1);
              for (const key of jsonRefs) {
                expect(jsonKeysFor(before[0]), `${node.id} reads $json.${key}`).toContain(key);
              }
            }
            const stripped = text.replace(/\$trigger\.payload\.\w+/g, '').replace(/\$json\.\w+/g, '');
            expect(stripped).not.toMatch(/\$(trigger|json|node)/);
          }
        });

        it('configures each step with what the worker accepts', () => {
          for (const node of g.nodes) {
            const config = (node.data.config ?? {}) as Record<string, string>;
            if (node.type === 'notifyStaffNode') {
              expect(config.audience).toBe('group');
              expect(AUTOMATION_NOTIFY_GROUPS.map((group) => group.value)).toContain(config.group);
              expect(config.title).toBeTruthy();
              const page = config.link.replace(/\{\{[^}]+\}\}/g, 'id');
              expect(APP_PAGES.some((pattern) => pattern.test(page)), page).toBe(true);
            }
            if (node.type === 'crmMutateNode') {
              const known = AUTOMATION_RECORD_ACTIONS.find(
                (a) => a.entity === config.entity && a.action === config.action,
              );
              expect(known?.kind).toBe('lookup');
              if (config.action === 'get') expect(config.recordId).toMatch(/\$trigger\.payload\.\w+Id/);
            }
            if (node.type === 'sendEmailNode') {
              expect(config.to).toBeTruthy();
              expect(config.subject).toBeTruthy();
              expect(config.body).toBeTruthy();
            }
            if (node.type === 'delayNode') expect(config.durationMs).toMatch(/^\d+ days$/);
            if (node.type === 'conditionNode') {
              const out = g.edges.filter((e) => e.source === node.id);
              expect(out.map((e) => e.sourceHandle)).toEqual(['true']);
            }
          }
        });

        it('sends AI-written text to a customer only when the organisation allows it', () => {
          const hasAi = g.nodes.some((n) => n.type === 'aiPromptNode');
          for (const node of g.nodes) {
            // A chat message to a customer can never carry AI text.
            if (node.type === 'sendMessageNode') {
              expect((node.data.config as { audience: string }).audience === 'customer' && hasAi).toBe(false);
            }
            if (node.type === 'sendEmailNode' && hasAi && !aiEmailToCustomers) {
              expect((node.data.config as { to: string }).to).toBe(teamEmail);
            }
          }
        });
      });
    }
  }

  it('switches the overdue recipient with aiEmailToCustomers', () => {
    const email = (on: boolean) =>
      buildTemplateGraph('invoice-overdue-reminder', { aiEmailToCustomers: on, teamEmail }).nodes.find(
        (n) => n.type === 'sendEmailNode',
      )!.data.config as { to: string; body: string };
    expect(email(true).to).toBe('{{ $trigger.payload.customerEmail }}');
    expect(email(true).body).toBe('{{ $json.text }}');
    expect(email(false).to).toBe(teamEmail);
    expect(email(false).body).toBe('Draft for {{ $trigger.payload.customerEmail }}:\n\n{{ $json.text }}');
  });

  it('checks a quote or proof again after the wait, and stops if the customer has answered', () => {
    for (const id of ['quote-follow-up', 'proof-reminder'] as const) {
      const g = buildTemplateGraph(id, { aiEmailToCustomers: false, teamEmail });
      expect(g.nodes.map((n) => n.type)).toEqual([
        'crmEventTrigger',
        'delayNode',
        'crmMutateNode',
        'conditionNode',
        'sendEmailNode',
      ]);
      expect(g.nodes[3].data.config).toEqual({ condition: '$json.awaitingCustomer == true' });
    }
  });
});

describe('starting events', () => {
  it('gives every event a label, a "when", a heading and a sample', () => {
    expect(new Set(CRM_EVENTS.map((e) => e.value)).size).toBe(CRM_EVENTS.length);
    for (const event of CRM_EVENTS) {
      expect(event.label).toBeTruthy();
      expect(event.when).toBeTruthy();
      expect(CRM_EVENT_GROUPS).toContain(event.group);
      expect(Object.keys(event.sample).length).toBeGreaterThan(3);
    }
  });

  it('covers what a shop reacts to', () => {
    const values = CRM_EVENTS.map((e) => e.value);
    for (const value of [
      'invoice.paid',
      'invoice.partially_paid',
      'invoice.voided',
      'sales_order.created',
      'work_order.completed',
      'proof.sent',
      'deposit.paid',
      'payment.received',
      'purchase_order.received',
      'stock.low',
      'expense.submitted',
      'message.received',
      'conversation.handover',
    ]) {
      expect(values).toContain(value);
    }
  });

  it('shapes the test-run sample like a real run, so $trigger.payload reads the same', () => {
    const sample = sampleTriggerFor('deposit.paid')!;
    expect(sample.eventType).toBe('deposit.paid');
    expect(sample.payload).toBe(findCrmEvent('deposit.paid')!.sample);
    expect(typeof sample.entityId).toBe('string');
    expect(sampleTriggerFor('nope')).toBeNull();
    expect(sampleTriggerFor(null)).toBeNull();
  });
});
