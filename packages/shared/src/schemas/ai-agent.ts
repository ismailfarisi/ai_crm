import { z } from 'zod';
import { ChannelProviderEnum } from './channel';

/**
 * Hand-synced with `MessageAiIntent` in
 * apps/api/src/modules/channels/entities/channel-message.entity.ts — keep the
 * two in sync by hand, same convention as the AI structured-output schemas.
 */
export const MessageAiIntentEnum = z.enum([
  'GENERAL_QUESTION',
  'QUOTATION_REQUEST',
  'ORDER_STATUS',
  'PRICING_QUESTION',
  'COMPLAINT',
  'SUPPORT_REQUEST',
  'SCHEDULING',
  'SPAM',
  'OTHER',
]);
export type MessageAiIntent = z.infer<typeof MessageAiIntentEnum>;

/** Hand-synced with `AiAgentActionType` in ai-agent.entity.ts. */
export const AiAgentActionTypeEnum = z.enum(['AUTO_ACK', 'CREATE_DRAFT_QUOTE']);
export type AiAgentActionType = z.infer<typeof AiAgentActionTypeEnum>;

export const createAiAgentSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  intent: MessageAiIntentEnum,
  actionType: AiAgentActionTypeEnum,
  config: z.record(z.string(), z.unknown()).default({}),
  confidenceThreshold: z.number().min(0).max(1).default(0.75),
  eligibleProviders: z.array(ChannelProviderEnum).default(['EMAIL_SMTP', 'EMAIL_RESEND']),
  isEnabled: z.boolean().default(true),
});
export type CreateAiAgentPayload = z.infer<typeof createAiAgentSchema>;

export const updateAiAgentSchema = createAiAgentSchema.partial();
export type UpdateAiAgentPayload = z.infer<typeof updateAiAgentSchema>;

export interface AiAgentDto {
  id: string;
  organizationId: string;
  name: string;
  intent: MessageAiIntent;
  actionType: AiAgentActionType;
  config: Record<string, unknown>;
  confidenceThreshold: number;
  eligibleProviders: string[];
  isEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}
