import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AssistantConversation } from './entities/assistant-conversation.entity';
import { AssistantTurn } from './entities/assistant-turn.entity';
import { AssistantMessage } from './entities/assistant-message.entity';

@Module({
  imports: [TypeOrmModule.forFeature([AssistantConversation, AssistantTurn, AssistantMessage])],
})
export class AssistantModule {}
