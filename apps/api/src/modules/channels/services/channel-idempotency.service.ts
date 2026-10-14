import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'crypto';
import { LessThan, Repository } from 'typeorm';
import { ChannelIdempotencyRecord } from '../entities/channel-idempotency-record.entity';

/** Longer than any activity's startToCloseTimeout, so a live attempt is never taken over. */
export const DEFAULT_IDEMPOTENCY_LEASE_MS = 10 * 60 * 1000;
const MAX_KEY_LENGTH = 200;

/**
 * Thrown when another attempt holds the claim and may still be running. It is
 * an ordinary (retryable) error: Temporal retries the activity, and by then
 * the other attempt has usually recorded its result.
 */
export class IdempotencyInProgressError extends Error {
  constructor(key: string) {
    super(`Another attempt of "${key}" is still in progress`);
    this.name = 'IdempotencyInProgressError';
  }
}

/**
 * Runs a side effect at most once per (tenant, key), recording its result so
 * a retry gets the same answer back instead of repeating the work.
 *
 * Temporal retries an activity whose attempt timed out even though that
 * attempt may still be running, and retries one whose worker died after the
 * work was done but before it was reported. Neither case is visible from
 * inside the activity, so the guard lives in the database:
 *
 * 1. claim — `INSERT … ON CONFLICT DO NOTHING` a STARTED row;
 * 2. a COMPLETED row returns its recorded result;
 * 3. a STARTED row belongs to another attempt: wait (retryable error) unless
 *    its lease has expired, in which case that attempt died and the claim is
 *    taken over with a conditional UPDATE;
 * 4. on failure the claim is released, so the retry runs the work again.
 *
 * The side effects guarded here run through other services' own
 * transactions, so the record cannot commit atomically with them. The window
 * that leaves is a crash between the work and step 4's completion write; the
 * lease then lets a later attempt redo it. The result must be JSON-safe.
 */
@Injectable()
export class ChannelIdempotencyService {
  constructor(
    @InjectRepository(ChannelIdempotencyRecord)
    private readonly records: Repository<ChannelIdempotencyRecord>,
  ) {}

  async runOnce<T>(
    tenantId: string,
    rawKey: string,
    fn: () => Promise<T>,
    opts: { leaseMs?: number } = {},
  ): Promise<T> {
    const key = normaliseKey(rawKey);
    const leaseMs = opts.leaseMs ?? DEFAULT_IDEMPOTENCY_LEASE_MS;

    const claim = await this.claim(tenantId, key, leaseMs);
    if (claim.kind === 'completed') return claim.result as T;
    if (claim.kind === 'busy') throw new IdempotencyInProgressError(rawKey);

    let result: T;
    try {
      result = await fn();
    } catch (err) {
      await this.records.delete({ id: claim.id, status: 'STARTED' });
      throw err;
    }

    await this.records.update(
      { id: claim.id },
      {
        status: 'COMPLETED',
        // jsonb: TypeORM's update typing cannot express `unknown`.
        result: (result === undefined ? null : result) as never,
      },
    );
    return result;
  }

  private async claim(
    tenantId: string,
    key: string,
    leaseMs: number,
  ): Promise<
    | { kind: 'claimed'; id: string }
    | { kind: 'completed'; result: unknown }
    | { kind: 'busy' }
  > {
    const inserted = await this.records
      .createQueryBuilder()
      .insert()
      .into(ChannelIdempotencyRecord)
      .values({ tenantId, key, status: 'STARTED' })
      .orIgnore()
      .returning(['id'])
      .execute();
    const insertedId = (inserted.raw as Array<{ id: string }> | undefined)?.[0]
      ?.id;
    if (insertedId) return { kind: 'claimed', id: insertedId };

    const existing = await this.records.findOne({ where: { tenantId, key } });
    // Released between our insert and read: let the retry claim it afresh.
    if (!existing) return { kind: 'busy' };
    if (existing.status === 'COMPLETED') {
      return { kind: 'completed', result: existing.result };
    }

    const takenOver = await this.records.update(
      {
        id: existing.id,
        status: 'STARTED',
        updatedAt: LessThan(new Date(Date.now() - leaseMs)),
      },
      { updatedAt: new Date() },
    );
    return takenOver.affected
      ? { kind: 'claimed', id: existing.id }
      : { kind: 'busy' };
  }
}

function normaliseKey(key: string): string {
  if (key.length <= MAX_KEY_LENGTH) return key;
  return `sha256:${createHash('sha256').update(key).digest('hex')}`;
}
