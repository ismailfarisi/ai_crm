import { describe, expect, it } from 'vitest';
import { CRM_EVENTS } from './crm-events';
import { eventFieldsFor, sampleDataFor, sampleTriggerFor, triggerFieldExpression } from './event-data';
import {
  STEP_WORDING,
  availableData,
  findDataItem,
  plainStepName,
  previewText,
  stepsBefore,
} from './step-wording';
import {
  conditionExpression,
  describeCondition,
  operatorsFor,
  readCondition,
  type ConditionBuilderState,
} from './condition-rules';
import { delayConfig, formatDuration, normalizeDelayNodes, parseDuration, readDelay } from './duration';

describe('event data: one place per event', () => {
  it('describes every event the builder offers, with a sample for each field', () => {
    for (const event of CRM_EVENTS) {
      const fields = eventFieldsFor(event.value);
      expect(fields.length, event.value).toBeGreaterThan(0);
      for (const field of fields) {
        expect(field.label, `${event.value}.${field.key}`).toBeTruthy();
        expect(field.sample, `${event.value}.${field.key}`).not.toBe('');
      }
    }
  });

  it('uses the names the quote-accepted event really carries', () => {
    const sample = sampleDataFor('quote.accepted');
    expect(Object.keys(sample)).toEqual(
      expect.arrayContaining(['quoteNumber', 'totalAmount', 'acceptedByName', 'customerEmail']),
    );
    // The old generic sample used these, which the event never had.
    expect(sample).not.toHaveProperty('amount');
    expect(sample).not.toHaveProperty('customerName');
  });

  it('wraps a test sample the way a real event arrives, so expressions read the same', () => {
    const trigger = sampleTriggerFor('quote.accepted') as { eventType: string; payload: Record<string, unknown> };
    expect(trigger.eventType).toBe('quote.accepted');
    expect(trigger.payload.totalAmount).toBe(sampleDataFor('quote.accepted').totalAmount);
    expect(triggerFieldExpression('totalAmount')).toBe('$trigger.payload.totalAmount');
  });

  it('falls back to the record an undescribed event is about, and to nothing when unknown', () => {
    expect(eventFieldsFor('quote.sent').map((f) => f.key)).toContain('quoteNumber');
    expect(eventFieldsFor('mystery.happened')).toEqual([]);
    expect(eventFieldsFor(null)).toEqual([]);
  });
});

describe('step wording', () => {
  it('has plain words for every kind of step, free of developer terms', () => {
    for (const [type, wording] of Object.entries(STEP_WORDING)) {
      const text = `${wording.label} ${wording.description}`;
      for (const word of ['Node', 'Cron', 'LLM', 'ReAct', 'HITL', 'Mutation', 'HTTP', 'Webhook', 'JS', 'DAG']) {
        expect(text, type).not.toContain(word);
      }
    }
  });

  it('reads a default name saved by an older build in today’s words, and keeps a name the user gave', () => {
    expect(plainStepName('delayNode', 'Delay Execution')).toBe('Wait');
    expect(plainStepName('crmEventTrigger', 'CRM Event Trigger')).toBe('When something happens in Kerf');
    expect(plainStepName('sendEmailNode', 'Tell the team')).toBe('Tell the team');
    expect(plainStepName('sendEmailNode', '')).toBe('Send an email');
  });
});

describe('data available to a step', () => {
  const nodes = [
    { id: 't', type: 'crmEventTrigger' as const, data: { label: 'Start', config: { event: 'quote.accepted' } } },
    { id: 'wait', type: 'delayNode' as const, data: { label: 'Wait', config: {} } },
    { id: 'ai', type: 'aiPromptNode' as const, data: { label: 'Draft the note', config: {} } },
    { id: 'mail', type: 'sendEmailNode' as const, data: { label: 'Email the team', config: {} } },
    { id: 'other', type: 'aiPromptNode' as const, data: { label: 'Unrelated', config: {} } },
  ];
  const edges = [
    { source: 't', target: 'wait' },
    { source: 'wait', target: 'ai' },
    { source: 'ai', target: 'mail' },
  ];

  it('walks back through every earlier step, nearest first', () => {
    expect(stepsBefore('mail', edges)).toEqual(['ai', 'wait', 't']);
  });

  it('lists the event’s fields, then what earlier steps produced, by plain name', () => {
    const groups = availableData('mail', nodes, edges);
    expect(groups.map((g) => g.title)).toEqual(['Customer accepted a quote', 'Draft the note']);
    expect(findDataItem(groups, '$trigger.payload.totalAmount')).toMatchObject({ label: 'Quote total', type: 'number' });
    expect(groups[1].items[0]).toMatchObject({ label: 'What the AI wrote', expression: '$node["ai"].json.text' });
  });

  it('does not offer a step that runs later or on another path', () => {
    const titles = availableData('wait', nodes, edges).map((g) => g.title);
    expect(titles).toEqual(['Customer accepted a quote']);
  });

  it('previews a text with sample values, and marks what it does not know', () => {
    const groups = availableData('mail', nodes, edges);
    expect(previewText('Quote {{ $trigger.payload.quoteNumber }} for {{$trigger.payload.totalAmount}}', groups)).toBe(
      'Quote Q-2026-0042 for 18500',
    );
    expect(previewText('Hi {{ $json.name }}', groups)).toBe('Hi [$json.name]');
  });
});

describe('condition rules', () => {
  const big: ConditionBuilderState = {
    match: 'all',
    rules: [
      { field: '$trigger.payload.totalAmount', label: 'Quote total', type: 'number', op: 'gt', value: '10000' },
      { field: '$trigger.payload.acceptedByName', label: 'Accepted by', type: 'text', op: 'notEmpty', value: '' },
    ],
  };

  it('writes an expression the engine can evaluate: comparisons only, no function calls', () => {
    expect(conditionExpression(big)).toBe(
      '$trigger.payload.totalAmount > 10000 && ($trigger.payload.acceptedByName != null && $trigger.payload.acceptedByName !== "")',
    );
    expect(conditionExpression({ ...big, match: 'any' })).toContain(' || ');
    expect(conditionExpression(big)).not.toMatch(/\w\(/);
  });

  it('quotes text, including text that looks like a number', () => {
    const state: ConditionBuilderState = {
      match: 'all',
      rules: [{ field: '$trigger.payload.quoteNumber', type: 'text', op: 'eq', value: '2026' }],
    };
    expect(conditionExpression(state)).toBe('$trigger.payload.quoteNumber == "2026"');
  });

  it('leaves out a rule that is not filled in yet', () => {
    const state: ConditionBuilderState = {
      match: 'all',
      rules: [big.rules[0], { field: '', op: 'eq', value: '' }, { field: '$json.x', op: 'eq', value: '' }],
    };
    expect(conditionExpression(state)).toBe('$trigger.payload.totalAmount > 10000');
  });

  it('says the rule in plain words', () => {
    expect(describeCondition(big)).toBe('Quote total is more than 10000 and Accepted by is filled in');
  });

  it('offers comparisons that fit the kind of field', () => {
    expect(operatorsFor('number')).toContain('gt');
    expect(operatorsFor('text')).not.toContain('gt');
  });

  it('reopens in the builder what the builder wrote, and as typed anything else', () => {
    const built = { condition: conditionExpression(big), conditionBuilder: big };
    expect(readCondition(built).mode).toBe('builder');
    // Edited by hand afterwards: the saved rules no longer say what runs.
    expect(readCondition({ ...built, condition: '$json.amount > 5' }).mode).toBe('typed');
    // Saved by an older build.
    expect(readCondition({ condition: "$json.status === 'ACTIVE'" })).toMatchObject({
      mode: 'typed',
      expression: "$json.status === 'ACTIVE'",
    });
    expect(readCondition({ condition: '' }).mode).toBe('builder');
    expect(readCondition({ condition: '', conditionBuilder: null }).mode).toBe('typed');
  });
});

describe('durations', () => {
  it('reads what the engine accepts', () => {
    expect(parseDuration('1 day')).toEqual({ amount: 1, unit: 'days' });
    expect(parseDuration('24h')).toEqual({ amount: 24, unit: 'hours' });
    expect(parseDuration(86_400_000)).toEqual({ amount: 1, unit: 'days' });
    expect(parseDuration('5000')).toEqual({ amount: 5, unit: 'seconds' });
    expect(parseDuration('soon')).toBeNull();
  });

  it('writes one readable field the engine parses', () => {
    expect(formatDuration({ amount: 1, unit: 'days' })).toBe('1 day');
    expect(delayConfig({ amount: 3, unit: 'hours' })).toMatchObject({ duration: '3 hours', delayMinutes: undefined });
  });

  it('reads a wait from whichever field holds it', () => {
    expect(readDelay({ duration: '2 days' })).toEqual({ amount: 2, unit: 'days' });
    expect(readDelay({ durationMs: 60000 })).toEqual({ amount: 1, unit: 'minutes' });
    expect(readDelay({ delayMinutes: 10 })).toEqual({ amount: 10, unit: 'minutes' });
    expect(readDelay({})).toEqual({ amount: 5, unit: 'minutes' });
  });

  it('moves a wait saved as delayMinutes, which the engine never read, to duration', () => {
    const [wait, email] = normalizeDelayNodes([
      { id: 'w', type: 'delayNode', data: { label: 'Wait', config: { delayMinutes: 10 } } },
      { id: 'e', type: 'sendEmailNode', data: { label: 'Email', config: { delayMinutes: 10 } } },
    ]);
    expect(wait.data.config).toEqual({ duration: '10 minutes' });
    expect(email.data.config).toEqual({ delayMinutes: 10 });
  });
});
