import { z } from 'zod';

export const AiProviderEnum = z.enum(['OPENAI', 'ANTHROPIC', 'OPENROUTER']);
export type AiProviderType = z.infer<typeof AiProviderEnum>;

/**
 * A provider is a key and nothing else. Which model runs is chosen per
 * organisation and per agent; see `ai-model.ts`.
 */
export const aiProviderConfigSchema = z.object({
  apiKey: z.string().min(1, 'API Key is required'),
});

export type AiProviderConfigPayload = z.infer<typeof aiProviderConfigSchema>;
