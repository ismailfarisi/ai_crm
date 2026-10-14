import { AssistantEventsService } from './assistant-events.service';

function setup(turnRow: Record<string, unknown> = {}) {
  const inserted: any[] = [];
  const updates: any[] = [];
  const turn = {
    id: 'turn-1', tenantId: 'org-1', conversationId: 'conv-1', status: 'RUNNING', pendingAction: null,
    steps: 0, model: null, error: null, createdAt: new Date('2026-10-14'), finishedAt: null, ...turnRow,
  };
  const qb = {
    insert: () => qb, into: () => qb, values: (v: any) => { inserted.push(v); return qb; },
    orIgnore: () => qb, execute: async () => ({}),
  };
  const manager = {
    createQueryBuilder: () => qb,
    update: jest.fn(async (_e: unknown, where: unknown, patch: unknown) => { updates.push({ where, patch }); Object.assign(turn, patch); }),
    findOneByOrFail: jest.fn(async () => turn),
  };
  const dataSource = { transaction: (fn: any) => fn(manager) } as any;
  const redis = { publish: jest.fn().mockResolvedValue(1) } as any;
  return { service: new AssistantEventsService(dataSource, redis), inserted, updates, redis, turn };
}

describe('AssistantEventsService.emit', () => {
  const base = { organizationId: 'org-1', conversationId: 'conv-1', turnId: 'turn-1' };

  it('inserts an idempotent row keyed by (turn, eventKey) and nudges the conversation channel', async () => {
    const { service, inserted, redis } = setup();
    await service.emit({ ...base, eventKey: 't1:call:c1', role: 'tool_call', content: 'Using x', toolName: 'x', payload: { args: {} } });
    expect(inserted[0]).toMatchObject({
      tenantId: 'org-1', conversationId: 'conv-1', turnId: 'turn-1', eventKey: 't1:call:c1', role: 'tool_call', toolName: 'x',
    });
    expect(redis.publish).toHaveBeenCalledWith('assistant:conv:conv-1', expect.any(String));
  });

  it('bumps last_progress_at on every event, even without a state change', async () => {
    const { service, updates } = setup();
    await service.emit({ ...base, eventKey: 't1:call:c1', role: 'tool_call', content: 'Using x' });
    expect(updates[0].patch).toEqual({ lastProgressAt: expect.any(Date) });
  });

  it('updates the turn and writes a status row carrying the turn when turn state changes', async () => {
    const { service, inserted, updates } = setup();
    await service.emit({
      ...base, eventKey: 'final', role: 'assistant', content: 'Done', turn: { status: 'COMPLETED', pendingAction: null, steps: 2 },
    });
    expect(updates[0].patch).toMatchObject({ status: 'COMPLETED', pendingAction: null, steps: 2, finishedAt: expect.any(Date), lastProgressAt: expect.any(Date) });
    const status = inserted.find((row) => row.role === 'status');
    expect(status).toMatchObject({ eventKey: 'final:status', payload: { turn: expect.objectContaining({ id: 'turn-1', status: 'COMPLETED' }) } });
  });

  it('does not touch a turn that was already cancelled', async () => {
    const { service, updates, inserted } = setup({ status: 'CANCELLED' });
    await service.emit({ ...base, eventKey: 't2:thought', role: 'step', content: 'late', turn: { steps: 2 } });
    expect(updates).toHaveLength(0);
    expect(inserted).toHaveLength(0);
  });

  it('swallows Redis failures (the poll fallback delivers the event)', async () => {
    const { service, redis } = setup();
    redis.publish.mockRejectedValueOnce(new Error('down'));
    await expect(service.emit({ ...base, eventKey: 'k', role: 'step', content: 'x' })).resolves.toBeUndefined();
  });
});
