import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ContactsModule } from '../contacts/contacts.module';
import { ChannelConfig } from './entities/channel-config.entity';
import { ChannelMessage } from './entities/channel-message.entity';
import { ChannelCryptoService } from './services/channel-crypto.service';
import { ChannelsService } from './channels.service';
import { ChannelsController } from './channels.controller';
import { ChannelsWebhookController } from './channels-webhook.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([ChannelConfig, ChannelMessage]),
    ContactsModule,
  ],
  controllers: [ChannelsController, ChannelsWebhookController],
  providers: [ChannelsService, ChannelCryptoService],
  exports: [ChannelsService, ChannelCryptoService],
})
export class ChannelsModule {}
