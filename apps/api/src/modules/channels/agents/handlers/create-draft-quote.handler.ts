import type { CreateQuotePayload } from '@saas/shared';
import { ChannelsService } from '../../channels.service';
import { QuotesService } from '../../../quotes/quotes.service';
import { AiAgent } from '../../entities/ai-agent.entity';
import { ActionHandler, ChannelAgentContext, ChannelAgentResult } from '../types';

const SYSTEM_ACTOR_ID = 'system:ai-auto-ack';

/**
 * Drafts a quote via the existing AI-mode quote pipeline (QuotesService).
 * The resulting quote lands in DRAFT/AWAITING_APPROVAL exactly as any other
 * AI-mode quote — nothing customer-facing about the quote itself goes out
 * until a human approves it via the existing QUOTE_APPROVE-gated flow.
 */
export class CreateDraftQuoteActionHandler implements ActionHandler {
  constructor(
    private readonly channelsService: ChannelsService,
    private readonly quotesService: QuotesService,
  ) {}

  async handle(
    ctx: ChannelAgentContext,
    agent: AiAgent,
  ): Promise<ChannelAgentResult> {
    const payload: CreateQuotePayload = {
      title: ctx.classification.summary || 'Quote request',
      customerEmail: ctx.senderIdentifier,
      prompt: ctx.messageBody,
      createdBy: 'AI',
    };

    const quote = await this.quotesService.createQuote(
      ctx.organizationId,
      payload,
    );

    let autoAcked = false;
    const template = agent.config?.template;
    if (template && typeof template === 'string') {
      await this.channelsService.sendMessage(
        ctx.organizationId,
        SYSTEM_ACTOR_ID,
        {
          contactId: ctx.contactId,
          provider: ctx.provider,
          recipient: ctx.senderIdentifier,
          body: template,
        },
      );
      autoAcked = true;
    }

    return { autoAcked, createdQuoteId: quote.id };
  }
}
