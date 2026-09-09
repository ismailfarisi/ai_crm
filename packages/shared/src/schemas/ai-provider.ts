import { z } from 'zod';

export const AiProviderEnum = z.enum(['OPENAI', 'ANTHROPIC', 'OPENROUTER']);
export type AiProviderType = z.infer<typeof AiProviderEnum>;

export const aiProviderConfigSchema = z.object({
  apiKey: z.string().min(1, 'API Key is required'),
  model: z.string().min(1, 'Model is required'),
});

export type AiProviderConfigPayload = z.infer<typeof aiProviderConfigSchema>;
