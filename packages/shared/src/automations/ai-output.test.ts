import { describe, it, expect } from 'vitest';
import { usesAiOutput } from './ai-output';
import type { AutomationEdge, AutomationNode } from './types';

const node = (
  id: string,
  type: AutomationNode['type'],
  label: string,
  config: Record<string, any> = {},
): AutomationNode => ({
  id,
  type,
  position: { x: 0, y: 0 },
  data: { label, config },
});

describe('usesAiOutput', () => {
  it('is true when $json is used and the only predecessor is an AI prompt node', () => {
    const ai = node('ai', 'aiPromptNode', 'Draft');
    const mail = node('mail', 'sendEmailNode', 'Mail', { body: '{{ $json.text }}' });
    const edges: AutomationEdge[] = [{ id: 'e', source: 'ai', target: 'mail' }];
    expect(usesAiOutput(mail, [ai, mail], edges)).toBe(true);
  });

  it.each(['"', "'"])('is true when a %s-quoted $node reference names an AI agent node', (q) => {
    const ai = node('ai', 'aiAgentNode', 'Draft reminder');
    const mail = node('mail', 'sendEmailNode', 'Mail', {
      subject: `Re: {{ $node[${q}Draft reminder${q}].json.text }}`,
    });
    expect(usesAiOutput(mail, [ai, mail], [])).toBe(true);
  });

  it('is false when $json is used but the predecessor is a transform node', () => {
    const tf = node('tf', 'transformNode', 'Shape');
    const mail = node('mail', 'sendEmailNode', 'Mail', { body: '{{ $json.text }}' });
    const edges: AutomationEdge[] = [{ id: 'e', source: 'tf', target: 'mail' }];
    expect(usesAiOutput(mail, [tf, mail], edges)).toBe(false);
  });

  it('is false when $node names a non-AI node', () => {
    const tf = node('tf', 'transformNode', 'Shape');
    const mail = node('mail', 'sendEmailNode', 'Mail', {
      body: '{{ $node["Shape"].json.text }}',
    });
    expect(usesAiOutput(mail, [tf, mail], [])).toBe(false);
  });
  it('is true when an AI node is an ancestor through a transform node', () => {
    const ai = node('ai', 'aiPromptNode', 'Draft');
    const tf = node('tf', 'transformNode', 'Shape');
    const mail = node('mail', 'sendEmailNode', 'Mail', { body: '{{ $json.x }}' });
    const edges: AutomationEdge[] = [
      { id: 'e1', source: 'ai', target: 'tf' },
      { id: 'e2', source: 'tf', target: 'mail' },
    ];
    expect(usesAiOutput(mail, [ai, tf, mail], edges)).toBe(true);
  });

  it.each([
    '{{ $node.ai.json.text }}',
    '{{ $node.Draft.json.text }}',
    '{{ $node[`Draft`].json.text }}',
    '{{ $json["text"] }}',
  ])('is true for %s with an upstream AI node', (expr) => {
    const trig = node('trig', 'manualTrigger', 'Start');
    const ai = node('ai', 'aiPromptNode', 'Draft');
    const mail = node('mail', 'sendEmailNode', 'Mail', { to: 'a@x.com', body: expr });
    const edges: AutomationEdge[] = [
      { id: 'e1', source: 'trig', target: 'ai' },
      { id: 'e2', source: 'ai', target: 'mail' },
    ];
    expect(usesAiOutput(mail, [trig, ai, mail], edges)).toBe(true);
  });

  it('is true when the recipient comes from an upstream AI step', () => {
    const ai = node('ai', 'aiAgentNode', 'Pick');
    const mail = node('mail', 'sendEmailNode', 'Mail', { to: '{{ $json.email }}', body: 'Hi' });
    expect(
      usesAiOutput(mail, [ai, mail], [{ id: 'e', source: 'ai', target: 'mail' }]),
    ).toBe(true);
  });

  it('is false when only the trigger is used downstream of an AI step', () => {
    const ai = node('ai', 'aiPromptNode', 'Draft');
    const mail = node('mail', 'sendEmailNode', 'Mail', {
      to: '{{ $trigger.payload.email }}',
      body: 'Quote {{ $trigger.payload.x }} is overdue',
    });
    expect(
      usesAiOutput(mail, [ai, mail], [{ id: 'e', source: 'ai', target: 'mail' }]),
    ).toBe(false);
  });

  it('is false when $json is used with no AI ancestor', () => {
    const trig = node('trig', 'manualTrigger', 'Start');
    const tf = node('tf', 'transformNode', 'Shape');
    const ai = node('ai', 'aiPromptNode', 'Elsewhere');
    const mail = node('mail', 'sendEmailNode', 'Mail', { body: '{{ $json.text }}' });
    const edges: AutomationEdge[] = [
      { id: 'e1', source: 'trig', target: 'tf' },
      { id: 'e2', source: 'tf', target: 'mail' },
      { id: 'e3', source: 'mail', target: 'ai' },
    ];
    expect(usesAiOutput(mail, [trig, tf, ai, mail], edges)).toBe(false);
  });

  it('terminates on cyclic edges', () => {
    const a = node('a', 'transformNode', 'A');
    const b = node('b', 'transformNode', 'B');
    const mail = node('mail', 'sendEmailNode', 'Mail', { body: '{{ $json.text }}' });
    const edges: AutomationEdge[] = [
      { id: 'e1', source: 'a', target: 'b' },
      { id: 'e2', source: 'b', target: 'a' },
      { id: 'e3', source: 'b', target: 'mail' },
      { id: 'e4', source: 'mail', target: 'a' },
    ];
    expect(usesAiOutput(mail, [a, b, mail], edges)).toBe(false);
  });
});
