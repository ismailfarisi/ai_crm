import { Injectable } from '@nestjs/common';
import type {
  ChannelAiTestResultDto,
  ChannelHandoverReason,
  TestChannelAiPayload,
} from '@saas/shared';
import { AiService } from '../../ai/ai.service';
import { IntentClassifierAgent } from '../agents/intent-classifier.agent';
import { ChannelProviderType } from '../entities/channel-config.entity';
import { MessageAiIntent } from '../entities/channel-message.entity';
import { AiAgentService } from './ai-agent.service';
import { IntentAgentConfigService } from './intent-agent-config.service';

const EMPTY: Omit<ChannelAiTestResultDto, 'outcome'> = {
  intent: null,
  confidence: null,
  summary: null,
  rule: null,
  question: null,
  handoverReason: null,
  thenHandover: false,
};

/**
 * What the AI would do with a customer message, for the settings page's
 * "try a message" box.
 *
 * Follows the same decisions as the channel AI workflows for a first message
 * — classify, look for a rule, ask or hand over — but sends nothing, creates
 * nothing and stores nothing. The one real cost is the classification call.
 */
@Injectable()
export class ChannelAiPreviewService {
  private readonly classifier: IntentClassifierAgent;

  constructor(
    aiService: AiService,
    private readonly rules: AiAgentService,
    private readonly intentConfig: IntentAgentConfigService,
  ) {
    this.classifier = new IntentClassifierAgent(aiService);
  }

  async preview(
    organizationId: string,
    input: TestChannelAiPayload,
  ): Promise<ChannelAiTestResultDto> {
    const config = await this.intentConfig.getEffective(organizationId);
    const provider = input.provider as ChannelProviderType;
    // Only channels the intent agent is switched on for get questions.
    const chats = config.isEnabled && config.eligibleProviders.includes(provider);

    const read = await this.classifier.classify(
      organizationId,
      [{ role: 'customer', body: input.body }],
      chats ? (config.systemPrompt ?? undefined) : undefined,
      config.model ?? undefined,
      config.provider ?? undefined,
    );
    if (read.skipped) return { ...EMPTY, outcome: 'UNAVAILABLE' };

    const { intent, confidence, summary, clarifyingQuestion } =
      read.classification;
    const base = { ...EMPTY, intent, confidence, summary };
    const handover = (
      handoverReason: ChannelHandoverReason,
    ): ChannelAiTestResultDto => ({ ...base, outcome: 'HANDOVER', handoverReason });

    if (intent === 'HUMAN_REQUEST') return handover('HUMAN_REQUESTED');

    const rule = await this.rules.findEnabledForIntent(
      organizationId,
      intent as MessageAiIntent,
    );
    const applies =
      !!rule &&
      rule.eligibleProviders.includes(provider) &&
      confidence >= rule.confidenceThreshold;
    if (rule && applies) {
      const template = rule.config?.template;
      return {
        ...base,
        outcome: 'RULE',
        rule: {
          name: rule.name,
          actionType: rule.actionType,
          reply: typeof template === 'string' && template ? template : null,
        },
        thenHandover: intent === 'COMPLAINT',
      };
    }

    if (intent === 'COMPLAINT') return handover('COMPLAINT');
    if (chats && clarifyingQuestion) {
      return { ...base, outcome: 'ASK', question: clarifyingQuestion };
    }
    return handover(
      rule && confidence < rule.confidenceThreshold
        ? 'LOW_CONFIDENCE'
        : 'NO_AGENT',
    );
  }
}
