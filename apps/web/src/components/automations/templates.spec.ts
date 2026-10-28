import { describe, expect, it } from 'vitest';
import { validateWorkflowGraph } from '@saas/shared';
import { AUTOMATION_TEMPLATES, buildTemplateGraph } from './templates';

const EVENT_KEYS: Record<string, string[]> = {
  'quote.accepted': ['quoteId', 'quoteNumber', 'customerId', 'customerEmail', 'acceptedByName', 'totalAmount'],
  'invoice.overdue': ['invoiceId', 'invoiceNumber', 'customerId', 'customerEmail', 'amount', 'paidAmount', 'dueDate'],
};

const ids = ['quote-accepted-notify', 'invoice-overdue-reminder'] as const;

describe('automation templates', () => {
  it('offers exactly the two templates', () => {
    expect(AUTOMATION_TEMPLATES.map((t) => t.id)).toEqual([...ids]);
  });

  for (const id of ids) {
    for (const aiEmailToCustomers of [false, true]) {
      describe(`${id} (aiEmailToCustomers=${aiEmailToCustomers})`, () => {
        const g = buildTemplateGraph(id, { aiEmailToCustomers });
        const trigger = g.nodes.find((n) => n.type === 'crmEventTrigger')!;
        const event = (trigger.data.config as { event: string }).event;

        it('passes validateWorkflowGraph', () => {
          expect(validateWorkflowGraph(g.nodes, g.edges).isValid).toBe(true);
        });

        it('triggerConfig.event matches the trigger node', () => {
          expect(g.triggerType).toBe('CRM_EVENT');
          expect((g.triggerConfig as { event: string }).event).toBe(event);
        });

        it('references only payload keys the event emits, and $json.text only after the AI step', () => {
          for (const node of g.nodes) {
            const text = JSON.stringify(node.data.config ?? {});
            for (const m of text.matchAll(/\$trigger\.payload\.(\w+)/g)) {
              expect(EVENT_KEYS[event]).toContain(m[1]);
            }
            if (text.includes('$json.text')) {
              const pred = g.edges.filter((e) => e.target === node.id).map((e) => g.nodes.find((n) => n.id === e.source)!);
              expect(pred.map((p) => p.type)).toEqual(['aiPromptNode']);
            }
            const stripped = text.replace(/\$trigger\.payload\.\w+/g, '').replace(/\$json\.text/g, '');
            expect(stripped).not.toMatch(/\$(trigger|json)/);
          }
        });
      });
    }
  }

  it('switches the overdue recipient with aiEmailToCustomers', () => {
    const email = (on: boolean) =>
      buildTemplateGraph('invoice-overdue-reminder', { aiEmailToCustomers: on }).nodes.find(
        (n) => n.type === 'sendEmailNode',
      )!.data.config as { to: string; body: string };
    expect(email(true).to).toBe('{{ $trigger.payload.customerEmail }}');
    expect(email(true).body).toBe('{{ $json.text }}');
    expect(email(false).to).toBe('team@yourcompany.com');
    expect(email(false).body).toBe('Draft for {{ $trigger.payload.customerEmail }}:\n\n{{ $json.text }}');
  });
});
