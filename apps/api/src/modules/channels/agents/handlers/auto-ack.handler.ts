import { ChannelsService } from '../../channels.service';
import { AiAgent } from '../../entities/ai-agent.entity';
import {
  ActionHandler,
  ChannelAgentContext,
  ChannelAgentResult,
} from '../types';

const SYSTEM_ACTOR_ID = 'system:ai-auto-ack';

/** Sends a fixed, human-authored canned template — never the AI's freeform suggested reply. */
export class AutoAckActionHandler implements ActionHandler {
  constructor(private readonly channelsService: ChannelsService) {}

  async handle(
    ctx: ChannelAgentContext,
    agent: AiAgent,
  ): Promise<ChannelAgentResult> {
    const template = agent.config?.template;
    if (!template || typeof template !== 'string') {
      return { autoAcked: false };
    }

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

    return { autoAcked: true };
  }
}
