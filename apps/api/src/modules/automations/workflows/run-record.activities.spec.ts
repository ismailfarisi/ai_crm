import type { Repository } from 'typeorm';
import type { AutomationExecution } from '../entities/automation-execution.entity';
import type { RecordNodeResultParams } from './interfaces';
import {
  capForStorage,
  createRunRecordActivities,
} from './run-record.activities';

const TENANT = '11111111-1111-1111-1111-111111111111';
const EXEC = '22222222-2222-2222-2222-222222222222';
const WF = '33333333-3333-3333-3333-333333333333';
const APPROVAL_ID = '44444444-4444-4444-4444-444444444444';

describe('capForStorage', () => {
  it('replaces an oversized value with a truncated marker', () => {
    const capped = capForStorage('x'.repeat(20000)) as {
      truncated: boolean;
      size: number;
      preview: string;
    };
    expect(capped.truncated).toBe(true);
    expect(capped.size).toBeGreaterThan(16384);
    expect(capped.preview).toHaveLength(4096);
  });

  it('returns a small value unchanged', () => {
    const value = { a: 1, b: ['x'] };
    expect(capForStorage(value)).toBe(value);
    expect(capForStorage(undefined)).toBeUndefined();
  });
});

describe('run-record activities', () => {
  let query: jest.Mock;
  let runWithTenant: jest.Mock;
  let activities: ReturnType<typeof createRunRecordActivities>;

  const sqlCalls = () =>
    query.mock.calls.map(([sql, params]) => ({
      sql: String(sql).replace(/\s+/g, ' ').trim(),
      params: params as unknown[],
    }));
  const find = (fragment: string) =>
    sqlCalls().filter((c) => c.sql.includes(fragment));

  const base: RecordNodeResultParams = {
    executionId: EXEC,
    workflowId: WF,
    tenantId: TENANT,
    nodeId: 'node-1',
    nodeType: 'email',
    label: 'Send email',
    status: 'SUCCESS',
    output: { ok: true },
    startedAt: '2026-10-29T10:00:00.000Z',
    finishedAt: '2026-10-29T10:00:01.000Z',
    durationMs: 1000,
  };
  const approval = {
    id: APPROVAL_ID,
    kind: 'step' as const,
    title: 'Approve email',
    details: { to: 'a@b.c' },
    requestedAt: '2026-10-29T10:00:00.000Z',
    expiresAt: null,
  };

  beforeEach(() => {
    query = jest.fn().mockResolvedValue([]);
    runWithTenant = jest.fn((_tenant: string, fn: () => Promise<unknown>) =>
      fn(),
    );
    const manager = {
      transaction: jest.fn((cb: (m: { query: jest.Mock }) => unknown) =>
        cb({ query }),
      ),
    };
    activities = createRunRecordActivities({
      executions: { manager } as unknown as Repository<AutomationExecution>,
      tenantContext: { runWithTenant },
    });
  });

  it('runs inside the tenant context', async () => {
    await activities.recordNodeResultActivity(base);
    expect(runWithTenant).toHaveBeenCalledWith(TENANT, expect.any(Function));
  });

  it('merges only its own node key, with parameters and no interpolation', async () => {
    await activities.recordNodeResultActivity(base);
    const [merge] = find('jsonb_build_object');
    expect(merge.sql).toContain(
      '"nodeResults" = "nodeResults" || jsonb_build_object($1::text, $2::jsonb)',
    );
    expect(merge.params[0]).toBe('node-1');
    expect(JSON.parse(merge.params[1] as string)).toEqual({
      status: 'SUCCESS',
      label: 'Send email',
      type: 'email',
      output: { ok: true },
      startedAt: base.startedAt,
      finishedAt: base.finishedAt,
      durationMs: 1000,
    });
    expect(merge.sql).not.toContain('node-1');
  });

  it('caps oversized output in the stored result', async () => {
    await activities.recordNodeResultActivity({
      ...base,
      output: 'x'.repeat(20000),
    });
    const stored = JSON.parse(
      find('jsonb_build_object')[0].params[1] as string,
    );
    expect(stored.output.truncated).toBe(true);
  });

  it('inserts the approval idempotently on WAITING and flags the run', async () => {
    await activities.recordNodeResultActivity({
      ...base,
      status: 'WAITING',
      approval,
    });
    const [insert] = find('INSERT INTO automation_approvals');
    expect(insert.sql).toContain('ON CONFLICT (id) DO NOTHING');
    expect(insert.params[0]).toBe(APPROVAL_ID);
    // Any other pending row for the node is cancelled first (the unique index).
    const cancel = find("SET status = 'CANCELLED'")[0];
    expect(cancel.sql).toContain('id <> $4');
    const order = sqlCalls().map((c) => c.sql);
    expect(order.indexOf(cancel.sql)).toBeLessThan(
      order.indexOf(find('INSERT INTO automation_approvals')[0].sql),
    );
    // Run status is derived from the remaining PENDING approvals.
    const status = find("THEN 'WAITING_APPROVAL' ELSE 'RUNNING'")[0];
    expect(status.sql).toContain(
      "status IN ('RUNNING', 'WAITING_APPROVAL', 'UNKNOWN')",
    );
  });

  it('recording the same WAITING call twice sends the same keyed insert', async () => {
    const waiting = { ...base, status: 'WAITING' as const, approval };
    await activities.recordNodeResultActivity(waiting);
    await activities.recordNodeResultActivity(waiting);
    const inserts = find('INSERT INTO automation_approvals');
    expect(inserts).toHaveLength(2);
    expect(inserts[0].params).toEqual(inserts[1].params);
    expect(
      inserts.every((i) => i.sql.includes('ON CONFLICT (id) DO NOTHING')),
    ).toBe(true);
  });

  it.each(['SUCCESS', 'FAILED', 'SKIPPED'] as const)(
    "a %s result closes the node's pending approvals (EXPIRED if past due, else CANCELLED)",
    async (status) => {
      await activities.recordNodeResultActivity({ ...base, status });
      const [close] = find('CASE WHEN "expiresAt"');
      expect(close.sql).toContain(
        `"expiresAt" <= now() THEN 'EXPIRED' ELSE 'CANCELLED'`,
      );
      expect(close.sql).toContain(`AND status = 'PENDING'`);
      expect(close.params).toEqual([EXEC, 'node-1', TENANT]);
      expect(find('INSERT INTO automation_approvals')).toHaveLength(0);
    },
  );

  it('moves UNKNOWN, RUNNING and WAITING_APPROVAL runs only', async () => {
    await activities.recordNodeResultActivity(base);
    const status = find("THEN 'WAITING_APPROVAL' ELSE 'RUNNING'")[0];
    expect(status.sql).toContain("'UNKNOWN'");
    expect(status.params).toEqual([EXEC, TENANT]);
  });

  it('refuses an approval without a workflowId', async () => {
    await expect(
      activities.recordNodeResultActivity({
        ...base,
        workflowId: undefined,
        status: 'WAITING',
        approval,
      }),
    ).rejects.toThrow('workflowId');
  });

  it('refuses a record without a tenant', async () => {
    await expect(
      activities.recordNodeResultActivity({ ...base, tenantId: undefined }),
    ).rejects.toThrow('tenantId');
  });

  describe('recordRunFinishedActivity', () => {
    const finished = {
      executionId: EXEC,
      tenantId: TENANT,
      status: 'FAILED' as const,
      errorMessage: 'boom',
      finishedAt: '2026-10-29T10:05:00.000Z',
    };

    it('does not overwrite a terminal status', async () => {
      await activities.recordRunFinishedActivity(finished);
      const [update] = find('"finishedAt" = $3');
      expect(update.sql).toContain(
        "status NOT IN ('COMPLETED', 'FAILED', 'CANCELLED')",
      );
      expect(update.params).toEqual([
        'FAILED',
        'boom',
        finished.finishedAt,
        EXEC,
        TENANT,
      ]);
    });

    it('closes every pending approval of the run', async () => {
      await activities.recordRunFinishedActivity({
        ...finished,
        status: 'COMPLETED',
        errorMessage: undefined,
      });
      const [close] = find('CASE WHEN "expiresAt"');
      expect(close.sql).not.toContain('"nodeId"');
      expect(close.params).toEqual([EXEC, TENANT]);
      expect(runWithTenant).toHaveBeenCalledWith(TENANT, expect.any(Function));
      expect(find('"finishedAt" = $3')[0].params[1]).toBeNull();
    });
  });
});
