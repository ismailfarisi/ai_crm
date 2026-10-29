import 'reflect-metadata';
import 'tsconfig-paths/register';
import { DataSource } from 'typeorm';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { ClsServiceManager } from 'nestjs-cls';
import { TenantContextService } from '../src/common/context/tenant-context.service';
import { TenantRlsSubscriber } from '../src/database/tenant-rls.subscriber';
import { Organization } from '../src/modules/organizations/entities/organization.entity';
import { AutomationWorkflow } from '../src/modules/automations/entities/automation-workflow.entity';
import { AutomationExecution } from '../src/modules/automations/entities/automation-execution.entity';
import { createRunRecordActivities } from '../src/modules/automations/workflows/run-record.activities';

describe('run-record activities against Postgres (e2e)', () => {
  const TENANT = 'a1000000-0000-0000-0000-0000000000f2';
  const WF = 'a1000000-0000-0000-0000-0000000000f3';
  let dataSource: DataSource;
  let tenantContext: TenantContextService;
  let activities: ReturnType<typeof createRunRecordActivities>;
  let seq = 0;

  const inTenant = <T>(fn: () => Promise<T>) =>
    tenantContext.runWithTenant(TENANT, fn);

  async function newExecution(status: string): Promise<string> {
    const id = `a1000000-0000-0000-0000-00000000${(0x1000 + ++seq).toString(16).padStart(4, '0')}`;
    await inTenant(() =>
      dataSource.query(
        `INSERT INTO automation_executions (id, "tenantId", "workflowId", "temporalWorkflowId", status)
         VALUES ($1, $2, $3, $4, $5)`,
        [id, TENANT, WF, `wf-${id}`, status],
      ),
    );
    return id;
  }
  const runStatus = async (id: string) =>
    (
      await inTenant(() =>
        dataSource.query(
          `SELECT status, "finishedAt" FROM automation_executions WHERE id = $1`,
          [id],
        ),
      )
    )[0];
  const approvalsOf = (id: string) =>
    inTenant(() =>
      dataSource.query(
        `SELECT id, status FROM automation_approvals WHERE "executionId" = $1`,
        [id],
      ),
    );
  const step = (executionId: string, extra: Record<string, unknown> = {}) => ({
    executionId,
    workflowId: WF,
    tenantId: TENANT,
    nodeId: 'node-1',
    nodeType: 'email',
    label: 'Send',
    status: 'SUCCESS' as const,
    startedAt: new Date().toISOString(),
    ...extra,
  });
  const approval = (
    expiresAt: string | null = null,
    id: string = randomUUID(),
  ) => ({
    id,
    kind: 'step' as const,
    title: 'Approve',
    details: { a: 1 },
    requestedAt: new Date().toISOString(),
    expiresAt,
  });

  beforeAll(async () => {
    tenantContext = new TenantContextService(ClsServiceManager.getClsService());
    dataSource = new DataSource({
      type: 'postgres',
      host: process.env.DB_HOST ?? 'localhost',
      port: Number(process.env.DB_PORT ?? 5433),
      username: process.env.DB_APP_USERNAME ?? 'crm_test_app',
      password: process.env.DB_APP_PASSWORD ?? 'crm_dev_password',
      database: process.env.DB_NAME ?? 'crm_test',
      entities: [join(__dirname, '../src/modules/**/entities/*.entity.ts')],
      subscribers: [TenantRlsSubscriber],
      synchronize: false,
      logging: false,
    });
    await dataSource.initialize();
    await dataSource
      .getRepository(Organization)
      .upsert({ id: TENANT, name: 'Run Record Test', slug: 'run-record-e2e' }, [
        'id',
      ]);
    await inTenant(() =>
      dataSource.query(
        `INSERT INTO automation_workflows (id, "tenantId", name) VALUES ($1, $2, 'run-record e2e')
         ON CONFLICT (id) DO NOTHING`,
        [WF, TENANT],
      ),
    );
    activities = createRunRecordActivities({
      executions: dataSource.getRepository(AutomationExecution),
      tenantContext,
    });
  });

  afterAll(async () => {
    await inTenant(async () => {
      await dataSource.query(
        `DELETE FROM automation_executions WHERE "workflowId" = $1`,
        [WF],
      );
      await dataSource.query(`DELETE FROM automation_workflows WHERE id = $1`, [
        WF,
      ]);
    });
    await dataSource.getRepository(Organization).delete({ id: TENANT });
    await dataSource.destroy();
  });

  it('turns an UNKNOWN run into RUNNING on the first step and merges one key', async () => {
    const id = await newExecution('UNKNOWN');
    await activities.recordNodeResultActivity(step(id, { nodeId: 'a' }));
    await activities.recordNodeResultActivity(step(id, { nodeId: 'b' }));
    expect((await runStatus(id)).status).toBe('RUNNING');
    const [row] = await inTenant(() =>
      dataSource.query(
        `SELECT "nodeResults" FROM automation_executions WHERE id = $1`,
        [id],
      ),
    );
    expect(Object.keys(row.nodeResults).sort()).toEqual(['a', 'b']);
    expect(row.nodeResults.a.type).toBe('email');
  });

  it('WAITING with an approval waits once, even when called twice, then SUCCESS cancels it', async () => {
    const id = await newExecution('RUNNING');
    const approvalId = randomUUID();
    const waiting = step(id, {
      status: 'WAITING',
      approval: approval(null, approvalId),
    });
    await activities.recordNodeResultActivity(waiting);
    await activities.recordNodeResultActivity(waiting);
    expect((await runStatus(id)).status).toBe('WAITING_APPROVAL');
    expect(await approvalsOf(id)).toEqual([
      { id: approvalId, status: 'PENDING' },
    ]);

    await activities.recordNodeResultActivity(step(id));
    expect(await approvalsOf(id)).toEqual([
      { id: approvalId, status: 'CANCELLED' },
    ]);
    expect((await runStatus(id)).status).toBe('RUNNING');
  });

  it('closes a past-due approval as EXPIRED', async () => {
    const id = await newExecution('RUNNING');
    await activities.recordNodeResultActivity(
      step(id, {
        status: 'WAITING',
        approval: approval(new Date(Date.now() - 1000).toISOString()),
      }),
    );
    await activities.recordNodeResultActivity(step(id, { status: 'FAILED' }));
    expect((await approvalsOf(id))[0].status).toBe('EXPIRED');
  });

  it('recordRunFinishedActivity closes pending approvals and never overwrites COMPLETED', async () => {
    const id = await newExecution('RUNNING');
    await activities.recordNodeResultActivity(
      step(id, { status: 'WAITING', approval: approval() }),
    );
    const finished = {
      executionId: id,
      tenantId: TENANT,
      finishedAt: new Date().toISOString(),
    };
    await activities.recordRunFinishedActivity({
      ...finished,
      status: 'COMPLETED',
    });
    expect((await runStatus(id)).status).toBe('COMPLETED');
    expect((await approvalsOf(id))[0].status).not.toBe('PENDING');

    await activities.recordRunFinishedActivity({
      ...finished,
      status: 'FAILED',
      errorMessage: 'late',
    });
    const after = await runStatus(id);
    expect(after.status).toBe('COMPLETED');
    expect(after.finishedAt).not.toBeNull();
  });
});
