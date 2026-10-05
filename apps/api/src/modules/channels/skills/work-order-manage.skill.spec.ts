import { WorkOrderManageSkill } from './work-order-manage.skill';
import { ProductionService } from '../../production/production.service';
import type { SkillContext } from './skill.types';

describe('WorkOrderManageSkill', () => {
  let skill: WorkOrderManageSkill;
  let production: Partial<ProductionService>;
  const ctx: SkillContext = {
    organizationId: 'org-1',
    userId: 'user-1',
    conversationId: 'conv-1',
    channelProvider: 'TELEGRAM',
  } as unknown as SkillContext;

  beforeEach(() => {
    production = {
      list: jest.fn(),
      get: jest.fn(),
      release: jest.fn(),
      complete: jest.fn(),
      startOperation: jest.fn(),
      stopOperation: jest.fn(),
      cancel: jest.fn(),
    };
    skill = new WorkOrderManageSkill(production as ProductionService);
  });

  it('starts operation timer when work order and operation are specified', async () => {
    (production.list as jest.Mock).mockResolvedValue([
      {
        id: 'wo-1',
        woNumber: 'WO-2026-0003',
        description: 'Rigid gift box',
        status: 'RELEASED',
        operations: [
          { id: 'op-1', label: 'Die cutting', status: 'PENDING', workCenterName: 'Die Cutter' },
        ],
      },
    ]);
    (production.startOperation as jest.Mock).mockResolvedValue({
      id: 'wo-1',
      woNumber: 'WO-2026-0003',
      operations: [{ id: 'op-1', label: 'Die cutting', status: 'RUNNING' }],
    });

    const res = await skill.resolve(
      { workOrderNumber: 'WO-2026-0003', action: 'START', operationQuery: 'die cutting' },
      ctx,
    );

    expect(res.kind).toBe('resolved');
    if (res.kind === 'resolved') {
      const outcome = await skill.execute(res.value, ctx);
      expect(production.startOperation).toHaveBeenCalledWith('org-1', 'wo-1', 'op-1', 'user-1');
      expect(outcome.reply).toContain('Started timer for "Die cutting"');
    }
  });

  it('asks for work order number when missing', async () => {
    const res = await skill.resolve({ action: 'START' }, ctx);
    expect(res.kind).toBe('question');
    if (res.kind === 'question') {
      expect(res.question).toMatch(/which work order/i);
    }
  });

  it('releases work order when action is RELEASE', async () => {
    (production.list as jest.Mock).mockResolvedValue([
      {
        id: 'wo-1',
        woNumber: 'WO-2026-0003',
        status: 'PLANNED',
        operations: [],
      },
    ]);
    (production.release as jest.Mock).mockResolvedValue({ id: 'wo-1', status: 'RELEASED' });

    const res = await skill.resolve({ workOrderNumber: 'WO-2026-0003', action: 'RELEASE' }, ctx);
    expect(res.kind).toBe('resolved');
    if (res.kind === 'resolved') {
      const outcome = await skill.execute(res.value, ctx);
      expect(production.release).toHaveBeenCalledWith('org-1', 'wo-1');
      expect(outcome.reply).toContain('released');
    }
  });

  it('completes work order with quantity', async () => {
    (production.list as jest.Mock).mockResolvedValue([
      {
        id: 'wo-1',
        woNumber: 'WO-2026-0001',
        qty: 200,
        status: 'IN_PROGRESS',
        operations: [],
      },
    ]);
    (production.complete as jest.Mock).mockResolvedValue({ id: 'wo-1', status: 'COMPLETE' });

    const res = await skill.resolve({ workOrderNumber: 'WO-2026-0001', action: 'COMPLETE', quantityCompleted: 200 }, ctx);
    expect(res.kind).toBe('resolved');
    if (res.kind === 'resolved') {
      const outcome = await skill.execute(res.value, ctx);
      expect(production.complete).toHaveBeenCalledWith('org-1', 'wo-1', 'user-1', { qtyCompleted: 200 }, false);
      expect(outcome.reply).toContain('marked COMPLETE');
    }
  });

  it('refuses when work order is not found', async () => {
    (production.list as jest.Mock).mockResolvedValue([]);

    const res = await skill.resolve({ workOrderNumber: 'WO-2026-9999', action: 'START' }, ctx);
    expect(res.kind).toBe('refused');
    if (res.kind === 'refused') {
      expect(res.reason).toContain('could not find work order WO-2026-9999');
    }
  });

  it('stops operation timer when action is STOP', async () => {
    (production.list as jest.Mock).mockResolvedValue([
      {
        id: 'wo-1',
        woNumber: 'WO-2026-0003',
        status: 'IN_PROGRESS',
        operations: [
          { id: 'op-1', label: 'Die cutting', status: 'RUNNING', workCenterName: 'Die Cutter' },
        ],
      },
    ]);
    (production.stopOperation as jest.Mock).mockResolvedValue({ id: 'wo-1' });

    const res = await skill.resolve({ workOrderNumber: 'WO-2026-0003', action: 'STOP' }, ctx);
    expect(res.kind).toBe('resolved');
    if (res.kind === 'resolved') {
      const outcome = await skill.execute(res.value, ctx);
      expect(production.stopOperation).toHaveBeenCalledWith('org-1', 'wo-1', 'op-1', false);
      expect(outcome.reply).toContain('Paused "Die cutting"');
    }
  });

  it('finishes and advances operation when action is FINISH or ADVANCE', async () => {
    (production.list as jest.Mock).mockResolvedValue([
      {
        id: 'wo-1',
        woNumber: 'WO-2026-0003',
        status: 'IN_PROGRESS',
        operations: [
          { id: 'op-1', label: 'Printing', status: 'RUNNING', workCenterName: 'Press' },
        ],
      },
    ]);
    (production.stopOperation as jest.Mock).mockResolvedValue({ id: 'wo-1' });

    const res = await skill.resolve({ workOrderNumber: 'WO-2026-0003', action: 'ADVANCE', operationQuery: 'printing' }, ctx);
    expect(res.kind).toBe('resolved');
    if (res.kind === 'resolved') {
      const outcome = await skill.execute(res.value, ctx);
      expect(production.stopOperation).toHaveBeenCalledWith('org-1', 'wo-1', 'op-1', true);
      expect(outcome.reply).toContain('Finished "Printing"');
    }
  });

  it('cancels work order with reason', async () => {
    (production.list as jest.Mock).mockResolvedValue([
      {
        id: 'wo-1',
        woNumber: 'WO-2026-0003',
        status: 'PLANNED',
        operations: [],
      },
    ]);
    (production.cancel as jest.Mock).mockResolvedValue({ id: 'wo-1', status: 'CANCELLED' });

    const res = await skill.resolve({ workOrderNumber: 'WO-2026-0003', action: 'CANCEL', cancelReason: 'Customer requested' }, ctx);
    expect(res.kind).toBe('resolved');
    if (res.kind === 'resolved') {
      const outcome = await skill.execute(res.value, ctx);
      expect(production.cancel).toHaveBeenCalledWith('org-1', 'wo-1', 'Customer requested');
      expect(outcome.reply).toContain('cancelled');
    }
  });

  it('picks running operation for FINISH action when no operationQuery provided', async () => {
    (production.list as jest.Mock).mockResolvedValue([
      {
        id: 'wo-1',
        woNumber: 'WO-2026-0003',
        status: 'IN_PROGRESS',
        operations: [
          { id: 'op-1', label: 'Printing', status: 'RUNNING', workCenterName: 'Press' },
          { id: 'op-2', label: 'Cutting', status: 'PENDING', workCenterName: 'Cutter' },
        ],
      },
    ]);

    const res = await skill.resolve({ workOrderNumber: 'WO-2026-0003', action: 'FINISH' }, ctx);
    expect(res.kind).toBe('resolved');
    if (res.kind === 'resolved') {
      expect(res.value.operationId).toBe('op-1');
      expect(res.value.operationLabel).toBe('Printing');
    }
  });

  it('prompts with question when ADVANCE has no pending operation and no query', async () => {
    (production.list as jest.Mock).mockResolvedValue([
      {
        id: 'wo-1',
        woNumber: 'WO-2026-0003',
        status: 'IN_PROGRESS',
        operations: [
          { id: 'op-1', label: 'Printing', status: 'DONE', workCenterName: 'Press' },
        ],
      },
    ]);

    const res = await skill.resolve({ workOrderNumber: 'WO-2026-0003', action: 'ADVANCE' }, ctx);
    expect(res.kind).toBe('question');
    if (res.kind === 'question') {
      expect(res.question).toContain('Which operation on WO-2026-0003?');
      expect(res.question).toContain('1. Printing (DONE)');
      expect(res.slots).toEqual(expect.objectContaining({ action: 'ADVANCE', workOrderNumber: 'WO-2026-0003' }));
    }
  });

  it('previews actions correctly', async () => {
    expect(await skill.preview({ workOrderId: 'wo-1', woNumber: 'WO-2026-0001', action: 'RELEASE' })).toBe('Release WO-2026-0001 to the floor?');
    expect(await skill.preview({ workOrderId: 'wo-1', woNumber: 'WO-2026-0001', action: 'COMPLETE', quantityCompleted: 150 })).toBe('Complete WO-2026-0001 with 150 pieces?');
    expect(await skill.preview({ workOrderId: 'wo-1', woNumber: 'WO-2026-0001', action: 'CANCEL' })).toBe('Cancel WO-2026-0001?');
    expect(await skill.preview({ workOrderId: 'wo-1', woNumber: 'WO-2026-0001', action: 'START', operationLabel: 'Cutting' })).toBe('START Cutting on WO-2026-0001?');
  });
});
