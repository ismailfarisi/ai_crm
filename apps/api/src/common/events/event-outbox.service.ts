import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { DataSource, type EntityManager } from 'typeorm';
import { TenantContextService } from '../context/tenant-context.service';
import type { AppConfig } from '@/config/configuration';

/** `true` in the one process that should drain the outbox (the API). */
export const OUTBOX_DISPATCH = Symbol('OUTBOX_DISPATCH');
/** Test seam: full settings, bypassing config. */
export const OUTBOX_SETTINGS = Symbol('OUTBOX_SETTINGS');

export type OutboxStatus = 'PENDING' | 'DELIVERED' | 'DEAD';

export interface OutboxMessage<T = unknown> {
  /** Stable across redeliveries — what a subscriber dedupes on. */
  id: string;
  tenantId: string;
  kind: string;
  eventType: string;
  payload: T;
  /** 1 on the first delivery. */
  attempts: number;
}

export type OutboxHandler = (message: OutboxMessage) => Promise<void>;

export interface OutboxEnqueueInput {
  tenantId: string;
  kind: string;
  eventType: string;
  payload: unknown;
}

export interface OutboxSettings {
  dispatcherEnabled: boolean;
  pollMs: number;
  batchSize: number;
  maxAttempts: number;
  /** How long a claim hides a row from other dispatchers. */
  leaseMs: number;
  /** Shorter than the lease, so a hung handler is abandoned before re-claim. */
  handlerTimeoutMs: number;
  baseBackoffMs: number;
  maxBackoffMs: number;
  /** Delivered rows older than this are pruned. Dead rows are kept. */
  retentionDays: number;
}

const DEFAULTS: OutboxSettings = {
  dispatcherEnabled: true,
  pollMs: 1000,
  batchSize: 50,
  maxAttempts: 10,
  leaseMs: 5 * 60_000,
  handlerTimeoutMs: 2 * 60_000,
  baseBackoffMs: 5000,
  maxBackoffMs: 15 * 60_000,
  retentionDays: 7,
};

const PRUNE_EVERY_MS = 60 * 60_000;

/** Exponential: base, 2×base, 4×base … capped. `attempt` counts from 1. */
export function backoffMs(attempt: number, s: OutboxSettings): number {
  const exp = Math.min(Math.max(attempt - 1, 0), 30);
  return Math.min(s.baseBackoffMs * 2 ** exp, s.maxBackoffMs);
}

const INSERT_SQL = `INSERT INTO "crm_event_outbox" ("id", "tenant_id", "kind", "event_type", "payload") VALUES ($1, $2, $3, $4, $5::jsonb)`;

/**
 * Claims a batch. The inner SELECT … FOR UPDATE SKIP LOCKED means two
 * dispatchers never take the same row; the UPDATE then pushes `available_at`
 * out by the lease and counts the attempt, so the claim survives the end of
 * this statement without holding a transaction open while handlers run. A
 * dispatcher that dies mid-batch simply lets the lease expire.
 *
 * Wrapped in a CTE so the driver returns rows rather than `[rows, count]`.
 */
const CLAIM_SQL = `
WITH claimed AS (
  UPDATE "crm_event_outbox" o
     SET "attempts" = o."attempts" + 1,
         "available_at" = now() + make_interval(secs => $3)
   WHERE o."id" IN (
     SELECT "id" FROM "crm_event_outbox"
      WHERE "status" = 'PENDING'
        AND "available_at" <= now()
        AND "kind" = ANY($1)
      ORDER BY "available_at", "created_at"
      LIMIT $2
      FOR UPDATE SKIP LOCKED
   )
  RETURNING o."id", o."tenant_id", o."kind", o."event_type", o."payload",
            o."attempts", o."created_at"
)
SELECT * FROM claimed ORDER BY "created_at", "id"`;

const DELIVERED_SQL = `UPDATE "crm_event_outbox" SET "status" = 'DELIVERED', "delivered_at" = now(), "last_error" = NULL WHERE "id" = $1`;

const FAILED_SQL = `UPDATE "crm_event_outbox" SET "status" = $2, "last_error" = $3, "available_at" = now() + make_interval(secs => $4) WHERE "id" = $1`;

const PRUNE_SQL = `DELETE FROM "crm_event_outbox" WHERE "status" = 'DELIVERED' AND "delivered_at" < now() - make_interval(days => $1)`;

interface ClaimedRow {
  id: string;
  tenant_id: string;
  kind: string;
  event_type: string;
  payload: unknown;
  attempts: number;
}

/**
 * A transactional outbox in Postgres.
 *
 * Producers `enqueue` a row — inside their own transaction when they pass its
 * manager, so the event commits or rolls back with the change it describes.
 * A dispatcher in one process (the API, where the subscribers live) claims
 * rows with `FOR UPDATE SKIP LOCKED`, runs the handler for the row's kind
 * under the row's tenant, and marks it delivered. A failing handler is retried
 * with exponential backoff; after `maxAttempts` the row is parked as DEAD with
 * its last error, for someone to look at.
 *
 * Delivery is at-least-once: a crash after a handler ran but before the row
 * was marked delivered runs the handler again. Handlers get the row id, which
 * is stable across redeliveries, to dedupe on.
 */
@Injectable()
export class EventOutboxService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(EventOutboxService.name);
  private readonly handlers = new Map<string, OutboxHandler>();
  private readonly settings: OutboxSettings;
  private readonly dispatch: boolean;

  private timer?: NodeJS.Timeout;
  private draining?: Promise<void>;
  private rerun = false;
  private running = false;
  private lastPrune = 0;

  constructor(
    private readonly dataSource: DataSource,
    private readonly tenantContext: TenantContextService,
    @Optional() config?: ConfigService<AppConfig, true>,
    @Optional() @Inject(OUTBOX_DISPATCH) dispatch?: boolean,
    @Optional() @Inject(OUTBOX_SETTINGS) settings?: OutboxSettings,
  ) {
    const fromConfig = config?.get('events', { infer: true });
    this.settings = settings ?? { ...DEFAULTS, ...(fromConfig ?? {}) };
    this.dispatch = Boolean(dispatch) && this.settings.dispatcherEnabled;
  }

  /** One handler per kind; registering again replaces it. */
  registerHandler(kind: string, handler: OutboxHandler): () => void {
    this.handlers.set(kind, handler);
    return () => {
      if (this.handlers.get(kind) === handler) this.handlers.delete(kind);
    };
  }

  /**
   * Persists one message and returns its id. Throws if the row cannot be
   * written — the caller decides whether that should fail its own work.
   *
   * With a manager, the insert joins that transaction (and its tenant
   * context). Without one, it is written as the message's own tenant, which
   * is what the RLS policy on the table checks.
   */
  async enqueue(
    input: OutboxEnqueueInput,
    manager?: EntityManager,
  ): Promise<string> {
    const id = randomUUID();
    const params = [
      id,
      input.tenantId,
      input.kind.slice(0, 20),
      input.eventType.slice(0, 80),
      JSON.stringify(input.payload ?? null),
    ];
    if (manager) {
      await manager.query(INSERT_SQL, params);
      // No kick: the row is invisible until the caller commits, so the next
      // poll picks it up.
    } else {
      await this.tenantContext.runWithTenant(input.tenantId, () =>
        this.dataSource.query(INSERT_SQL, params),
      );
      this.kick();
    }
    return id;
  }

  isDispatching(): boolean {
    return this.timer !== undefined || this.running;
  }

  onApplicationBootstrap(): void {
    if (!this.dispatch) return;
    this.running = true;
    this.schedule();
  }

  async onModuleDestroy(): Promise<void> {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    await this.draining?.catch(() => undefined);
  }

  /** Ask for a drain soon, without waiting for the next poll. */
  kick(): void {
    if (!this.running) return;
    setImmediate(() => void this.drain());
  }

  private schedule(): void {
    if (!this.running) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.drain().finally(() => this.schedule());
    }, this.settings.pollMs);
    this.timer.unref?.();
  }

  /** Dispatch batches until one comes back short. Never overlaps itself. */
  async drain(): Promise<void> {
    if (this.draining) {
      this.rerun = true;
      return this.draining;
    }
    this.draining = (async () => {
      try {
        do {
          this.rerun = false;
          while (this.running) {
            const n = await this.dispatchOnce();
            if (n < this.settings.batchSize) break;
          }
        } while (this.rerun && this.running);
        await this.pruneIfDue();
      } catch (error) {
        this.logger.error(
          `Event outbox dispatch failed: ${messageOf(error)}`,
          error instanceof Error ? error.stack : undefined,
        );
      } finally {
        this.draining = undefined;
      }
    })();
    return this.draining;
  }

  /** Claims and delivers one batch. Returns how many rows it claimed. */
  async dispatchOnce(): Promise<number> {
    const kinds = [...this.handlers.keys()];
    if (!kinds.length) return 0;

    // Across tenants by design: the claim runs as system, each delivery then
    // runs as the tenant the event belongs to.
    const rows = (await this.tenantContext.runAsSystem(() =>
      this.dataSource.query(CLAIM_SQL, [
        kinds,
        this.settings.batchSize,
        Math.ceil(this.settings.leaseMs / 1000),
      ]),
    )) as ClaimedRow[];

    for (const row of rows) {
      await this.deliver(row);
    }
    return rows.length;
  }

  private async deliver(row: ClaimedRow): Promise<void> {
    const message: OutboxMessage = {
      id: row.id,
      tenantId: row.tenant_id,
      kind: row.kind,
      eventType: row.event_type,
      payload: row.payload,
      attempts: Number(row.attempts),
    };
    try {
      const handler = this.handlers.get(row.kind);
      if (!handler) throw new Error(`No handler for outbox kind "${row.kind}"`);
      await this.tenantContext.runWithTenant(row.tenant_id, () =>
        withTimeout(handler(message), this.settings.handlerTimeoutMs),
      );
    } catch (error) {
      await this.markFailed(message, error);
      return;
    }
    try {
      await this.tenantContext.runAsSystem(() =>
        this.dataSource.query(DELIVERED_SQL, [row.id]),
      );
    } catch (error) {
      // The handler ran; the lease will expire and it will run again. That is
      // the at-least-once half of the contract.
      this.logger.warn(
        `Delivered outbox ${row.kind} ${row.id} but could not mark it: ${messageOf(error)}`,
      );
    }
  }

  private async markFailed(
    message: OutboxMessage,
    error: unknown,
  ): Promise<void> {
    const dead = message.attempts >= this.settings.maxAttempts;
    const reason = messageOf(error).slice(0, 2000);
    const delaySecs = dead ? 0 : backoffMs(message.attempts, this.settings) / 1000;
    const log = `Outbox ${message.kind} "${message.eventType}" ${message.id} failed (attempt ${message.attempts}/${this.settings.maxAttempts}): ${reason}`;
    if (dead) this.logger.error(`${log} — giving up, parked as DEAD`);
    else this.logger.warn(`${log} — retrying in ${delaySecs}s`);
    try {
      await this.tenantContext.runAsSystem(() =>
        this.dataSource.query(FAILED_SQL, [
          message.id,
          dead ? 'DEAD' : 'PENDING',
          reason,
          delaySecs,
        ]),
      );
    } catch (markError) {
      this.logger.warn(
        `Could not record failure for outbox ${message.id}: ${messageOf(markError)} — it will be retried when its lease expires`,
      );
    }
  }

  private async pruneIfDue(): Promise<void> {
    const now = Date.now();
    if (now - this.lastPrune < PRUNE_EVERY_MS) return;
    this.lastPrune = now;
    await this.tenantContext.runAsSystem(() =>
      this.dataSource.query(PRUNE_SQL, [this.settings.retentionDays]),
    );
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`Handler timed out after ${ms}ms`)),
          ms,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
