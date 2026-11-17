import { PERMISSIONS } from '@saas/shared';
import {
  ApprovalReplyService,
  approvalSlotOf,
  parseApprovalReply,
  type ApprovalPromptSlot,
} from './approval-reply.service';
import { ChannelProviderType } from '../entities/channel-config.entity';

describe('parseApprovalReply', () => {
  it.each([
    ['YES', { kind: 'approve' }],
    ['approve', { kind: 'approve' }],
    ['no', { kind: 'reject', reason: null }],
    [
      'Reject: price is too low',
      { kind: 'reject', reason: 'price is too low' },
    ],
    ['what is this?', { kind: 'unclear' }],
  ])('%s', (message, expected) => {
    expect(parseApprovalReply(message)).toEqual(expected);
  });
});

describe('approvalSlotOf', () => {
  it('only reads a live prompt', () => {
    const slots = {
      _approval: { itemType: 'QUOTE', itemId: 'q1', requestId: 'r1' },
    };
    expect(
      approvalSlotOf({ status: 'AWAITING_CONFIRM', slots } as never),
    ).toEqual(slots._approval);
    expect(approvalSlotOf({ status: 'EXPIRED', slots } as never)).toBeNull();
    expect(
      approvalSlotOf({ status: 'AWAITING_CONFIRM', slots: {} } as never),
    ).toBeNull();
  });
});

describe('ApprovalReplyService', () => {
  const conversation = { id: 'c1', originMessageId: 'm1' } as never;
  const ctx = (message: string, permissions: string[]) =>
    ({
      organizationId: 't1',
      userId: 'u1',
      permissions,
      message,
      provider: ChannelProviderType.TELEGRAM,
    }) as never;

  function build(affected = 1) {
    const execute = jest.fn().mockResolvedValue({ affected });
    const qb = {
      update: () => qb,
      set: () => qb,
      where: () => qb,
      andWhere: () => qb,
      execute,
    };
    const conversations = { createQueryBuilder: () => qb, update: jest.fn() };
    const audit = { record: jest.fn() };
    const quotes = { sendSignal: jest.fn().mockResolvedValue({}) };
    const automationApprovals = { decide: jest.fn().mockResolvedValue({}) };
    const moduleRef = { get: jest.fn(() => automationApprovals) };
    const service = new ApprovalReplyService(
      conversations as never,
      audit as never,
      quotes as never,
      moduleRef as never,
    );
    return {
      service,
      conversations,
      audit,
      quotes,
      automationApprovals,
      execute,
    };
  }

  const quote: ApprovalPromptSlot = {
    requestId: 'r1',
    itemType: 'QUOTE',
    itemId: 'q1',
    title: 'QT-1',
  };
  const step: ApprovalPromptSlot = {
    requestId: 'r2',
    itemType: 'AUTOMATION_APPROVAL',
    itemId: 'a1',
  };

  it("hands a quote's YES to the quote approval skill", async () => {
    const h = build();
    expect(
      await h.service.handle(
        conversation,
        quote,
        ctx('yes', [PERMISSIONS.QUOTE_APPROVE]),
      ),
    ).toBeNull();
    expect(h.quotes.sendSignal).not.toHaveBeenCalled();
  });

  it('rejects a quote as the replying user, and audits it from the chat', async () => {
    const h = build();
    const reply = await h.service.handle(
      conversation,
      quote,
      ctx('no: margin', [PERMISSIONS.QUOTE_APPROVE]),
    );
    expect(reply).toBe('Rejected QT-1.');
    expect(h.quotes.sendSignal).toHaveBeenCalledWith(
      't1',
      'q1',
      'REJECT',
      { reason: 'margin' },
      'u1',
    );
    expect(h.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'u1',
        subjectId: 'q1',
        channel: 'TELEGRAM',
        action: 'approval.reject',
      }),
    );
  });

  it('approves an automation step through the approvals service', async () => {
    const h = build();
    await h.service.handle(
      conversation,
      step,
      ctx('yes', [PERMISSIONS.AUTOMATION_APPROVE]),
    );
    expect(h.automationApprovals.decide).toHaveBeenCalledWith(
      't1',
      'a1',
      { id: 'u1' },
      { action: 'APPROVE' },
    );
  });

  it('refuses someone who lost the permission since the notice was sent', async () => {
    const h = build();
    const reply = await h.service.handle(conversation, step, ctx('yes', []));
    expect(reply).toMatch(/permission/);
    expect(h.automationApprovals.decide).not.toHaveBeenCalled();
    expect(h.audit.record).not.toHaveBeenCalled();
  });

  it('decides only once when the same reply arrives twice', async () => {
    const h = build(0);
    const reply = await h.service.handle(
      conversation,
      step,
      ctx('yes', [PERMISSIONS.AUTOMATION_APPROVE]),
    );
    expect(reply).toBe('That one is already decided.');
    expect(h.automationApprovals.decide).not.toHaveBeenCalled();
  });

  it('reports a refusal from the approvals service without auditing a decision', async () => {
    const h = build();
    h.automationApprovals.decide.mockRejectedValueOnce(
      new Error('This approval has expired'),
    );
    const reply = await h.service.handle(
      conversation,
      step,
      ctx('yes', [PERMISSIONS.AUTOMATION_APPROVE]),
    );
    expect(reply).toBe('Could not record that: This approval has expired');
    expect(h.audit.record).not.toHaveBeenCalled();
  });
});
