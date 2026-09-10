import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ContactsModule } from '../contacts/contacts.module';
import { QuotesModule } from '../quotes/quotes.module';
import { AiModule } from '../ai/ai.module';
import { ChannelConfig } from './entities/channel-config.entity';
import { ChannelMessage } from './entities/channel-message.entity';
import { StaffChannelIdentity } from './entities/staff-channel-identity.entity';
import { ChannelLinkCode } from './entities/channel-link-code.entity';
import { PendingChannelCommand } from './entities/pending-channel-command.entity';
import { AiAgent } from './entities/ai-agent.entity';
import { ChannelCryptoService } from './services/channel-crypto.service';
import { ChannelCommandService } from './services/channel-command.service';
import { AiAgentService } from './services/ai-agent.service';
import { ChannelsService } from './channels.service';
import { ChannelsController } from './channels.controller';
import { ChannelsWebhookController } from './channels-webhook.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ChannelConfig,
      ChannelMessage,
      StaffChannelIdentity,
      ChannelLinkCode,
      PendingChannelCommand,
      AiAgent,
    ]),
    ContactsModule,
    QuotesModule,
    AiModule,
  ],
  controllers: [ChannelsController, ChannelsWebhookController],
  providers: [
    ChannelsService,
    ChannelCryptoService,
    ChannelCommandService,
    AiAgentService,
  ],
  exports: [ChannelsService, ChannelCryptoService, AiAgentService],
})
export class ChannelsModule {}
