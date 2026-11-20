import { ChannelThreadService } from './channel-thread.service';
import { ChannelThread } from '../entities/channel-thread.entity';

const orgId = 'org-1';
const provider = 'WHATSAPP_META';
const contactId = 'contact-1';

function makeService(initial: Partial<ChannelThread>[] = []) {
  const rows = initial.map((row, i) => ({
    id: `thread-${i + 1}`,
    organizationId: orgId,
    provider,
    contactId,
    state: 'AI',
    assigneeUserId: null,
    handoverReason: null,
    handoverSummary: null,
    handedOverAt: null,
    ...row,
  })) as ChannelThread[];
  const match = (where: Partial<ChannelThread>) =>
    rows.find((row) =>
      Object.entries(where).every(([k, v]) => (row as any)[k] === v),
    ) ?? null;
  const repo = {
    find: jest.fn(async () => rows),
    findOne: jest.fn(async ({ where }) => match(where)),
    findOneOrFail: jest.fn(async ({ where }) => match(where)),
    save: jest.fn(async (row) => row),
    createQueryBuilder: jest.fn(() => {
      const builder: any = {
        insert: () => builder,
        values: (values: Partial<ChannelThread>) => {
          builder.pending = values;
          return builder;
        },
        orIgnore: () => builder,
        execute: async () => {
          rows.push({
            id: `thread-${rows.length + 1}`,
            assigneeUserId: null,
            handoverReason: null,
            handoverSummary: null,
            handedOverAt: null,
            ...builder.pending,
          } as ChannelThread);
        },
      };
      return builder;
    }),
  };
  const notifications = { notifyHolders: jest.fn().mockResolvedValue(1) };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const service = new ChannelThreadService(
    repo as any,
    notifications as any,
    audit as any,
  );
  return { service, rows, notifications, audit };
}

describe('ChannelThreadService', () => {
  it('lets the AI answer a conversation nobody has seen before', async () => {
    const { service, rows } = makeService();
    await expect(service.admitInbound(orgId, provider, contactId)).resolves.toBe(true);
    expect(rows[0].state).toBe('AI');
  });

  it.each(['NEEDS_HUMAN', 'HUMAN'] as const)(
    'keeps the AI off a conversation that is %s',
    async (state) => {
      const { service } = makeService([{ state }]);
      await expect(service.admitInbound(orgId, provider, contactId)).resolves.toBe(false);
    },
  );

  it('starts a resolved conversation again with the AI', async () => {
    const { service, rows } = makeService([{ state: 'RESOLVED', assigneeUserId: 'user-1' }]);
    await expect(service.admitInbound(orgId, provider, contactId)).resolves.toBe(true);
    expect(rows[0]).toMatchObject({ state: 'AI', assigneeUserId: null });
  });

  it('hands over with the reason and summary, and tells staff', async () => {
    const { service, rows, notifications, audit } = makeService([{ state: 'AI' }]);
    const result = await service.handOver({
      organizationId: orgId,
      provider,
      contactId,
      reason: 'COMPLAINT',
      summary: 'Boxes arrived damaged',
    });
    expect(result.handedOver).toBe(true);
    expect(rows[0]).toMatchObject({
      state: 'NEEDS_HUMAN',
      handoverReason: 'COMPLAINT',
      handoverSummary: 'Boxes arrived damaged',
    });
    expect(notifications.notifyHolders).toHaveBeenCalledWith(
      orgId,
      'channel:send',
      expect.objectContaining({
        type: 'CONVERSATION_HANDOVER',
        body: expect.stringContaining('Boxes arrived damaged'),
      }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'channel_thread.hand_over' }),
    );
  });

  it('does not hand over, or notify again, when a person already holds it', async () => {
    const { service, notifications } = makeService([{ state: 'HUMAN' }]);
    const result = await service.handOver({
      organizationId: orgId,
      provider,
      contactId,
      reason: 'ERROR',
    });
    expect(result.handedOver).toBe(false);
    expect(notifications.notifyHolders).not.toHaveBeenCalled();
  });

  it('assigns the conversation to whoever replies from the inbox', async () => {
    const { service, rows } = makeService([{ state: 'AI' }]);
    await service.takeOverByContact(orgId, provider, contactId, 'user-7');
    expect(rows[0]).toMatchObject({
      state: 'HUMAN',
      assigneeUserId: 'user-7',
      handoverReason: 'STAFF_REPLIED',
    });
  });

  it('gives the conversation back to the AI with the handover cleared', async () => {
    const { service, rows } = makeService([
      { state: 'HUMAN', assigneeUserId: 'user-7', handoverReason: 'COMPLAINT' },
    ]);
    await service.returnToAi(orgId, rows[0].id);
    expect(rows[0]).toMatchObject({
      state: 'AI',
      assigneeUserId: null,
      handoverReason: null,
    });
  });

  it('refuses a conversation from another organization', async () => {
    const { service, rows } = makeService([{ state: 'AI' }]);
    await expect(service.resolve('other-org', rows[0].id)).rejects.toThrow(
      'Conversation not found',
    );
  });
});
