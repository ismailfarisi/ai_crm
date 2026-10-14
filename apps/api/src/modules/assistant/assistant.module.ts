import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AssistantConversation } from './entities/assistant-conversation.entity';
import { AssistantTurn } from './entities/assistant-turn.entity';
import { AssistantMessage } from './entities/assistant-message.entity';
import { AssistantEventsService } from './assistant-events.service';
import { ASSISTANT_REDIS_PUBLISHER, createAssistantRedis } from './assistant-redis';

@Module({
  imports: [TypeOrmModule.forFeature([AssistantConversation, AssistantTurn, AssistantMessage])],
  providers: [
    AssistantEventsService,
    { provide: ASSISTANT_REDIS_PUBLISHER, useFactory: createAssistantRedis },
  ],
  exports: [AssistantEventsService],
})
export class AssistantModule {}
