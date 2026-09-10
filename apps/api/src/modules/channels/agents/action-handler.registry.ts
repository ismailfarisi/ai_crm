import { ChannelsService } from '../channels.service';
import { QuotesService } from '../../quotes/quotes.service';
import { AiAgentActionType } from '../entities/ai-agent.entity';
import { ActionHandler } from './types';
import { AutoAckActionHandler } from './handlers/auto-ack.handler';
import { CreateDraftQuoteActionHandler } from './handlers/create-draft-quote.handler';

/**
 * The one file to touch when adding a genuinely new action type — new
 * *instances* of an existing type (e.g. another AUTO_ACK for a different
 * intent) are a pure AiAgent CRUD/data operation, no change here needed.
 */
export function createActionHandlerRegistry(deps: {
  channelsService: ChannelsService;
  quotesService: QuotesService;
}): Record<AiAgentActionType, ActionHandler> {
  return {
    [AiAgentActionType.AUTO_ACK]: new AutoAckActionHandler(deps.channelsService),
    [AiAgentActionType.CREATE_DRAFT_QUOTE]: new CreateDraftQuoteActionHandler(
      deps.channelsService,
      deps.quotesService,
    ),
  };
}
