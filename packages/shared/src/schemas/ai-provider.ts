import { z } from 'zod';

export const AiProviderEnum = z.enum(['OPENAI', 'ANTHROPIC', 'OPENROUTER']);
export type AiProviderType = z.infer<typeof AiProviderEnum>;

/**
 * `model` is the organisation-wide default, not the only answer.
 *
 * It is what every AI call falls back to — the skill router, receipt scanning,
 * intent classification — none of which belong to an agent. An agent that
 * names its own model overrides it for that call and nothing else, so changing
 * the provider's model still moves everything that has not opted out.
 */
export const aiProviderConfigSchema = z.object({
  apiKey: z.string().min(1, 'API Key is required'),
  model: z.string().min(1, 'Model is required'),
});

export type AiProviderConfigPayload = z.infer<typeof aiProviderConfigSchema>;
