import { AssistantController } from './assistant.controller';

it('never writes a row twice and writes in seq order when nudges race (Review Focus #1/#3)', async () => {
  const writes: string[] = [];
  let nudge: () => void = () => undefined;
  const rowsAfter = (after: number) => [1, 2, 3].filter((s) => s > after).map((s) => ({ seq: s }));
  const service = { messagesAfter: jest.fn(async (_u, _id, after) => rowsAfter(after)) } as any;
  const hub = { listen: (_id: string, fn: () => void) => ((nudge = fn), () => undefined) } as any;
  const tenantContext = { runWithTenant: (_t: string, fn: any) => fn() } as any;
  const controller = new AssistantController(service, hub, tenantContext);
  const res = { status: jest.fn(), setHeader: jest.fn(), flushHeaders: jest.fn(), write: (s: string) => writes.push(s) } as any;
  const req = { on: jest.fn() } as any;
  await controller.stream({ organizationId: 'org-1' } as any, 'conv-1', '1', req, res);
  nudge(); nudge();
  await new Promise((r) => setTimeout(r, 0));
  const ids = writes.filter((w) => w.startsWith('id:')).map((w) => Number(w.split('\n')[0].slice(4)));
  expect(ids).toEqual([2, 3]);
  req.on.mock.calls.find(([e]: any) => e === 'close')[1]();
});
