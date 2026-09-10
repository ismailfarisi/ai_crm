import { Logger } from '@nestjs/common';
import { AiService } from '../../ai/ai.service';
import { AiNotConfiguredException } from '../../ai/interfaces/ai-provider.interface';
import {
  channelIntentJsonSchema,
  channelIntentSchema,
  type ChannelIntent,
} from '../dto/channel-intent.schema';

export type ClassifyResult =
  | { skipped: false; classification: ChannelIntent }
  | { skipped: true };

/**
 * Always runs first for every unhandled inbound message — the only AI call
 * in this feature that's coupled 1:1 to the fixed ChannelMessage AI columns,
 * so it stays code-defined rather than a database-configurable agent.
 */
export class IntentClassifierAgent {
  private readonly logger = new Logger(IntentClassifierAgent.name);

  constructor(private readonly aiService: AiService) {}

  async classify(
    organizationId: string,
    messageBody: string,
  ): Promise<ClassifyResult> {
    try {
      const result = await this.aiService.generateStructured<unknown>(
        'channels.classify_intent',
        {
          messages: [{ role: 'user', content: messageBody }],
          jsonSchema: channelIntentJsonSchema,
          schemaName: 'channel_intent',
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
        this.logger.warn(`Channel intent classification failed, skipping: ${msg}`);
      }
      return { skipped: true };
    }
  }
}
