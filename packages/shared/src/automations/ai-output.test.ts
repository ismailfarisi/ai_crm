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
});
