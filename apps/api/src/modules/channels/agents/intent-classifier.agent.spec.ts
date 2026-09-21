import { IntentClassifierAgent } from './intent-classifier.agent';
import type { AiService } from '../../ai/ai.service';

/**
 * The model was a property of the AI provider and of nothing else, so every
 * call an organisation made ran on the same one. An agent can now name its
 * own; when it does not, the provider's default has to still apply.
 *
 * That fallback is not implemented here — the providers do
 * `options.model || this.defaultModel` — so what matters is that this passes
 * `undefined` rather than a string when the agent named nothing.
 */
describe('IntentClassifierAgent — which model it asks for', () => {
  const organizationId = '11111111-1111-1111-1111-111111111111';
  const transcript = [{ role: 'customer' as const, body: 'Where is my order?' }];

  function build() {
    const generateStructured = jest.fn().mockResolvedValue({
      // A complete classification, so the agent's own schema check passes and
      // these tests are not reading through a "skipped" path.
      data: {
        intent: 'ORDER_STATUS',
        confidence: 0.9,
        summary: 'Asking where an order is',
        suggestedReply: 'Let me check that order for you.',
        options: [
          { label: 'Track it', body: 'Here is the tracking link.' },
          { label: 'Talk to someone', body: 'Putting you through now.' },
        ],
      },
      model: 'whatever-the-provider-used',
      usage: { inputTokens: 1, outputTokens: 1 },
    });

    const agent = new IntentClassifierAgent({
      generateStructured,
    } as unknown as AiService);

    return { agent, generateStructured };
  }

  it('asks for the model the agent names', async () => {
    const { agent, generateStructured } = build();

    await agent.classify(organizationId, transcript, undefined, 'claude-opus-5');

    expect(generateStructured).toHaveBeenCalledWith(
      'channels.classify_intent',
      expect.objectContaining({ model: 'claude-opus-5' }),
      { organizationId },
    );
  });

  // The important one: an agent with no model of its own must not pin the call
  // to anything, or it would stop following the provider setting.
  it('leaves the model unset when the agent names none', async () => {
    const { agent, generateStructured } = build();

    await agent.classify(organizationId, transcript);

    const options = generateStructured.mock.calls[0][1] as { model?: string };
    expect(options.model).toBeUndefined();
  });

  it('still honours the system prompt override alongside the model', async () => {
    const { agent, generateStructured } = build();

    await agent.classify(organizationId, transcript, 'Custom prompt', 'claude-opus-5');

    expect(generateStructured).toHaveBeenCalledWith(
      'channels.classify_intent',
      expect.objectContaining({ system: 'Custom prompt', model: 'claude-opus-5' }),
      { organizationId },
    );
  });
});
