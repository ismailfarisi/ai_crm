/* One slice of the browser's API surface. Composed in ./index.ts.
 * Split out of a single 477-line module so that two feature branches adding
 * endpoints no longer edit the same two objects. */
import type {
  AiBudgetDto,
  AiBudgetStatusDto,
  UpsertAiBudgetPayload,
  AiUsageLogDto,
} from '@saas/shared';
import { apiFetch } from '../client';

export interface AiConfigDto {
  id: string | null;
  organizationId: string;
  provider: 'OPENAI' | 'ANTHROPIC' | 'OPENROUTER';
  isEnabled: boolean;
  isDefault: boolean;
  status: 'unconfigured' | 'configured' | 'error';
  credentials: { apiKey?: string; model?: string } | null;
  lastTestedAt: string | null;
  createdAt?: string;
  updatedAt?: string;
}
export interface SaveAiConfigInput {
  isEnabled?: boolean;
  credentials?: { apiKey?: string; model?: string };
}
export interface TestAiConfigResult {
  success: boolean;
  message: string;
  status: 'unconfigured' | 'configured' | 'error';
}

export const aiEndpoints = {
  ai: {
    getBudget: () => apiFetch<AiBudgetStatusDto>('/ai/budget'),
    upsertBudget: (payload: UpsertAiBudgetPayload) =>
      apiFetch<AiBudgetDto>('/ai/budget', { method: 'PATCH', body: payload }),
    listUsage: () => apiFetch<AiUsageLogDto[]>('/ai/usage'),
    listConfigs: () => apiFetch<AiConfigDto[]>('/ai/configs'),
    saveConfig: (provider: string, input: SaveAiConfigInput) =>
      apiFetch<AiConfigDto>(`/ai/configs/${provider}`, {
        method: 'POST',
        body: input,
      }),
    testConfig: (provider: string) =>
      apiFetch<TestAiConfigResult>(`/ai/configs/${provider}/test`, {
        method: 'POST',
      }),
    setDefaultConfig: (provider: string) =>
      apiFetch<AiConfigDto>(`/ai/configs/${provider}/default`, {
        method: 'POST',
      }),
  },
};

export const aiKeys = {
  aiConfigs: ['ai', 'configs'] as const,  // AI
  aiBudget: ['ai', 'budget'] as const,  aiUsage: ['ai', 'usage'] as const,};
