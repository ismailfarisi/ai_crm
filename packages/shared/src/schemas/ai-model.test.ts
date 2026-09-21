import { describe, expect, it } from 'vitest';
import { agentModelField } from './ai-model';
import { createAiAgentSchema, updateAiAgentSchema } from './ai-agent';
import { upsertIntentAgentConfigSchema } from './intent-agent-config';

/**
 * The model used to be a property of the AI provider alone, applied to every
 * call the organisation made. An agent can now name its own; null means it
 * still follows the provider, which is the normal state.
 */
describe('the model an agent runs on', () => {
  it('keeps a model it is given', () => {
    expect(agentModelField.parse('claude-opus-5')).toBe('claude-opus-5');
  });

  it('treats blank as "use the provider default", not as a model', () => {
    expect(agentModelField.parse('')).toBeNull();
    expect(agentModelField.parse('   ')).toBeNull();
    expect(agentModelField.parse(null)).toBeNull();
    expect(agentModelField.parse(undefined)).toBeNull();
  });

  it('trims, so a stray space does not become a different model', () => {
    expect(agentModelField.parse('  claude-opus-5 ')).toBe('claude-opus-5');
  });

  it('refuses something too long to be a model id', () => {
    expect(() => agentModelField.parse('x'.repeat(121))).toThrow();
  });

  it('defaults to the provider on an agent that does not mention it', () => {
    const agent = createAiAgentSchema.parse({
      name: 'Order status acknowledger',
      intent: 'ORDER_STATUS',
      actionType: 'AUTO_ACK',
    });
    expect(agent.model).toBeNull();
  });

  it('carries a model an agent does name', () => {
    const agent = createAiAgentSchema.parse({
      name: 'Quote drafter',
      intent: 'QUOTATION_REQUEST',
      actionType: 'CREATE_DRAFT_QUOTE',
      model: 'claude-opus-5',
    });
    expect(agent.model).toBe('claude-opus-5');
  });

  /*
   * The distinction the update path depends on: a patch that omits `model`
   * must leave the agent's own choice alone, while one that sends null is
   * deliberately clearing it back to the provider default.
   */
  it('separates "not mentioned" from "cleared" on a patch', () => {
    const untouched = updateAiAgentSchema.parse({ name: 'Renamed' });
    expect('model' in untouched).toBe(false);

    const cleared = updateAiAgentSchema.parse({ model: null });
    expect(cleared.model).toBeNull();

    const blanked = updateAiAgentSchema.parse({ model: '' });
    expect(blanked.model).toBeNull();
  });

  it('gives the conversational agent the same field', () => {
    expect(upsertIntentAgentConfigSchema.parse({}).model).toBeNull();
    expect(
      upsertIntentAgentConfigSchema.parse({ model: 'claude-opus-5' }).model,
    ).toBe('claude-opus-5');
  });
});
