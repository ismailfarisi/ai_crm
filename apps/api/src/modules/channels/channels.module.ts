import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ContactsModule } from '../contacts/contacts.module';
import { UsersModule } from '../users/users.module';
import { QuotesModule } from '../quotes/quotes.module';
import { AiModule } from '../ai/ai.module';
import { ChannelConfig } from './entities/channel-config.entity';
import { ChannelMessage } from './entities/channel-message.entity';
import { StaffChannelIdentity } from './entities/staff-channel-identity.entity';
import { ChannelLinkCode } from './entities/channel-link-code.entity';
import { ChannelConversation } from './entities/channel-conversation.entity';
import { ChannelIdempotencyRecord } from './entities/channel-idempotency-record.entity';
import { PurchasingModule } from '../purchasing/purchasing.module';
import { ProductionModule } from '../production/production.module';
import { OrdersModule } from '../orders/orders.module';
import { PayablesModule } from '../payables/payables.module';
import { StorageModule } from '../storage/storage.module';
import { SkillRegistry } from './skills/skill.registry';
import { SkillRouterService } from './skills/skill-router.service';
import { AiAgent } from './entities/ai-agent.entity';
import { IntentAgentConfig } from './entities/intent-agent-config.entity';
import { ChannelCryptoService } from './services/channel-crypto.service';
import { ChannelCommandService } from './services/channel-command.service';
import { ApprovalReplyService } from './services/approval-reply.service';
import { ChannelIdempotencyService } from './services/channel-idempotency.service';
import { AiAgentService } from './services/ai-agent.service';
import { IntentAgentConfigService } from './services/intent-agent-config.service';
import { ProductionCheckInService } from './services/production-check-in.service';
import { SkillActorService } from './services/skill-actor.service';
import { ChannelsService } from './channels.service';
import { CHANNEL_SENDER } from './skills/channel-sender.token';
import { ChannelsController } from './channels.controller';
import { ChannelsWebhookController } from './channels-webhook.controller';
import { ChannelThread } from './entities/channel-thread.entity';
import { ChannelThreadService } from './services/channel-thread.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { FinanceModule } from '../finance/finance.module';
import { ChannelAiPreviewService } from './services/channel-ai-preview.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ChannelConfig,
      ChannelMessage,
      StaffChannelIdentity,
      ChannelLinkCode,
      ChannelConversation,
      ChannelIdempotencyRecord,
      AiAgent,
      IntentAgentConfig,
      ChannelThread,
    ]),
    ContactsModule,
    UsersModule,
    QuotesModule,
    AiModule,
    PurchasingModule,
    ProductionModule,
    OrdersModule,
    PayablesModule,
    StorageModule,
    NotificationsModule,
    FinanceModule,
  ],
  controllers: [ChannelsController, ChannelsWebhookController],
  providers: [
    ChannelsService,
    ChannelAiPreviewService,
    ChannelThreadService,
    { provide: CHANNEL_SENDER, useExisting: ChannelsService },
    ChannelCryptoService,
    ChannelCommandService,
    ApprovalReplyService,
    ChannelIdempotencyService,
    SkillActorService,
    SkillRegistry,
    SkillRouterService,
    AiAgentService,
    IntentAgentConfigService,
    ProductionCheckInService,
  ],
  exports: [
    ChannelsService,
    ChannelThreadService,
    ChannelCryptoService,
    AiAgentService,
    ProductionCheckInService,
    SkillRegistry,
    ChannelIdempotencyService,
    SkillActorService,
  ],
})
export class ChannelsModule {}
