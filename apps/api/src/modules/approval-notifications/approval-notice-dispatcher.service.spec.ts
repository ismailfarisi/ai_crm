import { ApprovalNoticeDispatcherService } from './approval-notice-dispatcher.service';
import type { ApprovalRequest } from './entities/approval-request.entity';

/**
 * A small in-memory stand-in for the tables the dispatcher touches: enough
 * to show that a redelivered outbox message sends nothing twice and that a
 * decided item gets no reminder.
 */
function harness(opts: {
  request: Partial<ApprovalRequest>;
  holders?: string[];
  itemPending?: boolean;
}) {
  const request = {
    id: 'req-1',
    tenantId: 't1',
    itemType: 'QUOTE',
    itemId: 'q1',
    requestedByUserId: 'requester',
    permissions: ['quote:approve'],
    recipientUserId: null,
    title: 'QT-1 for Acme',
    body: '100.00 AED',
    link: '/quotes/q1',
    meta: null,
    notifyNow: true,
    status: 'PENDING',
    decidedByUserId: null,
    comment: null,
    ...opts.request,
  } as ApprovalRequest;
  const claimed = new Set<string>();
  const bell: string[] = [];
  const mail = { sendMail: jest.fn().mockResolvedValue(undefined) };
  const query = jest.fn(async (sql: string, params: unknown[] = []) => {
    if (sql.includes('INSERT INTO "approval_deliveries"')) {
      const key = params.slice(1, 5).join('|');
      if (claimed.has(key)) return [];
      claimed.add(key);
      return [{ id: key }];
    }
    if (sql.includes('FROM "users" u')) {
      return (opts.holders ?? []).map((id) => ({ id }));
    }
    if (sql.includes('SELECT 1 FROM "users"')) return [{}];
    if (sql.includes('SELECT "email" FROM "users"'))
      return [{ email: `${String(params[0])}@x.test` }];
    if (sql.includes('INSERT INTO "notifications"')) {
      bell.push(params[1] as string);
      return [];
    }
    if (/"quotes"|assistant_turns|automation_approvals/.test(sql))
      return opts.itemPending === false ? [] : [{}];
    if (sql.includes('staff_channel_identities')) return [];
    return [];
  });
  const manager = {
    query,
    findOne: jest.fn(async () => ({ ...request })),
    update: jest.fn(async () => ({})),
    createQueryBuilder: () => ({
      where() {
        return this;
      },
      andWhere() {
        return this;
      },
      getMany: async () => [],
    }),
  };
  const dataSource = { manager, query } as never;
  const notifications = { resolve: jest.fn().mockResolvedValue(undefined) };
  const service = new ApprovalNoticeDispatcherService(
    dataSource,
    { registerHandler: jest.fn() } as never,
    {
      runAsSystem: (fn: () => unknown) => fn(),
      runWithTenant: (_t: string, fn: () => unknown) => fn(),
    } as never,
    mail as never,
    notifications as never,
    { sendMessage: jest.fn() } as never,
    { get: () => 'https://app.kerf.test' } as never,
  );
  const message = (eventType: string) =>
    ({
      id: 'm1',
      tenantId: 't1',
      kind: 'approval_notice',
      eventType,
      payload: { requestId: 'req-1' },
    }) as never;
  return { service, mail, bell, manager, notifications, message };
}

describe('ApprovalNoticeDispatcherService', () => {
  it('tells every approver by bell and email, never the requester', async () => {
    const h = harness({ request: {}, holders: ['requester', 'a1', 'a2'] });
    await h.service.handle(h.message('approval.requested'));
    expect(h.bell.sort()).toEqual(['a1', 'a2']);
    expect(h.mail.sendMail.mock.calls.map((c) => c[0].to).sort()).toEqual([
      'a1@x.test',
      'a2@x.test',
    ]);
    expect(h.mail.sendMail.mock.calls[0][0].text).toContain(
      'https://app.kerf.test/quotes/q1',
    );
  });

  it('sends nothing twice when the outbox redelivers the same notice', async () => {
    const h = harness({ request: {}, holders: ['a1'] });
    await h.service.handle(h.message('approval.requested'));
    await h.service.handle(h.message('approval.requested'));
    expect(h.bell).toEqual(['a1']);
    expect(h.mail.sendMail).toHaveBeenCalledTimes(1);
  });

  it('sends the reminder as a separate event, once', async () => {
    const h = harness({ request: {}, holders: ['a1'] });
    await h.service.handle(h.message('approval.requested'));
    await h.service.handle(h.message('approval.reminder'));
    await h.service.handle(h.message('approval.reminder'));
    expect(h.mail.sendMail).toHaveBeenCalledTimes(2);
    expect(h.mail.sendMail.mock.calls[1][0].subject).toMatch(/^Still waiting/);
  });

  it('drops a reminder once a decision has been recorded', async () => {
    const h = harness({ request: { status: 'APPROVED' }, holders: ['a1'] });
    await h.service.handle(h.message('approval.reminder'));
    expect(h.mail.sendMail).not.toHaveBeenCalled();
    expect(h.bell).toEqual([]);
  });

  it('drops a reminder, and stops reminding, when the item was decided another way', async () => {
    const h = harness({ request: {}, holders: ['a1'], itemPending: false });
    await h.service.handle(h.message('approval.reminder'));
    expect(h.mail.sendMail).not.toHaveBeenCalled();
    expect(h.manager.update).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: 'req-1', status: 'PENDING' }),
      expect.objectContaining({ status: 'CLOSED' }),
    );
  });

  it('tells the requester the outcome and clears the approvers’ bell items', async () => {
    const h = harness({
      request: {
        status: 'REJECTED',
        decidedByUserId: 'a1',
        comment: 'Too cheap',
      },
      holders: ['a1'],
    });
    await h.service.handle(h.message('approval.decided'));
    expect(h.notifications.resolve).toHaveBeenCalledWith('t1', 'q1');
    expect(h.bell).toEqual(['requester']);
    expect(h.mail.sendMail.mock.calls[0][0].subject).toBe(
      'Quote rejected: QT-1 for Acme',
    );
  });

  it('does not tell someone about their own decision', async () => {
    const h = harness({
      request: { status: 'APPROVED', decidedByUserId: 'requester' },
    });
    await h.service.handle(h.message('approval.decided'));
    expect(h.mail.sendMail).not.toHaveBeenCalled();
  });

  it('only asks the named person, with no immediate notice, for a deferred request', async () => {
    const h = harness({
      request: {
        itemType: 'ASSISTANT_ACTION',
        recipientUserId: 'owner',
        notifyNow: false,
        permissions: [],
      },
    });
    await h.service.handle(h.message('approval.requested'));
    expect(h.bell).toEqual([]);
    await h.service.handle(h.message('approval.reminder'));
    expect(h.bell).toEqual(['owner']);
  });

  it('retries only the channel that failed', async () => {
    const h = harness({ request: {}, holders: ['a1'] });
    h.mail.sendMail.mockRejectedValueOnce(new Error('SES down'));
    await expect(
      h.service.handle(h.message('approval.requested')),
    ).rejects.toThrow('EMAIL: SES down');
    expect(h.bell).toEqual(['a1']);
  });
});
