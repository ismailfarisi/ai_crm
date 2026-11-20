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
const channelAgentFields = {
  name: z.string().trim().min(1, 'Name is required').max(80),
  /** One line saying what this agent handles. The router picks an agent by this. */
  description: z.string().trim().min(1, 'Say what this agent handles').max(300),
  instructions: z.string().trim().min(1, 'Instructions are required').max(8000),
  kind: ChannelAgentKindEnum,
  /** Null uses the organisation's default model; see `agentModelField`. */
  model: agentModelField,
  /** Null uses the organisation's default provider. */
  provider: agentProviderField,
  /** Names of the tools this agent may use. */
  skills: z.array(z.string().max(60)).max(50),
  channels: z.array(ChannelProviderEnum),
  isEnabled: z.boolean(),
};

export const createChannelAgentSchema = z.object({
  ...channelAgentFields,
  skills: channelAgentFields.skills.default([]),
  channels: channelAgentFields.channels.default([]),
  isEnabled: channelAgentFields.isEnabled.default(true),
});
export type CreateChannelAgentPayload = z.infer<typeof createChannelAgentSchema>;

// Built from the fields without their defaults: a default on an update would
// overwrite whatever the request left out.
export const updateChannelAgentSchema = z.object(channelAgentFields).partial();
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

/** Tools a customer agent can be given. Staff agents take the chat skills instead. */
export const CUSTOMER_AGENT_TOOLS = [
  {
    name: 'draft_quote',
    description:
      'Draft a quote from what the customer asked for. Staff review it before anything goes to the customer.',
    isMutating: true,
  },
  {
    name: 'check_order_status',
    description:
      "Tell a customer where their own orders stand: status, what has been delivered, the date production is due and the balance to pay. Only for a sender matched to one customer; anyone else is told nothing.",
    isMutating: false,
  },
  {
    name: 'check_quote_status',
    description:
      "Tell a customer where their own quotes stand: being prepared, sent, accepted or expired, with the total once it is approved. Only for a sender matched to one customer; anyone else is told nothing.",
    isMutating: false,
  },
] as const satisfies ReadonlyArray<ChannelAgentSkillOptionDto>;

/** Try a message against the agents without sending or saving anything. */
export const testChannelAgentSchema = z.object({
  body: z.string().trim().min(1, 'Type a message to try').max(2000),
  provider: ChannelProviderEnum,
  kind: ChannelAgentKindEnum,
  /**
   * Try the message as if it came from this customer, so the order and quote
   * tools answer with their records. Left out, the sender is a stranger.
   */
  asCustomerId: z.string().uuid().nullish(),
});
export type TestChannelAgentPayload = z.infer<typeof testChannelAgentSchema>;

export type ChannelAgentTestOutcome =
  /** An agent would answer the customer. */
  | 'REPLY'
  /** A staff agent would take the command with one of its tools. */
  | 'TOOL'
  /** An agent would take it and pass the conversation to a person. */
  | 'HANDOVER'
  /** No agent fits; the message is handled as it was before agents existed. */
  | 'NO_AGENT'
  /** The AI could not be reached: no provider, no model, or over budget. */
  | 'UNAVAILABLE';

export interface ChannelAgentTestResultDto {
  outcome: ChannelAgentTestOutcome;
  /** The agent that ends up with the message. */
  agent: { id: string; name: string } | null;
  /** Agents the message passed through first, in order, with why each passed it on. */
  transfers: { from: string; to: string; reason: string }[];
  /** What the agent would write to the customer, for REPLY. */
  reply: string | null;
  /** The tool a staff agent would use, for TOOL. */
  tool: string | null;
  /** Things the agent would have done, described; nothing is done in a test. */
  actions: string[];
  /** Why the conversation would go to a person, for HANDOVER. */
  handoverSummary: string | null;
}
