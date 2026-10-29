import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { WorkflowNotFoundError } from '@temporalio/client';
import type {
  ApprovalAlreadyDecidedBody,
  AutomationApprovalDto,
} from '@saas/shared';
import { AutomationApprovalsService } from './automation-approvals.service';
import { AutomationApproval } from '../entities/automation-approval.entity';
import { AutomationExecution } from '../entities/automation-execution.entity';
import { User } from '../../users/entities/user.entity';
import { TemporalService } from '../../temporal/temporal.service';
import { approveNodeSignal, rejectNodeSignal } from '../workflows/interfaces';

const TENANT = '11111111-1111-1111-1111-111111111111';
const OTHER_TENANT = '22222222-2222-2222-2222-222222222222';

/**
 * In-memory stand-in for the two tables. Its raw UPDATEs honour their WHERE
 * clauses (`status = 'PENDING'` and so on), which is what the race tests need.
 */
function makeStore() {
  const approvals = new Map<string, any>();
  const executions = new Map<string, any>();

  const matches = (row: any, where: Record<string, unknown>) =>
    Object.entries(where).every(([k, v]) => {
      if (v && typeof v === 'object' && '_value' in (v as any)) {
        return ((v as any)._value as unknown[]).includes(row[k]);
      }
      return row[k] === v;
    });
  const withExecution = (row: any) => {
    const execution = executions.get(row.executionId);
    return { ...row, execution: execution ? { ...execution } : undefined };
  };
  const sorted = (rows: any[], order?: Record<string, 'ASC' | 'DESC'>) => {
    if (!order?.requestedAt) return rows;
    const dir = order.requestedAt === 'ASC' ? 1 : -1;
    return [...rows].sort(
      (a, b) => dir * (a.requestedAt.getTime() - b.requestedAt.getTime()),
    );
  };

  const approvalRepo = {
    findOne: jest.fn(async ({ where, order, relations }: any) => {
      const row = sorted(
        [...approvals.values()].filter((r) => matches(r, where)),
        order,
      )[0];
      if (!row) return null;
      return relations ? withExecution(row) : { ...row };
    }),
    find: jest.fn(async ({ where, order, take, relations }: any) => {
      const rows = sorted(
        [...approvals.values()].filter((r) => matches(r, where)),
        order,
      ).slice(0, take ?? Infinity);
      return rows.map((r) => (relations ? withExecution(r) : { ...r }));
    }),
    count: jest.fn(
      async ({ where }: any) =>
        [...approvals.values()].filter((r) => matches(r, where)).length,
    ),
    query: jest.fn(async (sql: string, params: any[]) => {
      if (sql.includes('"decidedAt" = now()')) {
        const [status, userId, comment, id, tenantId] = params;
        const row = approvals.get(id);
        if (!row || row.tenantId !== tenantId || row.status !== 'PENDING') {
          return [[], 0];
        }
        Object.assign(row, {
          status,
          decidedByUserId: userId,
          decidedAt: new Date('2026-10-29T10:00:00.000Z'),
          comment,
        });
        return [[{ ...row }], 1];
      }
      if (sql.includes("SET status = 'PENDING'")) {
        const [id, tenantId, status, userId] = params;
        const row = approvals.get(id);
        if (
          row &&
          row.tenantId === tenantId &&
          row.status === status &&
          row.decidedByUserId === userId
        ) {
          Object.assign(row, {
            status: 'PENDING',
            decidedByUserId: null,
            decidedAt: null,
            comment: null,
          });
          return [[], 1];
        }
        return [[], 0];
      }
      if (sql.includes("'EXPIRED' ELSE 'CANCELLED'")) {
        const [id, tenantId] = params;
        const row = approvals.get(id);
        if (!row || row.tenantId !== tenantId || row.status !== 'PENDING') {
          return [[], 0];
        }
        row.status =
          row.expiresAt && row.expiresAt.getTime() <= Date.now()
            ? 'EXPIRED'
            : 'CANCELLED';
        return [[{ ...row }], 1];
      }
      throw new Error(`Unexpected approvals query: ${sql}`);
    }),
  };

  const executionRepo = {
    findOne: jest.fn(async ({ where }: any) => {
      const row = [...executions.values()].find((r) => matches(r, where));
      return row ? { ...row } : null;
    }),
    query: jest.fn(async (sql: string, params: any[]) => {
      if (sql.includes("SET status = 'RUNNING'")) {
        const [id, tenantId] = params;
        const exec = executions.get(id);
        const anyPending = [...approvals.values()].some(
          (a) =>
            a.executionId === id &&
            a.tenantId === tenantId &&
            a.status === 'PENDING',
        );
        if (
          exec &&
          exec.tenantId === tenantId &&
          exec.status === 'WAITING_APPROVAL' &&
          !anyPending
        ) {
          exec.status = 'RUNNING';
          return [[], 1];
        }
        return [[], 0];
      }
      throw new Error(`Unexpected executions query: ${sql}`);
    }),
  };

  return { approvals, executions, approvalRepo, executionRepo };
}

describe('AutomationApprovalsService', () => {
  let service: AutomationApprovalsService;
  let store: ReturnType<typeof makeStore>;
  let handle: { query: jest.Mock; signal: jest.Mock };
  let users: { find: jest.Mock };

  const execution = (over: Record<string, any> = {}) => ({
    id: 'exec-1',
    tenantId: TENANT,
    workflowId: 'wf-1',
    temporalWorkflowId: 'automation-exec-exec-1',
    status: 'WAITING_APPROVAL',
    triggerSource: 'webhook',
    triggerPayload: {},
    nodeResults: {},
    workflow: { id: 'wf-1', name: 'Big deal sign-off' },
    ...over,
  });

  const approval = (over: Record<string, any> = {}) => ({
    id: 'appr-1',
    tenantId: TENANT,
    executionId: 'exec-1',
    workflowId: 'wf-1',
    nodeId: 'node-approve',
    kind: 'step',
    title: 'Manager sign-off',
    details: { message: 'Over 50k' },
    status: 'PENDING',
    requestedAt: new Date('2026-10-29T09:00:00.000Z'),
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    decidedByUserId: null,
    decidedAt: null,
    comment: null,
    ...over,
  });

  const liveWaitingOn = (...nodeIds: string[]) => ({
    status: 'WAITING_APPROVAL',
    nodeResults: {},
    pendingApprovals: Object.fromEntries(
      nodeIds.map((nodeId) => [nodeId, { nodeId }]),
    ),
  });

  const conflictBody = async (
    p: Promise<unknown>,
  ): Promise<ApprovalAlreadyDecidedBody> => {
    try {
      await p;
    } catch (err) {
      expect(err).toBeInstanceOf(ConflictException);
      return (
        err as ConflictException
      ).getResponse() as ApprovalAlreadyDecidedBody;
    }
    throw new Error('expected a 409');
  };

  beforeEach(async () => {
    store = makeStore();
    store.executions.set('exec-1', execution());
    store.approvals.set('appr-1', approval());

    handle = {
      query: jest.fn().mockResolvedValue(liveWaitingOn('node-approve')),
      signal: jest.fn().mockResolvedValue(undefined),
    };
    const client = {
      workflow: { getHandle: jest.fn().mockReturnValue(handle) },
    };
    users = {
      find: jest.fn(async ({ where }: any) =>
        [
          { id: 'user-ana', firstName: 'Ana', lastName: 'Silva' },
          { id: 'user-bo', firstName: 'Bo', lastName: 'Chen' },
        ].filter((u) => where.id._value.includes(u.id)),
      ),
    };

    const module = await Test.createTestingModule({
      providers: [
        AutomationApprovalsService,
        {
          provide: getRepositoryToken(AutomationApproval),
          useValue: store.approvalRepo,
        },
        {
          provide: getRepositoryToken(AutomationExecution),
          useValue: store.executionRepo,
        },
        { provide: getRepositoryToken(User), useValue: users },
        {
          provide: TemporalService,
          useValue: { getClient: jest.fn().mockResolvedValue(client) },
        },
      ],
    }).compile();
    service = module.get(AutomationApprovalsService);
  });

  describe('decide', () => {
    it('approves: claims the row, signals who decided, and returns the decider', async () => {
      const dto = await service.decide(
        TENANT,
        'appr-1',
        { id: 'user-ana' },
        {
          action: 'APPROVE',
          comment: 'Fine by me',
        },
      );

      expect(handle.signal).toHaveBeenCalledWith(approveNodeSignal, {
        nodeId: 'node-approve',
        approvedBy: 'user-ana',
        comment: 'Fine by me',
      });
      expect(dto).toMatchObject({
        id: 'appr-1',
        status: 'APPROVED',
        decidedBy: { id: 'user-ana', name: 'Ana Silva' },
        decidedAt: '2026-10-29T10:00:00.000Z',
        comment: 'Fine by me',
        workflowName: 'Big deal sign-off',
        triggerSource: 'webhook',
        triggerSummary: 'Webhook',
      });
      expect(store.approvals.get('appr-1').status).toBe('APPROVED');
    });

    it('rejects with the comment as the reason', async () => {
      await service.decide(
        TENANT,
        'appr-1',
        { id: 'user-ana' },
        {
          action: 'REJECT',
          comment: 'Too expensive',
        },
      );
      expect(handle.signal).toHaveBeenCalledWith(rejectNodeSignal, {
        nodeId: 'node-approve',
        rejectedBy: 'user-ana',
        reason: 'Too expensive',
      });
      expect(store.approvals.get('appr-1')).toMatchObject({
        status: 'REJECTED',
        comment: 'Too expensive',
      });
    });

    it('the first decision wins; a concurrent second gets 409 naming the first decider', async () => {
      const results = await Promise.allSettled([
        service.decide(
          TENANT,
          'appr-1',
          { id: 'user-ana' },
          { action: 'APPROVE' },
        ),
        service.decide(
          TENANT,
          'appr-1',
          { id: 'user-bo' },
          { action: 'REJECT' },
        ),
      ]);

      const won = results.filter(
        (r): r is PromiseFulfilledResult<AutomationApprovalDto> =>
          r.status === 'fulfilled',
      );
      const lost = results.filter(
        (r): r is PromiseRejectedResult => r.status === 'rejected',
      );
      expect(won).toHaveLength(1);
      expect(lost).toHaveLength(1);
      expect(handle.signal).toHaveBeenCalledTimes(1);

      const winner = won[0].value;
      const error = lost[0].reason as ConflictException;
      expect(error).toBeInstanceOf(ConflictException);
      expect(error.getResponse()).toEqual({
        message: 'Already decided',
        status: winner.status,
        decidedBy: winner.decidedBy,
        decidedAt: winner.decidedAt,
      });
      expect(store.approvals.get('appr-1').decidedByUserId).toBe(
        winner.decidedBy?.id,
      );
    });

    it('an already decided row answers 409 with who decided, without asking Temporal', async () => {
      store.approvals.set(
        'appr-1',
        approval({
          status: 'REJECTED',
          decidedByUserId: 'user-bo',
          decidedAt: new Date('2026-10-29T09:30:00.000Z'),
        }),
      );
      const body = await conflictBody(
        service.decide(
          TENANT,
          'appr-1',
          { id: 'user-ana' },
          { action: 'APPROVE' },
        ),
      );
      expect(body).toEqual({
        message: 'Already decided',
        status: 'REJECTED',
        decidedBy: { id: 'user-bo', name: 'Bo Chen' },
        decidedAt: '2026-10-29T09:30:00.000Z',
      });
      expect(handle.query).not.toHaveBeenCalled();
    });

    it('an expired or cancelled row answers 409 "No longer pending"', async () => {
      store.approvals.set('appr-1', approval({ status: 'EXPIRED' }));
      const body = await conflictBody(
        service.decide(
          TENANT,
          'appr-1',
          { id: 'user-ana' },
          { action: 'APPROVE' },
        ),
      );
      expect(body).toEqual({
        message: 'No longer pending',
        status: 'EXPIRED',
        decidedBy: null,
        decidedAt: null,
      });
    });

    it('a failed signal puts the row back to PENDING and answers 503', async () => {
      handle.signal.mockRejectedValueOnce(new Error('connection lost'));

      await expect(
        service.decide(
          TENANT,
          'appr-1',
          { id: 'user-ana' },
          {
            action: 'APPROVE',
            comment: 'ok',
          },
        ),
      ).rejects.toThrow(
        new ServiceUnavailableException(
          'Unable to deliver the approval decision to the workflow',
        ),
      );
      expect(store.approvals.get('appr-1')).toMatchObject({
        status: 'PENDING',
        decidedByUserId: null,
        decidedAt: null,
        comment: null,
      });
      expect(store.executions.get('exec-1').status).toBe('WAITING_APPROVAL');
    });

    it('answers 503 when Temporal cannot be reached, leaving the row pending', async () => {
      handle.query.mockRejectedValueOnce(new Error('UNAVAILABLE'));
      await expect(
        service.decide(
          TENANT,
          'appr-1',
          { id: 'user-ana' },
          { action: 'APPROVE' },
        ),
      ).rejects.toThrow(
        new ServiceUnavailableException(
          'Unable to deliver the approval decision to the workflow',
        ),
      );
      expect(store.approvals.get('appr-1').status).toBe('PENDING');
      expect(handle.signal).not.toHaveBeenCalled();
    });

    it('a live state without the node closes the row CANCELLED before its deadline and answers 409', async () => {
      handle.query.mockResolvedValueOnce(liveWaitingOn('some-other-node'));
      const body = await conflictBody(
        service.decide(
          TENANT,
          'appr-1',
          { id: 'user-ana' },
          { action: 'APPROVE' },
        ),
      );
      expect(body).toEqual({
        message: 'No longer pending',
        status: 'CANCELLED',
        decidedBy: null,
        decidedAt: null,
      });
      expect(store.approvals.get('appr-1').status).toBe('CANCELLED');
      expect(handle.signal).not.toHaveBeenCalled();
    });

    it('a live state without the node closes the row EXPIRED once its deadline has passed', async () => {
      store.approvals.set(
        'appr-1',
        approval({ expiresAt: new Date(Date.now() - 60 * 1000) }),
      );
      handle.query.mockResolvedValueOnce(liveWaitingOn());
      const body = await conflictBody(
        service.decide(
          TENANT,
          'appr-1',
          { id: 'user-ana' },
          { action: 'APPROVE' },
        ),
      );
      expect(body.status).toBe('EXPIRED');
      expect(body.message).toBe('No longer pending');
      expect(store.approvals.get('appr-1').status).toBe('EXPIRED');
    });

    it('a run Temporal no longer knows closes the row and answers 409', async () => {
      handle.query.mockRejectedValueOnce(
        new WorkflowNotFoundError('gone', 'automation-exec-exec-1', undefined),
      );
      const body = await conflictBody(
        service.decide(
          TENANT,
          'appr-1',
          { id: 'user-ana' },
          { action: 'APPROVE' },
        ),
      );
      expect(body.status).toBe('CANCELLED');
      expect(store.approvals.get('appr-1').status).toBe('CANCELLED');
    });

    it("another tenant's approval is 404", async () => {
      await expect(
        service.decide(
          OTHER_TENANT,
          'appr-1',
          { id: 'user-ana' },
          {
            action: 'APPROVE',
          },
        ),
      ).rejects.toThrow(NotFoundException);
      expect(store.approvals.get('appr-1').status).toBe('PENDING');
      expect(handle.signal).not.toHaveBeenCalled();
    });

    it('sets the run back to RUNNING when no other approval of it is pending', async () => {
      await service.decide(
        TENANT,
        'appr-1',
        { id: 'user-ana' },
        { action: 'APPROVE' },
      );
      expect(store.executions.get('exec-1').status).toBe('RUNNING');
    });

    it('leaves the run WAITING_APPROVAL while another approval of it is pending', async () => {
      store.approvals.set(
        'appr-2',
        approval({ id: 'appr-2', nodeId: 'node-agent', kind: 'agent_action' }),
      );
      await service.decide(
        TENANT,
        'appr-1',
        { id: 'user-ana' },
        { action: 'APPROVE' },
      );
      expect(store.executions.get('exec-1').status).toBe('WAITING_APPROVAL');
    });
  });

  describe('decideByNode', () => {
    it("decides the node's pending row", async () => {
      const dto = await service.decideByNode(
        TENANT,
        'exec-1',
        'node-approve',
        { id: 'user-ana' },
        { action: 'REJECT', comment: 'No' },
      );
      expect(dto).toMatchObject({ id: 'appr-1', status: 'REJECTED' });
      expect(handle.signal).toHaveBeenCalledWith(rejectNodeSignal, {
        nodeId: 'node-approve',
        rejectedBy: 'user-ana',
        reason: 'No',
      });
    });

    it('answers 409 with the decider when the node was already decided', async () => {
      store.approvals.set(
        'appr-1',
        approval({
          status: 'APPROVED',
          decidedByUserId: 'user-bo',
          decidedAt: new Date('2026-10-29T09:30:00.000Z'),
        }),
      );
      const body = await conflictBody(
        service.decideByNode(
          TENANT,
          'exec-1',
          'node-approve',
          { id: 'user-ana' },
          {
            action: 'APPROVE',
          },
        ),
      );
      expect(body.decidedBy).toEqual({ id: 'user-bo', name: 'Bo Chen' });
    });

    it("another tenant's execution is 404", async () => {
      await expect(
        service.decideByNode(
          OTHER_TENANT,
          'exec-1',
          'node-approve',
          { id: 'u' },
          {
            action: 'APPROVE',
          },
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('listPending / countPending', () => {
    beforeEach(() => {
      store.approvals.set(
        'appr-0',
        approval({
          id: 'appr-0',
          nodeId: 'node-early',
          requestedAt: new Date('2026-10-28T09:00:00.000Z'),
        }),
      );
      store.approvals.set(
        'appr-done',
        approval({ id: 'appr-done', nodeId: 'node-x', status: 'APPROVED' }),
      );
      store.approvals.set(
        'appr-other',
        approval({ id: 'appr-other', tenantId: OTHER_TENANT }),
      );
    });

    it("counts only the tenant's PENDING rows", async () => {
      await expect(service.countPending(TENANT)).resolves.toBe(2);
      await expect(service.countPending(OTHER_TENANT)).resolves.toBe(1);
    });

    it("lists the tenant's pending items oldest first, with the automation name", async () => {
      const items = await service.listPending(TENANT);
      expect(items.map((i) => i.id)).toEqual(['appr-0', 'appr-1']);
      expect(items[0]).toMatchObject({
        workflowName: 'Big deal sign-off',
        decidedBy: null,
        requestedAt: '2026-10-28T09:00:00.000Z',
      });
      expect(store.approvalRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({ take: 200, order: { requestedAt: 'ASC' } }),
      );
    });

    it("finds a run's pending approvals", async () => {
      const items = await service.findPendingForExecution(TENANT, 'exec-1');
      expect(items.map((i) => i.id)).toEqual(['appr-0', 'appr-1']);
      await expect(
        service.findPendingForExecution(OTHER_TENANT, 'exec-1'),
      ).resolves.toEqual([expect.objectContaining({ id: 'appr-other' })]);
    });
  });

  describe('triggerSummary', () => {
    const summary = (triggerSource: any, triggerPayload: any = {}) =>
      service.triggerSummary(
        execution({ triggerSource, triggerPayload }) as AutomationExecution,
      );

    it('an event: its type and the record name', () => {
      expect(
        summary('event', {
          eventType: 'contact.created',
          payload: { name: 'Acme LLC' },
        }),
      ).toBe('contact.created — Acme LLC');
      expect(
        summary('event', {
          eventType: 'contact.created',
          payload: { firstName: 'Ana', lastName: 'Silva' },
        }),
      ).toBe('contact.created — Ana Silva');
      expect(
        summary('event', {
          eventType: 'quote.created',
          payload: { title: 'Fit-out Q-104' },
        }),
      ).toBe('quote.created — Fit-out Q-104');
      expect(
        summary('event', { eventType: 'quote.created', payload: { total: 5 } }),
      ).toBe('quote.created');
    });

    it('a webhook', () => {
      expect(summary('webhook', { body: { a: 1 } })).toBe('Webhook');
    });

    it('a schedule: the local time and zone', () => {
      expect(
        summary('schedule', {
          scheduledAt: '2026-10-29T05:00:00.000Z',
          timezone: 'Asia/Dubai',
        }),
      ).toBe('Schedule, 09:00 Asia/Dubai');
    });

    it('a test run', () => {
      expect(summary('test')).toBe('Test run');
    });

    it('no recorded source', () => {
      expect(summary(null)).toBe('—');
    });
  });
});
