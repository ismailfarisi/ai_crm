import 'reflect-metadata';
import 'tsconfig-paths/register';
import { DataSource } from 'typeorm';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { ClsServiceManager } from 'nestjs-cls';
import { TenantContextService } from '../src/common/context/tenant-context.service';
import { TenantRlsSubscriber } from '../src/database/tenant-rls.subscriber';
import { Organization } from '../src/modules/organizations/entities/organization.entity';
import { approvalRecipients } from '../src/modules/approval-notifications/approval-recipients';
import { ApprovalNotifierService } from '../src/modules/approval-notifications/approval-notifier.service';
import { ApprovalNoticeDispatcherService } from '../src/modules/approval-notifications/approval-notice-dispatcher.service';

describe('approval notifications against Postgres (e2e)', () => {
  const T1 = 'a1000000-0000-0000-0000-0000000000a1';
  const T2 = 'a1000000-0000-0000-0000-0000000000a2';
  const APPROVE = 'quote:approve';
  const BELOW_MARGIN = 'quote:approve_below_margin';
  let dataSource: DataSource;
  let tenantContext: TenantContextService;
  let notifier: ApprovalNotifierService;
  let dispatcher: ApprovalNoticeDispatcherService;
  const users: Record<string, string> = {};

  const inTenant = <T>(tenantId: string, fn: () => Promise<T>) =>
    tenantContext.runWithTenant(tenantId, fn);

  async function permissionId(key: string): Promise<string> {
    const [subject, action] = key.split(':');
    await dataSource.query(
      `INSERT INTO permissions (key, subject, action) VALUES ($1, $2, $3) ON CONFLICT (key) DO NOTHING`,
      [key, subject, action],
    );
    return (
      await dataSource.query(`SELECT id FROM permissions WHERE key = $1`, [key])
    )[0].id;
  }

  async function role(
    tenantId: string,
    keys: string[],
    all = false,
  ): Promise<string> {
    const id = randomUUID();
    await inTenant(tenantId, async () => {
      await dataSource.query(
        `INSERT INTO roles (id, tenant_id, name, slug, "grantsAllPermissions") VALUES ($1, $2, $3, $3, $4)`,
        [id, tenantId, `e2e-${id.slice(0, 8)}`, all],
      );
      for (const key of keys) {
        await dataSource.query(
          `INSERT INTO role_permissions ("roleId", "permissionId") VALUES ($1, $2)`,
          [id, await permissionId(key)],
        );
      }
    });
    return id;
  }

  async function user(
    name: string,
    tenantId: string,
    roleId: string,
    active = true,
  ) {
    const id = randomUUID();
    await inTenant(tenantId, async () => {
      await dataSource.query(
        `INSERT INTO users (id, tenant_id, email, "passwordHash", "firstName", "lastName", "isActive")
         VALUES ($1, $2, $3, 'x', $4, 'E2E', $5)`,
        [
          id,
          tenantId,
          `${name}-${id.slice(0, 8)}@approvals.test`,
          name,
          active,
        ],
      );
      await dataSource.query(
        `INSERT INTO user_roles ("userId", "roleId") VALUES ($1, $2)`,
        [id, roleId],
      );
    });
    users[name] = id;
  }

  const outboxFor = (requestId: string) =>
    tenantContext.runAsSystem(() =>
      dataSource.query(
        `SELECT event_type FROM crm_event_outbox WHERE kind = 'approval_notice' AND payload ->> 'requestId' = $1 ORDER BY created_at`,
        [requestId],
      ),
    );

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
    for (const [id, slug] of [
      [T1, 'approvals-e2e-1'],
      [T2, 'approvals-e2e-2'],
    ]) {
      await dataSource
        .getRepository(Organization)
        .upsert({ id, name: slug, slug }, ['id']);
    }
    const approver = await role(T1, [APPROVE]);
    const marginApprover = await role(T1, [APPROVE, BELOW_MARGIN]);
    const owner = await role(T1, [], true);
    const sales = await role(T1, ['quote:read']);
    const otherTenant = await role(T2, [APPROVE, BELOW_MARGIN]);
    await user('requester', T1, approver);
    await user('approver', T1, approver);
    await user('margin', T1, marginApprover);
    await user('owner', T1, owner);
    await user('sales', T1, sales);
    await user('inactive', T1, approver, false);
    await user('elsewhere', T2, otherTenant);

    // Callers run inside a request's or an activity's tenant context.
    const raw = new ApprovalNotifierService(dataSource);
    notifier = {
      requested: (i, m) => inTenant(i.tenantId, () => raw.requested(i, m)),
      decided: (i, m) => inTenant(i.tenantId, () => raw.decided(i, m)),
    } as ApprovalNotifierService;
    dispatcher = new ApprovalNoticeDispatcherService(
      dataSource,
      { registerHandler: jest.fn() } as never,
      tenantContext,
      {} as never,
      {} as never,
      {} as never,
      { get: () => 'http://localhost:3000' } as never,
    );
  });

  afterAll(async () => {
    for (const tenantId of [T1, T2]) {
      await inTenant(tenantId, async () => {
        await dataSource.query(
          `DELETE FROM approval_requests WHERE tenant_id = $1`,
          [tenantId],
        );
        await dataSource.query(
          `DELETE FROM crm_event_outbox WHERE tenant_id = $1`,
          [tenantId],
        );
        await dataSource.query(
          `DELETE FROM user_roles WHERE "userId" IN (SELECT id FROM users WHERE tenant_id = $1)`,
          [tenantId],
        );
        await dataSource.query(`DELETE FROM users WHERE tenant_id = $1`, [
          tenantId,
        ]);
        await dataSource.query(
          `DELETE FROM role_permissions WHERE "roleId" IN (SELECT id FROM roles WHERE tenant_id = $1)`,
          [tenantId],
        );
        await dataSource.query(`DELETE FROM roles WHERE tenant_id = $1`, [
          tenantId,
        ]);
      });
      await dataSource.getRepository(Organization).delete({ id: tenantId });
    }
    await dataSource.destroy();
  });

  describe('recipient selection', () => {
    const names = (ids: string[]) =>
      ids.map((id) => Object.keys(users).find((n) => users[n] === id)).sort();

    it('asks active holders of the permission in this tenant, not the requester', async () => {
      const ids = await inTenant(T1, () =>
        approvalRecipients(dataSource.manager, T1, [APPROVE], users.requester),
      );
      expect(names(ids)).toEqual(['approver', 'margin', 'owner']);
    });

    it('needs every permission: a margin breach goes only to override holders', async () => {
      const ids = await inTenant(T1, () =>
        approvalRecipients(
          dataSource.manager,
          T1,
          [APPROVE, BELOW_MARGIN],
          users.requester,
        ),
      );
      expect(names(ids)).toEqual(['margin', 'owner']);
    });

    it('never crosses tenants, even with RLS bypassed', async () => {
      const ids = await tenantContext.runAsSystem(() =>
        approvalRecipients(dataSource.manager, T2, [APPROVE], null),
      );
      expect(names(ids)).toEqual(['elsewhere']);
    });
  });

  describe('recording requests', () => {
    const input = (itemId: string, extra: Record<string, unknown> = {}) => ({
      tenantId: T1,
      itemType: 'QUOTE' as const,
      itemId,
      requestedByUserId: users.requester,
      permissions: [APPROVE] as never,
      title: 'QT-E2E',
      ...extra,
    });

    it('records one pending request and one notice per item, however often it is asked', async () => {
      const itemId = randomUUID();
      const first = await notifier.requested(input(itemId));
      const again = await notifier.requested(input(itemId));
      expect(first).toBeTruthy();
      expect(again).toBeNull();
      expect(await outboxFor(first!)).toEqual([
        { event_type: 'approval.requested' },
      ]);
    });

    it('queues one decision notice, and a second decision changes nothing', async () => {
      const itemId = randomUUID();
      const id = await notifier.requested(input(itemId));
      const decision = {
        tenantId: T1,
        itemType: 'QUOTE' as const,
        itemId,
        outcome: 'APPROVED' as const,
        decidedByUserId: users.approver,
      };
      await notifier.decided(decision);
      await notifier.decided({ ...decision, outcome: 'REJECTED' });
      expect(await outboxFor(id!)).toEqual([
        { event_type: 'approval.requested' },
        { event_type: 'approval.decided' },
      ]);
      const [row] = await inTenant(T1, () =>
        dataSource.query(`SELECT status FROM approval_requests WHERE id = $1`, [
          id,
        ]),
      );
      expect(row.status).toBe('APPROVED');
    });

    it('rolls back with the caller, and never fails it', async () => {
      const itemId = randomUUID();
      await expect(
        inTenant(T1, () =>
          dataSource.transaction(async (m) => {
            await notifier.requested(input(itemId), m);
            // A broken notice is swallowed inside its savepoint; the caller's
            // transaction carries on.
            await notifier.requested(
              { ...input(randomUUID()), title: null as never },
              m,
            );
            await m.query('SELECT 1');
            throw new Error('caller failed');
          }),
        ),
      ).rejects.toThrow('caller failed');
      const rows = await inTenant(T1, () =>
        dataSource.query(`SELECT 1 FROM approval_requests WHERE item_id = $1`, [
          itemId,
        ]),
      );
      expect(rows).toHaveLength(0);
    });
  });

  describe('reminders', () => {
    const pending = async (extra: Record<string, unknown> = {}) =>
      (await notifier.requested({
        tenantId: T1,
        itemType: 'AUTOMATION_APPROVAL',
        itemId: randomUUID(),
        permissions: ['automation:approve'] as never,
        title: 'Step',
        ...extra,
      }))!;
    const remindAt = async (id: string) =>
      (
        await inTenant(T1, () =>
          dataSource.query(
            `SELECT remind_at, expires_at, requested_at FROM approval_requests WHERE id = $1`,
            [id],
          ),
        )
      )[0];
    const makeDue = (id: string) =>
      inTenant(T1, () =>
        dataSource.query(
          `UPDATE approval_requests SET remind_at = now() - interval '1 minute' WHERE id = $1`,
          [id],
        ),
      );

    it('uses the organisation delay, or four hours by default', async () => {
      const id = await pending();
      const row = await remindAt(id);
      const minutes =
        (row.remind_at.getTime() - row.requested_at.getTime()) / 60000;
      expect(Math.round(minutes)).toBe(240);
    });

    it('reminds before an automation approval times out', async () => {
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
      const id = await pending({ expiresAt });
      const row = await remindAt(id);
      expect(row.remind_at.getTime()).toBeLessThan(expiresAt.getTime());
    });

    it('queues one reminder, however often the schedule runs', async () => {
      const id = await pending();
      await makeDue(id);
      await dispatcher.queueDueReminders();
      await dispatcher.queueDueReminders();
      expect(await outboxFor(id)).toEqual([
        { event_type: 'approval.requested' },
        { event_type: 'approval.reminder' },
      ]);
    });

    it('sends no reminder once a decision has arrived', async () => {
      const itemId = randomUUID();
      const id = await pending({ itemId });
      await makeDue(id);
      await notifier.decided({
        tenantId: T1,
        itemType: 'AUTOMATION_APPROVAL',
        itemId,
        outcome: 'REJECTED',
      });
      await dispatcher.queueDueReminders();
      expect(
        (await outboxFor(id)).map((r: { event_type: string }) => r.event_type),
      ).not.toContain('approval.reminder');
    });
  });
});
