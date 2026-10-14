import type { CreateQuotePayload } from '@saas/shared';
import { ChannelsService } from '../../channels.service';
import { QuotesService } from '../../../quotes/quotes.service';
import { AiAgent } from '../../entities/ai-agent.entity';
import {
  ActionHandler,
  ChannelAgentContext,
  ChannelAgentResult,
} from '../types';

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

    const once =
      ctx.runOnce ?? (<T>(_step: string, fn: () => Promise<T>) => fn());

    // Each mutation is guarded on its own: a retry after the ack failed must
    // re-send the ack, not draft a second quote.
    const quote = await once('create-quote', async () => {
      const created = await this.quotesService.createQuote(
        ctx.organizationId,
        payload,
      );
      return { id: created.id };
    });

    let autoAcked = false;
    const template = agent.config?.template;
    if (template && typeof template === 'string') {
      await once('send-ack', async () => {
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
        return true;
      });
      autoAcked = true;
    }

    return { autoAcked, createdQuoteId: quote.id };
  }
}
