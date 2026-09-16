import { AnthropicProvider } from '../../ai/providers/anthropic.provider';
import type { AiService } from '../../ai/ai.service';

/**
 * The provider stand-in the evals run against.
 *
 * In CI it replays what the model answered when each case was written, so the
 * suite is deterministic and a prompt change shows up as a diff in a fixture
 * file rather than as a flake. `EVAL_LIVE=true` swaps in the real provider,
 * which is how the nightly job measures whether the model still agrees.
 *
 * Either way the object it produces is shaped like `AiService`, so the router
 * under test is the real one — the seam is the provider, not the code being
 * evaluated.
 */
export interface RecordedAnswer {
  data: unknown;
  model: string;
}

export const EVAL_MODEL = 'recorded';

export function isLiveEval(): boolean {
  return (
    process.env.EVAL_LIVE === 'true' && !!process.env.EVAL_ANTHROPIC_API_KEY
  );
}

export function replayAiService(
  answers: Map<string, unknown>,
): Pick<AiService, 'generateStructured'> {
  return {
    generateStructured: async <T>(feature: string, options: unknown) => {
      const message = messageOf(options);
      const key = `${feature}::${message}`;
      if (!answers.has(key)) {
        throw new Error(
          `No recorded answer for ${key}. Add one to the fixture, or re-record with EVAL_LIVE=true.`,
        );
      }
      return Promise.resolve({
        data: answers.get(key) as T,
        model: EVAL_MODEL,
        usage: { inputTokens: 0, outputTokens: 0 },
      });
    },
  };
}

/** The live counterpart, used by the nightly accuracy run. */
export function liveAiService(): Pick<AiService, 'generateStructured'> {
  const provider = new AnthropicProvider({
    apiKey: process.env.EVAL_ANTHROPIC_API_KEY!,
    defaultModel: process.env.EVAL_MODEL ?? 'claude-sonnet-5',
  });
  return {
    generateStructured: async <T>(_feature: string, options: unknown) => {
      const result = await provider.generateStructured<T>(
        options as Parameters<typeof provider.generateStructured>[0],
      );
      return { data: result.data, model: result.model, usage: result.usage };
    },
  };
}

/**
 * The evals key answers by the message being classified, not by the whole
 * prompt: the catalogue text changes whenever a skill description is edited,
 * and a fixture keyed on that would go stale for reasons that have nothing to
 * do with the case.
 */
function messageOf(options: unknown): string {
  const content =
    (options as { messages?: { content?: unknown }[] }).messages?.[0]
      ?.content ?? '';
  const text = typeof content === 'string' ? content : JSON.stringify(content);
  const quoted =
    text.match(/Message: "([\s\S]*?)"\n/) ??
    text.match(/Message: "([\s\S]*?)"$/);
  return quoted ? quoted[1] : text;
}
