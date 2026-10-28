import { AssistantSweepService } from './assistant-sweep.service';

it('fails RUNNING turns with no progress for 7 minutes (longer than the 5-minute commit timeout) and terminates their workflows; leaves approvals alone', async () => {
  const stale = { id: 't1', conversationId: 'c1', workflowId: 'assistant-turn-t1', status: 'RUNNING', tenantId: 'org-1' };
  const turns = {
    find: jest.fn().mockResolvedValue([stale]),
    update: jest.fn().mockResolvedValue({ affected: 1 }),
  } as any;
  const handle = { terminate: jest.fn().mockResolvedValue(undefined) };
  const temporal = { getClient: async () => ({ workflow: { getHandle: () => handle } }) } as any;
  const events = { writeStatus: jest.fn().mockResolvedValue(undefined) } as any;
  const tenantContext = { runAsSystem: (fn: any) => fn(), runWithTenant: (_t: string, fn: any) => fn() } as any;
  const sweep = new AssistantSweepService(turns, temporal, events, tenantContext);
  const now = new Date('2026-10-14T10:00:00Z');
  expect(await sweep.sweep(now)).toBe(1);
  const where = turns.find.mock.calls[0][0].where;
  expect(where.status).toBe('RUNNING');
  expect(where.lastProgressAt.value).toEqual(new Date('2026-10-14T09:53:00Z'));
  expect(turns.update).toHaveBeenCalledWith({ id: 't1', status: 'RUNNING' }, expect.objectContaining({ status: 'FAILED' }));
  expect(handle.terminate).toHaveBeenCalled();
  expect(events.writeStatus).toHaveBeenCalledWith(stale, 'swept:status');
});
