import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AiService } from './ai.service';
import { AiController } from './ai.controller';
import { AiUsageLog } from './entities/ai-usage-log.entity';
import { AiBudget } from './entities/ai-budget.entity';
import { AiConfig } from './entities/ai-config.entity';
import { AiConfigService } from './services/ai-config.service';
import { ChannelCryptoService } from '../channels/services/channel-crypto.service';
import Redis from 'ioredis';
import {
  REDIS_CLIENT_TOKEN,
  RedisBudgetGuardService,
} from './services/redis-budget-guard.service';

@Module({
  imports: [TypeOrmModule.forFeature([AiUsageLog, AiBudget, AiConfig])],
  controllers: [AiController],
  providers: [
    AiService,
    AiConfigService,
    ChannelCryptoService,
    RedisBudgetGuardService,
    {
      provide: REDIS_CLIENT_TOKEN,
      useFactory: () => {
        const redisHost = process.env.REDIS_HOST ?? 'localhost';
        const redisPort = process.env.REDIS_PORT ?? '6380';
        const redis = new Redis(
          process.env.REDIS_URL ??
            `redis://${redisHost}:${redisPort}`,
          { maxRetriesPerRequest: 1, lazyConnect: true },
        );
        redis.on('error', () => undefined);
        return redis;
      },
    },
  ],
  exports: [AiService],
})
export class AiModule {}
