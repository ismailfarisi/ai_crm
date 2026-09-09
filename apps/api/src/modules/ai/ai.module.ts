import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AiService } from './ai.service';
import { AiController } from './ai.controller';
import { AiUsageLog } from './entities/ai-usage-log.entity';
import { AiBudget } from './entities/ai-budget.entity';
import { AiConfig } from './entities/ai-config.entity';
import { AiConfigService } from './services/ai-config.service';
import { ChannelCryptoService } from '../channels/services/channel-crypto.service';

@Module({
  imports: [TypeOrmModule.forFeature([AiUsageLog, AiBudget, AiConfig])],
  controllers: [AiController],
  providers: [AiService, AiConfigService, ChannelCryptoService],
  exports: [AiService],
})
export class AiModule {}
