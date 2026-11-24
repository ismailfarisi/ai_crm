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
import { ChannelAgent } from './entities/channel-agent.entity';
import { ChannelThreadService } from './services/channel-thread.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { FinanceModule } from '../finance/finance.module';
import { ChannelAiPreviewService } from './services/channel-ai-preview.service';
import { ChannelAgentService } from './services/channel-agent.service';
import { ChannelAgentPreviewService } from './services/channel-agent-preview.service';
import { CustomerChannelSender } from './entities/customer-channel-sender.entity';
import { CustomerSenderService } from './services/customer-sender.service';
import { CustomerLookupService } from './services/customer-lookup.service';
import { WhatsAppDocumentService } from './services/whatsapp-document.service';
import { CatalogLookupService } from './services/catalog-lookup.service';
import { CatalogItem } from '../catalog/entities/catalog-item.entity';
import { Material } from '../catalog/entities/material.entity';
import { StockItem } from '../inventory/entities/stock-item.entity';
import { WhatsAppSendController } from './whatsapp-send.controller';
import { CustomerSendersController } from './customer-senders.controller';
import { Customer } from '../customers/entities/customer.entity';
import { Organization } from '../organizations/entities/organization.entity';
import {
  SalesOrder,
  SalesOrderLine,
} from '../orders/entities/sales-order.entity';
import { Invoice } from '../quotes/entities/invoice.entity';
import { Quote } from '../quotes/entities/quote.entity';
import { WorkOrder } from '../production/entities/work-order.entity';
import { DeliveryNote } from '../credits/entities/credit-note.entity';

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
      ChannelAgent,
      CustomerChannelSender,
      // Read by the customer agents' order and quote lookups.
      Customer,
      Organization,
      SalesOrder,
      SalesOrderLine,
      Invoice,
      Quote,
      WorkOrder,
      DeliveryNote,
      // Read by the customer agents' price and stock answers.
      CatalogItem,
      Material,
      StockItem,
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
  controllers: [
    ChannelsController,
    ChannelsWebhookController,
    CustomerSendersController,
    WhatsAppSendController,
  ],
  providers: [
    ChannelsService,
    ChannelAiPreviewService,
    ChannelThreadService,
    ChannelAgentService,
    ChannelAgentPreviewService,
    CustomerSenderService,
    CustomerLookupService,
    WhatsAppDocumentService,
    CatalogLookupService,
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
    ChannelAgentService,
    CustomerSenderService,
    CustomerLookupService,
    CatalogLookupService,
    ChannelCryptoService,
    AiAgentService,
    ProductionCheckInService,
    SkillRegistry,
    ChannelIdempotencyService,
    SkillActorService,
  ],
})
export class ChannelsModule {}
