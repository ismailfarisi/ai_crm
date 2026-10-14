import type { DataSource, EntityManager } from 'typeorm';
import type { TenantContextService } from '../context/tenant-context.service';
import {
  EventOutboxService,
  backoffMs,
  type OutboxSettings,
} from './event-outbox.service';

const TENANT = '11111111-1111-4111-8111-111111111111';
const OTHER_TENANT = '22222222-2222-4222-8222-222222222222';

interface Harness {
  service: EventOutboxService;
  query: jest.Mock;
  /** Context each query ran under: 'system', a tenant id, or 'none'. */
  contexts: string[];
  tenantContext: {
    runWithTenant: jest.Mock;
    runAsSystem: jest.Mock;
  };
}

const settings: OutboxSettings = {
  dispatcherEnabled: true,
  pollMs: 1000,
  batchSize: 50,
  maxAttempts: 3,
  leaseMs: 300_000,
  handlerTimeoutMs: 1000,
  baseBackoffMs: 5000,
  maxBackoffMs: 900_000,
  retentionDays: 7,
};

function harness(dispatch = true, rows: unknown[] = []): Harness {
  let current = 'none';
  const contexts: string[] = [];
  const query = jest.fn(async (sql: string) => {
    contexts.push(current);
    if (/FOR UPDATE SKIP LOCKED/.test(sql)) return rows;
    return [];
  });
  const tenantContext = {
    runWithTenant: jest.fn(async (tenantId: string, fn: () => unknown) => {
      const previous = current;
      current = tenantId;
      try {
        return await fn();
      } finally {
        current = previous;
      }
    }),
    runAsSystem: jest.fn(async (fn: () => unknown) => {
      const previous = current;
      current = 'system';
      try {
        return await fn();
      } finally {
        current = previous;
      }
    }),
  };
  const service = new EventOutboxService(
    { query } as unknown as DataSource,
    tenantContext as unknown as TenantContextService,
    undefined,
    dispatch,
    settings,
  );
  return { service, query, contexts, tenantContext };
}

const claimed = (over: Record<string, unknown> = {}) => ({
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  tenant_id: TENANT,
  kind: 'crm_event',
  event_type: 'record.created',
  payload: { entityId: 'c1' },
  attempts: 1,
  ...over,
});

describe('EventOutboxService', () => {
  describe('enqueue', () => {
    it('persists the event under its own tenant and returns a stable id', async () => {
      const h = harness(false);
      const id = await h.service.enqueue({
        tenantId: TENANT,
        kind: 'crm_event',
        eventType: 'record.created',
        payload: { entityId: 'c1' },
      });

      expect(id).toMatch(/^[0-9a-f-]{36}$/);
      expect(h.query).toHaveBeenCalledTimes(1);
      const [sql, params] = h.query.mock.calls[0];
      expect(sql).toMatch(/INSERT INTO "crm_event_outbox"/);
      expect(params).toEqual([
        id,
        TENANT,
        'crm_event',
        'record.created',
        JSON.stringify({ entityId: 'c1' }),
      ]);
      // RLS: the row is written as the tenant it belongs to.
      expect(h.contexts).toEqual([TENANT]);
    });

    it('writes through the caller’s transaction when a manager is given', async () => {
      const h = harness(false);
      const managerQuery = jest.fn().mockResolvedValue([]);
      const manager = { query: managerQuery } as unknown as EntityManager;

      await h.service.enqueue(
        {
          tenantId: TENANT,
          kind: 'crm_event',
          eventType: 'record.updated',
          payload: {},
        },
        manager,
      );

      expect(managerQuery).toHaveBeenCalledWith(
        expect.stringMatching(/INSERT INTO "crm_event_outbox"/),
        expect.any(Array),
      );
      expect(h.query).not.toHaveBeenCalled();
      // The transaction already carries its tenant context.
      expect(h.tenantContext.runWithTenant).not.toHaveBeenCalled();
    });

    it('propagates an insert failure so the caller can decide', async () => {
      const h = harness(false);
      h.query.mockRejectedValueOnce(new Error('connection refused'));
      await expect(
        h.service.enqueue({
          tenantId: TENANT,
          kind: 'crm_event',
          eventType: 'record.created',
          payload: {},
        }),
      ).rejects.toThrow('connection refused');
    });
  });

  describe('dispatchOnce', () => {
    it('claims nothing when no handler is registered', async () => {
      const h = harness(true, [claimed()]);
      expect(await h.service.dispatchOnce()).toBe(0);
      expect(h.query).not.toHaveBeenCalled();
    });

    it('claims with FOR UPDATE SKIP LOCKED, as system, only kinds it can handle, and takes a lease', async () => {
      const h = harness(true, []);
      h.service.registerHandler('crm_event', jest.fn());

      await h.service.dispatchOnce();

      const [sql, params] = h.query.mock.calls[0];
      expect(sql).toMatch(/FOR UPDATE SKIP LOCKED/);
      expect(sql).toMatch(/"status" = 'PENDING'/);
      expect(sql).toMatch(/"available_at" <= now\(\)/);
      expect(sql).toMatch(/"kind" = ANY\(\$1\)/);
      // Claiming pushes available_at out by the lease and counts the attempt,
      // so a crashed dispatcher's rows come back after the lease expires.
      expect(sql).toMatch(/"attempts" = o\."attempts" \+ 1/);
      expect(sql).toMatch(/"available_at" = now\(\) \+/);
      expect(params).toEqual([['crm_event'], 50, 300]);
      expect(h.contexts[0]).toBe('system');
    });

    it('delivers each claimed event under that event’s tenant and marks it delivered', async () => {
      const rows = [
        claimed(),
        claimed({
          id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          tenant_id: OTHER_TENANT,
        }),
      ];
      const h = harness(true, rows);
      const seen: Array<{ id: string; tenant: string }> = [];
      h.service.registerHandler('crm_event', async (message) => {
        seen.push({
          id: message.id,
          tenant: h.contexts.length ? 'see-runWithTenant' : 'none',
        });
      });

      expect(await h.service.dispatchOnce()).toBe(2);

      expect(seen.map((s) => s.id)).toEqual([rows[0].id, rows[1].id]);
      expect(h.tenantContext.runWithTenant.mock.calls.map((c) => c[0])).toEqual(
        [TENANT, OTHER_TENANT],
      );
      const marks = h.query.mock.calls.filter(([sql]) =>
        /SET "status" = 'DELIVERED'/.test(sql as string),
      );
      expect(marks.map(([, params]) => (params as string[])[0])).toEqual([
        rows[0].id,
        rows[1].id,
      ]);
    });

    it('passes the stable id, kind, type and payload to the handler', async () => {
      const h = harness(true, [claimed()]);
      const handler = jest.fn().mockResolvedValue(undefined);
      h.service.registerHandler('crm_event', handler);

      await h.service.dispatchOnce();

      expect(handler).toHaveBeenCalledWith({
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        tenantId: TENANT,
        kind: 'crm_event',
        eventType: 'record.created',
        payload: { entityId: 'c1' },
        attempts: 1,
      });
    });

    it('schedules a retry with backoff and records the error when a handler fails', async () => {
      const h = harness(true, [claimed({ attempts: 2 })]);
      h.service.registerHandler('crm_event', async () => {
        throw new Error('temporal unavailable');
      });

      await h.service.dispatchOnce();

      const retry = h.query.mock.calls.find(([sql]) =>
        /SET "status" = \$2/.test(sql as string),
      );
      expect(retry).toBeDefined();
      const [, params] = retry!;
      expect(params).toEqual([
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        'PENDING',
        'temporal unavailable',
        backoffMs(2, settings) / 1000,
      ]);
      expect(
        h.query.mock.calls.some(([sql]) =>
          /'DELIVERED'/.test(sql as string),
        ),
      ).toBe(false);
    });

    it('dead-letters an event once it has used its attempts', async () => {
      const h = harness(true, [claimed({ attempts: 3 })]);
      h.service.registerHandler('crm_event', async () => {
        throw new Error('still broken');
      });

      await h.service.dispatchOnce();

      const dead = h.query.mock.calls.find(([sql]) =>
        /SET "status" = \$2/.test(sql as string),
      );
      expect((dead![1] as unknown[])[1]).toBe('DEAD');
      expect((dead![1] as unknown[])[2]).toBe('still broken');
    });

    it('treats a handler that outlives its timeout as a failure', async () => {
      const h = harness(true, [claimed()]);
      h.service.registerHandler(
        'crm_event',
        () => new Promise<void>(() => undefined),
      );

      jest.useFakeTimers();
      try {
        const run = h.service.dispatchOnce();
        await jest.advanceTimersByTimeAsync(settings.handlerTimeoutMs + 1);
        await run;
      } finally {
        jest.useRealTimers();
      }

      const retry = h.query.mock.calls.find(([sql]) =>
        /SET "status" = \$2/.test(sql as string),
      );
      expect((retry![1] as unknown[])[2]).toMatch(/timed out/);
    });

    it('keeps going when one event fails', async () => {
      const rows = [
        claimed(),
        claimed({ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }),
      ];
      const h = harness(true, rows);
      const handler = jest
        .fn()
        .mockRejectedValueOnce(new Error('first fails'))
        .mockResolvedValueOnce(undefined);
      h.service.registerHandler('crm_event', handler);

      await h.service.dispatchOnce();

      expect(handler).toHaveBeenCalledTimes(2);
      const delivered = h.query.mock.calls.filter(([sql]) =>
        /'DELIVERED'/.test(sql as string),
      );
      expect(delivered).toHaveLength(1);
      expect((delivered[0][1] as string[])[0]).toBe(rows[1].id);
    });
  });

  describe('backoffMs', () => {
    it('doubles from the base and stops at the cap', () => {
      expect(backoffMs(1, settings)).toBe(5000);
      expect(backoffMs(2, settings)).toBe(10_000);
      expect(backoffMs(3, settings)).toBe(20_000);
      expect(backoffMs(30, settings)).toBe(900_000);
    });
  });

  describe('dispatcher lifecycle', () => {
    it('does not poll in a process that was not asked to dispatch', () => {
      const h = harness(false);
      h.service.onApplicationBootstrap();
      expect(h.service.isDispatching()).toBe(false);
    });

    it('polls in a dispatching process and stops cleanly', async () => {
      const h = harness(true);
      h.service.onApplicationBootstrap();
      expect(h.service.isDispatching()).toBe(true);
      await h.service.onModuleDestroy();
      expect(h.service.isDispatching()).toBe(false);
    });
  });
});
