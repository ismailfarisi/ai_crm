import { Inject, Injectable, Optional } from '@nestjs/common';
import { ApprovalNotifierService } from '../approval-notifications/approval-notifier.service';
import { InjectDataSource } from '@nestjs/typeorm';
import type Redis from 'ioredis';
import { DataSource, type EntityManager } from 'typeorm';
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import type { AssistantTurnStatus } from '@saas/shared';
import type { AssistantEventInput } from '../channels/workflows/activities/agent-react.activities';
import { AssistantMessage } from './entities/assistant-message.entity';
import { AssistantTurn } from './entities/assistant-turn.entity';
import { ASSISTANT_REDIS_PUBLISHER, assistantChannel } from './assistant-redis';
import { toTurnDto } from './assistant-mappers';

const TERMINAL: AssistantTurnStatus[] = ['COMPLETED', 'REJECTED', 'TIMED_OUT', 'FAILED', 'CANCELLED'];

/**
 * The only writer of a turn's transcript and state. Rows are the stream:
 * Postgres is the source of truth, Redis only says "look again".
 */
/** Minutes an assistant approval waits on screen before its reminder. */
const ASSISTANT_REMINDER_MINUTES = 10;

@Injectable()
export class AssistantEventsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @Inject(ASSISTANT_REDIS_PUBLISHER) private readonly redis: Redis,
    @Optional() private readonly approvalNotifier?: ApprovalNotifierService,
  ) {}

  async emit(input: AssistantEventInput): Promise<void> {
    const wrote = await this.dataSource.transaction(async (manager) => {
      // Row lock: a concurrent cancel/sweep must commit before (or wait for) this write.
      const turn = await manager.findOne(AssistantTurn, {
        where: { id: input.turnId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!turn) throw new Error(`Assistant turn ${input.turnId} not found`);
      // A cancelled (or swept) turn's workflow may still be finishing an activity.
      if (TERMINAL.includes(turn.status)) return false;

      await this.insert(manager, {
        tenantId: input.organizationId,
        conversationId: input.conversationId,
        turnId: input.turnId,
        eventKey: input.eventKey,
        role: input.role,
        content: input.content,
        toolName: input.toolName ?? null,
        payload: input.payload ?? null,
      });

      // Every event is progress, so the stale sweep never fails a turn that is still emitting.
      const patch: Partial<AssistantTurn> = { lastProgressAt: new Date() };
      if (input.turn) {
        if (input.turn.status !== undefined) patch.status = input.turn.status;
        if (input.turn.pendingAction !== undefined) patch.pendingAction = input.turn.pendingAction;
        if (input.turn.steps !== undefined) patch.steps = input.turn.steps;
        if (input.turn.model !== undefined) patch.model = input.turn.model;
        if (input.turn.error !== undefined) patch.error = input.turn.error;
        if (input.turn.status && TERMINAL.includes(input.turn.status)) patch.finishedAt = new Date();
      }
      await manager.update(AssistantTurn, { id: input.turnId }, patch as QueryDeepPartialEntity<AssistantTurn>);
      if (input.turn?.status !== undefined) {
        await this.writeStatusRow(manager, turn, `${input.eventKey}:status`);
        await this.noteApprovalState(manager, turn, input);
      }
      return true;
    });
    if (wrote) this.publish(input.conversationId);
  }

  /**
   * The person chatting is watching the card, so an assistant approval only
   * gets a reminder (bell, email or their linked chat) if it is still
   * waiting a few minutes on. It is their own action: nobody else is asked.
   */
  private async noteApprovalState(
    manager: EntityManager,
    before: AssistantTurn,
    input: AssistantEventInput,
  ): Promise<void> {
    if (!this.approvalNotifier) return;
    const status = input.turn?.status;
    if (status === 'AWAITING_APPROVAL') {
      const owner: Array<{ user_id: string }> = await manager.query(
        `SELECT "user_id" FROM "assistant_conversations" WHERE "id" = $1 AND "tenant_id" = $2`,
        [input.conversationId, input.organizationId],
      );
      if (!owner[0]) return;
      const pending = input.turn?.pendingAction as
        | { tool?: { id?: string } }
        | null
        | undefined;
      await this.approvalNotifier.requested(
        {
          tenantId: input.organizationId,
          itemType: 'ASSISTANT_ACTION',
          itemId: input.turnId,
          recipientUserId: owner[0].user_id,
          permissions: [],
          title: input.content.slice(0, 200) || 'An assistant action',
          link: '/assistant',
          meta: pending?.tool?.id ? { toolCallId: pending.tool.id } : null,
          notifyNow: false,
          remindAfterMinutes: ASSISTANT_REMINDER_MINUTES,
        },
        manager,
      );
    } else if (before.status === 'AWAITING_APPROVAL') {
      await this.approvalNotifier.closed(
        input.organizationId,
        'ASSISTANT_ACTION',
        input.turnId,
        manager,
      );
    }
  }

  /** For state changes made by the API itself (cancel, stale sweep). */
  async writeStatus(turn: AssistantTurn, eventKey: string): Promise<void> {
    await this.dataSource.transaction((manager) => this.writeStatusRow(manager, turn, eventKey));
    this.publish(turn.conversationId);
  }

  publish(conversationId: string): void {
    this.redis.publish(assistantChannel(conversationId), '1').catch(() => undefined);
  }

  private async writeStatusRow(manager: EntityManager, turn: AssistantTurn, eventKey: string) {
    const fresh = await manager.findOneByOrFail(AssistantTurn, { id: turn.id });
    await this.insert(manager, {
      tenantId: fresh.tenantId,
      conversationId: fresh.conversationId,
      turnId: fresh.id,
      eventKey,
      role: 'status',
      content: fresh.status,
      toolName: null,
      payload: { turn: toTurnDto(fresh) },
    });
  }

  private async insert(manager: EntityManager, values: Partial<AssistantMessage>) {
    await manager
      .createQueryBuilder()
      .insert()
      .into(AssistantMessage)
      .values(values as QueryDeepPartialEntity<AssistantMessage>)
      .orIgnore() // (turn_id, event_key) unique: a retried activity is a no-op
      .execute();
  }
}
