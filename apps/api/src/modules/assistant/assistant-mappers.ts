import type { AssistantConversationDto, AssistantMessageDto, AssistantTurnDto } from '@saas/shared';
import type { AssistantConversation } from './entities/assistant-conversation.entity';
import type { AssistantMessage } from './entities/assistant-message.entity';
import type { AssistantTurn } from './entities/assistant-turn.entity';

export const toMessageDto = (row: AssistantMessage): AssistantMessageDto => ({
  id: row.id,
  conversationId: row.conversationId,
  turnId: row.turnId,
  seq: Number(row.seq),
  role: row.role,
  content: row.content,
  toolName: row.toolName,
  payload: row.payload,
  createdAt: row.createdAt.toISOString(),
});

export const toTurnDto = (row: AssistantTurn): AssistantTurnDto => ({
  id: row.id,
  conversationId: row.conversationId,
  status: row.status,
  pendingAction: row.pendingAction,
  steps: row.steps,
  model: row.model,
  error: row.error,
  createdAt: row.createdAt.toISOString(),
  finishedAt: row.finishedAt ? row.finishedAt.toISOString() : null,
});

export const toConversationDto = (row: AssistantConversation): AssistantConversationDto => ({
  id: row.id,
  title: row.title,
  context: row.context,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
  archivedAt: row.archivedAt ? row.archivedAt.toISOString() : null,
});
