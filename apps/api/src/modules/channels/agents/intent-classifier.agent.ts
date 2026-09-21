import { Logger } from '@nestjs/common';
import { AiService } from '../../ai/ai.service';
import { AiNotConfiguredException } from '../../ai/interfaces/ai-provider.interface';
import {
  channelIntentJsonSchema,
  channelIntentSchema,
  type ChannelIntent,
} from '../dto/channel-intent.schema';

export type ClassifyResult =
  { skipped: false; classification: ChannelIntent } | { skipped: true };

export interface ChannelTranscriptTurn {
  /** 'agent' is this classifier's own past clarifying questions, not a human staff reply. */
  role: 'customer' | 'agent';
  body: string;
}

const SYSTEM_PROMPT =
  'You are classifying what a customer wants from an inbound message on a business messaging channel. ' +
  'If the message clearly states a specific need, classify it confidently and leave clarifyingQuestion out. ' +
  'If the message is vague, a bare greeting, or otherwise does not state what they actually want (e.g. just ' +
  '"hi" or "hello"), do not guess GENERAL_QUESTION with high confidence — set a low confidence score and ask ' +
  'exactly one short, specific clarifyingQuestion (e.g. "What can I help you with today?") instead of guessing.';

/**
 * Always runs first for every unhandled inbound message — the only AI call
 * in this feature that's coupled 1:1 to the fixed ChannelMessage AI columns,
 * so it stays code-defined rather than a database-configurable agent.
 *
 * Takes the running transcript (not just the latest message) so the same
 * classifier serves both the one-shot workflow (single-turn transcript) and
 * the multi-turn conversation workflow (growing transcript).
 */
export class IntentClassifierAgent {
  private readonly logger = new Logger(IntentClassifierAgent.name);

  constructor(private readonly aiService: AiService) {}

  async classify(
    organizationId: string,
    transcript: ChannelTranscriptTurn[],
    systemPromptOverride?: string,
    modelOverride?: string,
  ): Promise<ClassifyResult> {
    try {
      const result = await this.aiService.generateStructured<unknown>(
        'channels.classify_intent',
        {
          system: systemPromptOverride || SYSTEM_PROMPT,
          messages: transcript.map((turn) => ({
            role: turn.role === 'customer' ? 'user' : 'assistant',
            content: turn.body,
          })),
          jsonSchema: channelIntentJsonSchema,
          schemaName: 'channel_intent',
          // Left undefined when the agent names no model, so the provider's
          // own default applies — `options.model || this.defaultModel`.
          model: modelOverride,
        },
        { organizationId },
      );
      const parsed = channelIntentSchema.safeParse(result.data);
      if (!parsed.success) {
        this.logger.warn(
          `Channel intent classification returned an unparseable shape, skipping: ${parsed.error.message}`,
        );
        return { skipped: true };
      }
      return { skipped: false, classification: parsed.data };
    } catch (err: unknown) {
      if (err instanceof AiNotConfiguredException) {
        this.logger.warn(
          'Channel intent classification skipped: AI provider not configured',
        );
      } else {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(
          `Channel intent classification failed, skipping: ${msg}`,
        );
      }
      return { skipped: true };
    }
  }
}
