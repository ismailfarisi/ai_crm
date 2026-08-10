import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ChannelConfig } from './entities/channel-config.entity';
import { ChannelMessage } from './entities/channel-message.entity';
import { ChannelCryptoService } from './services/channel-crypto.service';
import { ChannelsService } from './channels.service';
import { ChannelsController } from './channels.controller';

@Module({
  imports: [TypeOrmModule.forFeature([ChannelConfig, ChannelMessage])],
  controllers: [ChannelsController],
  providers: [ChannelsService, ChannelCryptoService],
  exports: [ChannelsService, ChannelCryptoService],
})
export class ChannelsModule {}
