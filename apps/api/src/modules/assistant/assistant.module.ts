import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TemporalModule } from '../temporal/temporal.module';
import { AssistantConversation } from './entities/assistant-conversation.entity';
import { AssistantTurn } from './entities/assistant-turn.entity';
import { AssistantMessage } from './entities/assistant-message.entity';
import { AssistantEventsService } from './assistant-events.service';
import { AssistantService } from './assistant.service';
import { AssistantController } from './assistant.controller';
import { AssistantStreamHub } from './assistant-stream.hub';
import { AssistantSweepService } from './assistant-sweep.service';
import {
  ASSISTANT_REDIS_PUBLISHER,
  ASSISTANT_REDIS_SUBSCRIBER,
  createAssistantRedis,
} from './assistant-redis';

@Module({
  imports: [TypeOrmModule.forFeature([AssistantConversation, AssistantTurn, AssistantMessage]), TemporalModule],
  controllers: [AssistantController],
  providers: [
    AssistantService,
    AssistantEventsService,
    AssistantStreamHub,
    AssistantSweepService,
    { provide: ASSISTANT_REDIS_PUBLISHER, useFactory: createAssistantRedis },
    { provide: ASSISTANT_REDIS_SUBSCRIBER, useFactory: createAssistantRedis },
  ],
  exports: [AssistantEventsService],
})
export class AssistantModule {}
