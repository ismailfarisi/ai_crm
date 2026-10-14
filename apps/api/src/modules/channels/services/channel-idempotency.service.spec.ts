import { FindOperator } from 'typeorm';
import {
  ChannelIdempotencyService,
  IdempotencyInProgressError,
} from './channel-idempotency.service';

/** In-memory stand-in for channel_idempotency_records with its unique (tenant_id, key). */
function makeIdempotencyRepo() {
  const rows: any[] = [];
  let seq = 0;
  const matches = (row: any, where: Record<string, unknown>) =>
    Object.entries(where).every(([k, v]) => {
      if (v instanceof FindOperator) {
        if (v.type === 'lessThan') return row[k] < (v.value as Date);
        throw new Error(`unsupported operator ${v.type}`);
      }
      return row[k] === v;
    });

  const repo = {
    rows,
    createQueryBuilder: () => {
      const state: any = {};
      const qb: any = {
        insert: () => qb,
        into: () => qb,
        values: (v: any) => {
          state.values = v;
          return qb;
        },
        orIgnore: () => {
          state.orIgnore = true;
          return qb;
        },
        returning: () => qb,
        execute: async () => {
          const v = state.values;
          const clash = rows.some(
            (r) => r.tenantId === v.tenantId && r.key === v.key,
          );
          if (clash) {
            if (state.orIgnore) return { raw: [] };
            throw Object.assign(new Error('duplicate'), { code: '23505' });
          }
          const row = {
            id: `rec-${++seq}`,
            result: null,
            createdAt: new Date(),
            updatedAt: new Date(),
            ...v,
          };
          rows.push(row);
          return { raw: [{ id: row.id }] };
        },
      };
      return qb;
    },
    findOne: jest.fn(
      async ({ where }: any) => rows.find((r) => matches(r, where)) ?? null,
    ),
    update: jest.fn(async (where: any, patch: any) => {
      const hits = rows.filter((r) => matches(r, where));
      hits.forEach((r) => Object.assign(r, patch, { updatedAt: new Date() }));
      return { affected: hits.length };
    }),
    delete: jest.fn(async (where: any) => {
      let affected = 0;
      for (let i = rows.length - 1; i >= 0; i--) {
        if (matches(rows[i], where)) {
          rows.splice(i, 1);
          affected++;
        }
      }
      return { affected };
    }),
  };
  return repo;
}

describe('ChannelIdempotencyService', () => {
  const tenant = 'tenant-1';

  it('runs the work once and returns the recorded result on a retry', async () => {
    const repo = makeIdempotencyRepo();
    const svc = new ChannelIdempotencyService(repo as any);
    const work = jest.fn().mockResolvedValue({ quoteId: 'q-1' });

    const first = await svc.runOnce(tenant, 'k', work);
    const retry = await svc.runOnce(tenant, 'k', work);

    expect(work).toHaveBeenCalledTimes(1);
    expect(first).toEqual({ quoteId: 'q-1' });
    expect(retry).toEqual({ quoteId: 'q-1' });
    expect(repo.rows[0].status).toBe('COMPLETED');
  });

  it('releases the claim when the work fails, so a retry runs it again', async () => {
    const repo = makeIdempotencyRepo();
    const svc = new ChannelIdempotencyService(repo as any);
    const work = jest
      .fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce('ok');

    await expect(svc.runOnce(tenant, 'k', work)).rejects.toThrow('boom');
    expect(repo.rows).toHaveLength(0);
    await expect(svc.runOnce(tenant, 'k', work)).resolves.toBe('ok');
    expect(work).toHaveBeenCalledTimes(2);
  });

  it('refuses to run while another attempt holds a live claim', async () => {
    const repo = makeIdempotencyRepo();
    const svc = new ChannelIdempotencyService(repo as any);
    let release!: (v: string) => void;
    const slow = svc.runOnce(
      tenant,
      'k',
      () => new Promise<string>((r) => (release = r)),
    );
    await new Promise((r) => setImmediate(r));

    const work = jest.fn();
    await expect(svc.runOnce(tenant, 'k', work)).rejects.toBeInstanceOf(
      IdempotencyInProgressError,
    );
    expect(work).not.toHaveBeenCalled();

    release('done');
    await expect(slow).resolves.toBe('done');
    await expect(svc.runOnce(tenant, 'k', work)).resolves.toBe('done');
  });

  it('takes over a claim whose attempt died once its lease has expired', async () => {
    const repo = makeIdempotencyRepo();
    repo.rows.push({
      id: 'stale',
      tenantId: tenant,
      key: 'k',
      status: 'STARTED',
      result: null,
      updatedAt: new Date(Date.now() - 60_000),
    });
    const svc = new ChannelIdempotencyService(repo as any);

    const result = await svc.runOnce(tenant, 'k', async () => 'redone', {
      leaseMs: 1_000,
    });

    expect(result).toBe('redone');
    expect(repo.rows).toHaveLength(1);
    expect(repo.rows[0].status).toBe('COMPLETED');
  });

  it('keeps keys separate per tenant', async () => {
    const repo = makeIdempotencyRepo();
    const svc = new ChannelIdempotencyService(repo as any);
    await svc.runOnce('tenant-a', 'k', async () => 'a');
    await expect(svc.runOnce('tenant-b', 'k', async () => 'b')).resolves.toBe(
      'b',
    );
  });

  it('hashes keys longer than the column allows', async () => {
    const repo = makeIdempotencyRepo();
    const svc = new ChannelIdempotencyService(repo as any);
    await svc.runOnce(tenant, 'x'.repeat(500), async () => 1);
    expect(repo.rows[0].key.length).toBeLessThanOrEqual(200);
  });
});
