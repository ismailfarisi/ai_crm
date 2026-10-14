// assistant.service.ts
import { ConflictException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, MoreThan, QueryFailedError, Repository, IsNull } from 'typeorm';
import {
  ACTIVE_ASSISTANT_TURN_STATUSES,
  type AssistantApprovalPayload,
  type AssistantConversationDetailDto,
  type AssistantConversationDto,
  type AssistantMessageDto,
  type AssistantTurnDto,
  type CreateAssistantConversationPayload,
  type SendAssistantMessagePayload,
  type UpdateAssistantConversationPayload,
} from '@saas/shared';
import type { AuthenticatedUser } from '@/common/types/authenticated-user';
import { TemporalService } from '../temporal/temporal.service';
import { agentReActWorkflow, approvalSignal } from '../channels/workflows/agent-react.workflow';
import { AssistantConversation } from './entities/assistant-conversation.entity';
import { AssistantTurn } from './entities/assistant-turn.entity';
import { AssistantMessage } from './entities/assistant-message.entity';
import { AssistantEventsService } from './assistant-events.service';
import { toConversationDto, toMessageDto, toTurnDto } from './assistant-mappers';

export const ASSISTANT_TASK_QUEUE = 'assistant-queue';
const HISTORY_LIMIT = 20;

const isUniqueViolation = (error: unknown) =>
  error instanceof QueryFailedError && (error.driverError as { code?: string })?.code === '23505';

/**
 * Conversations are private to their owner within a tenant. RLS supplies the
 * tenant; `ownWhere` supplies the owner. Every lookup goes through it.
 */
@Injectable()
export class AssistantService {
  constructor(
    @InjectRepository(AssistantConversation) private readonly conversations: Repository<AssistantConversation>,
    @InjectRepository(AssistantTurn) private readonly turns: Repository<AssistantTurn>,
    @InjectRepository(AssistantMessage) private readonly messages: Repository<AssistantMessage>,
    private readonly temporal: TemporalService,
    private readonly events: AssistantEventsService,
  ) {}

  private ownWhere(actor: AuthenticatedUser) {
    return { tenantId: actor.organizationId, userId: actor.id };
  }

  private async ownConversation(actor: AuthenticatedUser, id: string): Promise<AssistantConversation> {
    const conversation = await this.conversations.findOne({ where: { id, ...this.ownWhere(actor) } });
    if (!conversation) throw new NotFoundException('Conversation not found');
    return conversation;
  }

  private async ownTurn(actor: AuthenticatedUser, turnId: string): Promise<AssistantTurn> {
    const turn = await this.turns.findOne({ where: { id: turnId, tenantId: actor.organizationId } });
    if (!turn) throw new NotFoundException('Turn not found');
    await this.ownConversation(actor, turn.conversationId);
    return turn;
  }

  async list(actor: AuthenticatedUser): Promise<AssistantConversationDto[]> {
    const rows = await this.conversations.find({
      where: { ...this.ownWhere(actor), archivedAt: IsNull() },
      order: { updatedAt: 'DESC' },
      take: 50,
    });
    return rows.map(toConversationDto);
  }

  async create(actor: AuthenticatedUser, body: CreateAssistantConversationPayload): Promise<AssistantConversationDto> {
    const row = this.conversations.create({ ...this.ownWhere(actor), context: body.context ?? null });
    return toConversationDto(await this.conversations.save(row));
  }

  async get(actor: AuthenticatedUser, id: string): Promise<AssistantConversationDetailDto> {
    const conversation = await this.ownConversation(actor, id);
    const [rows, activeTurn] = await Promise.all([
      this.messages.find({ where: { conversationId: id }, order: { seq: 'ASC' } }),
      this.turns.findOne({ where: { conversationId: id, status: In([...ACTIVE_ASSISTANT_TURN_STATUSES]) } }),
    ]);
    return {
      ...toConversationDto(conversation),
      messages: rows.map(toMessageDto),
      activeTurn: activeTurn ? toTurnDto(activeTurn) : null,
    };
  }

  async update(actor: AuthenticatedUser, id: string, body: UpdateAssistantConversationPayload): Promise<AssistantConversationDto> {
    const conversation = await this.ownConversation(actor, id);
    if (body.title !== undefined) conversation.title = body.title;
    if (body.archived !== undefined) conversation.archivedAt = body.archived ? new Date() : null;
    return toConversationDto(await this.conversations.save(conversation));
  }

  async messagesAfter(actor: AuthenticatedUser, conversationId: string, afterSeq: number): Promise<AssistantMessageDto[]> {
    await this.ownConversation(actor, conversationId);
    const rows = await this.messages.find({
      where: { conversationId, seq: MoreThan(String(afterSeq)) },
      order: { seq: 'ASC' },
      take: 500,
    });
    return rows.map(toMessageDto);
  }

  async sendMessage(
    actor: AuthenticatedUser,
    conversationId: string,
    body: SendAssistantMessagePayload,
  ): Promise<{ message: AssistantMessageDto; turn: AssistantTurnDto }> {
    const conversation = await this.ownConversation(actor, conversationId);

    const prior = await this.messages.find({
      where: { conversationId, role: In(['user', 'assistant']) },
      order: { seq: 'DESC' },
      take: HISTORY_LIMIT,
    });
    const history = prior.reverse().map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));

    // Turn, user message and conversation update land together or not at
    // all: a failure part-way must not leave an active turn with no message
    // (which would block the conversation until the sweep).
    let turn: AssistantTurn;
    let message: AssistantMessage;
    try {
      ({ turn, message } = await this.turns.manager.transaction(async (manager) => {
        const turns = manager.getRepository(AssistantTurn);
        const messages = manager.getRepository(AssistantMessage);
        const created = await turns.save(
          turns.create({
            tenantId: actor.organizationId,
            conversationId,
            status: 'RUNNING',
            workflowId: '',
            lastProgressAt: new Date(),
          }),
        );
        const saved = await messages.save(
          messages.create({
            tenantId: actor.organizationId,
            conversationId,
            turnId: created.id,
            role: 'user',
            content: body.content,
            payload: body.context ? { context: body.context } : null,
          }),
        );
        created.userMessageId = saved.id;
        created.workflowId = `assistant-turn-${created.id}`;
        const linked = await turns.save(created);

        if (conversation.title === 'New chat') conversation.title = body.content.slice(0, 60);
        if (body.context !== undefined) conversation.context = body.context ?? null;
        await manager.getRepository(AssistantConversation).save(conversation);
        return { turn: linked, message: saved };
      }));
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictException('The assistant is still working on your last message');
      throw error;
    }

    try {
      await this.temporal.getClient().workflow.start(agentReActWorkflow, {
        taskQueue: ASSISTANT_TASK_QUEUE,
        workflowId: turn.workflowId,
        args: [
          {
            organizationId: actor.organizationId,
            userId: actor.id,
            conversationId,
            prompt: body.content,
            history,
            ...(body.context ? { pageContext: body.context } : {}),
            eventSink: { conversationId, turnId: turn.id },
            audit: { channel: 'ASSISTANT', messageId: message.id },
            approvalTimeout: '24 hours',
            maxTurns: 6,
          },
        ],
      });
    } catch (error) {
      turn.status = 'FAILED';
      turn.error = error instanceof Error ? error.message : String(error);
      turn.finishedAt = new Date();
      turn = await this.turns.save(turn);
      await this.events.writeStatus(turn, 'start-failed:status');
    }
    this.events.publish(conversationId);
    return { message: toMessageDto(message), turn: toTurnDto(turn) };
  }

  async decide(actor: AuthenticatedUser, turnId: string, body: AssistantApprovalPayload): Promise<AssistantTurnDto> {
    const turn = await this.ownTurn(actor, turnId);
    // Conditional update is the lock: only one request wins the AWAITING_APPROVAL → RUNNING
    // transition, and only for the tool call the user was actually shown. A decision made on
    // an older card (or a different call in the same turn) matches nothing.
    const { affected } = await this.turns
      .createQueryBuilder()
      .update(AssistantTurn)
      .set({ status: 'RUNNING', lastProgressAt: new Date() })
      .where('id = :id', { id: turn.id })
      .andWhere('status = :awaiting', { awaiting: 'AWAITING_APPROVAL' })
      .andWhere(`pending_action -> 'tool' ->> 'id' = :toolCallId`, { toolCallId: body.toolCallId })
      .execute();
    if (!affected) throw new ConflictException('This action is no longer waiting for approval');
    try {
      await this.temporal
        .getClient()
        .workflow.getHandle(turn.workflowId)
        .signal(approvalSignal, {
          approved: body.approved,
          toolId: body.toolCallId,
          ...(body.note ? { note: body.note } : {}),
        });
    } catch (error) {
      await this.turns.update({ id: turn.id, status: 'RUNNING' }, { status: 'AWAITING_APPROVAL' });
      throw new ServiceUnavailableException('Could not reach the assistant worker; try again');
    }
    return toTurnDto({ ...turn, status: 'RUNNING' });
  }

  async cancel(actor: AuthenticatedUser, turnId: string): Promise<AssistantTurnDto> {
    const turn = await this.ownTurn(actor, turnId);
    const { affected } = await this.turns.update(
      { id: turn.id, status: In([...ACTIVE_ASSISTANT_TURN_STATUSES]) },
      { status: 'CANCELLED', pendingAction: null, finishedAt: new Date() },
    );
    if (!affected) throw new ConflictException('This turn has already finished');
    const cancelled = { ...turn, status: 'CANCELLED' as const, pendingAction: null, finishedAt: new Date() };
    await this.events.writeStatus(cancelled, 'cancelled:status');
    await this.temporal.getClient().workflow.getHandle(turn.workflowId).cancel().catch(() => undefined);
    return toTurnDto(cancelled);
  }
}
