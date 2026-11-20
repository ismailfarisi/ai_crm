import { z } from 'zod';
import { ChannelProviderEnum } from './channel';
import { agentModelField, agentProviderField } from './ai-model';

/** Who an agent works for: customers writing in, or linked staff giving commands. */
export const ChannelAgentKindEnum = z.enum(['CUSTOMER', 'STAFF']);
export type ChannelAgentKind = z.infer<typeof ChannelAgentKindEnum>;

/**
 * An agent an organisation defines for itself: what it handles, how it should
 * behave, the model it runs on, the tools it may use and where it answers.
 */
export const createChannelAgentSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(80),
  /** One line saying what this agent handles. The router picks an agent by this. */
  description: z.string().trim().min(1, 'Say what this agent handles').max(300),
  instructions: z.string().trim().min(1, 'Instructions are required').max(8000),
  kind: ChannelAgentKindEnum,
  /** Null uses the organisation's default model; see `agentModelField`. */
  model: agentModelField,
  /** Null uses the organisation's default provider. */
  provider: agentProviderField,
  /** Names of the chat skills this agent may use. */
  skills: z.array(z.string().max(60)).max(50).default([]),
  channels: z.array(ChannelProviderEnum).default([]),
  isEnabled: z.boolean().default(true),
});
export type CreateChannelAgentPayload = z.infer<typeof createChannelAgentSchema>;

export const updateChannelAgentSchema = createChannelAgentSchema.partial();
export type UpdateChannelAgentPayload = z.infer<typeof updateChannelAgentSchema>;

export interface ChannelAgentDto {
  id: string;
  name: string;
  description: string;
  instructions: string;
  kind: ChannelAgentKind;
  model: string | null;
  provider: string | null;
  skills: string[];
  channels: string[];
  isEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}

/** A tool an agent can be given, for the settings form. */
export interface ChannelAgentSkillOptionDto {
  name: string;
  description: string;
  /** True when the tool creates or changes a record, and so asks before acting. */
  isMutating: boolean;
}
