import { z } from 'zod';
import { AiProviderEnum } from './ai-provider';

/**
 * The model an agent runs on, when it does not want the organisation's default.
 *
 * Null means "use the organisation's default model". That is the common case
 * and the safe one: an organisation that moves from one model generation to
 * the next changes it in one place and every agent that has not opted out
 * follows.
 *
 * Nullable rather than defaulted to a literal, because a default here would be
 * a second opinion about which model is current, kept in a schema that nobody
 * revisits. The organisation's AI settings already hold that opinion.
 *
 * A blank string normalises to null so clearing the field in a form means
 * "back to the default" rather than "run on a model called empty string".
 */
export const agentModelField = z
  .string()
  .trim()
  .max(120)
  .nullish()
  .transform((value) => (value == null || value === '' ? null : value));

/** The provider an agent's model is served by; null means the default provider. */
export const agentProviderField = AiProviderEnum.nullish().transform(
  (value) => value ?? null,
);

/** One AI feature's own provider and model. */
export const aiFeatureModelSchema = z.object({
  provider: agentProviderField,
  model: z.string().trim().min(1).max(120),
});
export type AiFeatureModelPayload = z.infer<typeof aiFeatureModelSchema>;

/**
 * AI features that can run on their own model. `features` are the names the
 * API passes to its AI service; one choice covers the whole group.
 */
export const AI_MODEL_FEATURES = [
  {
    key: 'assistant',
    label: 'Assistant and automations',
    description: 'The in-app assistant and AI steps in automations.',
    features: ['automations.ai_agent', 'automation.prompt'],
  },
  {
    key: 'chat_commands',
    label: 'Chat commands',
    description:
      'Understanding what staff ask for on WhatsApp, Telegram or Slack.',
    features: [
      'channels.route_skill',
      'channels.extract_slots',
      'channels.classify_domain',
    ],
  },
  {
    key: 'agents',
    label: 'Agents',
    description:
      'Choosing which agent takes a message, and agents that have no model of their own.',
    features: ['channels.route_agent', 'channels.customer_agent'],
  },
  {
    key: 'bill_capture',
    label: 'Supplier invoice reading',
    description: 'Reading a supplier invoice photo or PDF into a draft bill.',
    features: ['bill.capture'],
  },
  {
    key: 'receipt_scan',
    label: 'Receipt scanning',
    description: 'Reading an expense receipt.',
    features: ['expense.scan_receipt'],
  },
  {
    key: 'document_templates',
    label: 'Document template design',
    description: 'Drafting a quote or invoice layout from a description.',
    features: ['document_template_generation'],
  },
] as const;

export type AiModelFeatureKey = (typeof AI_MODEL_FEATURES)[number]['key'];

/** The settings group an AI call belongs to, or undefined when it has none. */
export function aiModelFeatureKey(feature: string): AiModelFeatureKey | undefined {
  return AI_MODEL_FEATURES.find((group) =>
    (group.features as readonly string[]).includes(feature),
  )?.key;
}

export const updateAiSettingsSchema = z.object({
  defaultModel: agentModelField.optional(),
  featureModels: z.record(z.string(), aiFeatureModelSchema).optional(),
});
export type UpdateAiSettingsPayload = z.infer<typeof updateAiSettingsSchema>;

export interface AiSettingsDto {
  /** Null until an administrator picks one. */
  defaultModel: string | null;
  /** What calls fall back to now: the default, or the model a provider was set up with before models moved here. */
  effectiveDefaultModel: string | null;
  featureModels: Record<string, { provider: string | null; model: string }>;
}

export interface AiModelOptionDto {
  id: string;
  name: string;
}
