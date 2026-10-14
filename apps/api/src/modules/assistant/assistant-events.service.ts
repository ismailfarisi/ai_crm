import { Inject, Injectable } from '@nestjs/common';
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
@Injectable()
export class AssistantEventsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @Inject(ASSISTANT_REDIS_PUBLISHER) private readonly redis: Redis,
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
      }
      return true;
    });
    if (wrote) this.publish(input.conversationId);
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
