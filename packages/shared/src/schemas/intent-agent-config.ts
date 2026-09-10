import { z } from 'zod';
import { ChannelProviderEnum } from './channel';

export const upsertIntentAgentConfigSchema = z.object({
  isEnabled: z.boolean().default(true),
  maxTurns: z.number().int().min(1).max(10).default(5),
  replyTimeoutMinutes: z.number().int().min(1).max(1440).default(15),
  systemPrompt: z.string().trim().min(1).nullable().optional(),
  eligibleProviders: z
    .array(ChannelProviderEnum)
    .default(['TELEGRAM', 'WHATSAPP_META']),
});
export type UpsertIntentAgentConfigPayload = z.infer<
  typeof upsertIntentAgentConfigSchema
>;

export interface IntentAgentConfigDto {
  /** Absent until the org's first PATCH — GET returns usable defaults either way. */
  id?: string;
  organizationId?: string;
  isEnabled: boolean;
  maxTurns: number;
  replyTimeoutMinutes: number;
  systemPrompt: string | null;
  eligibleProviders: string[];
  createdAt?: string;
  updatedAt?: string;
}
