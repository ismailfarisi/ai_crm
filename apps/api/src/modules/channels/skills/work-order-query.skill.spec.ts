import { WorkOrderQuerySkill } from './work-order-query.skill';
import { ProductionService } from '../../production/production.service';
import type { SkillContext } from './skill.types';

describe('WorkOrderQuerySkill', () => {
  let skill: WorkOrderQuerySkill;
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
    };
    skill = new WorkOrderQuerySkill(production as ProductionService);
  });

  it('lists active running operations', async () => {
    (production.list as jest.Mock).mockResolvedValue([
      {
        id: 'wo-1',
        woNumber: 'WO-2026-0003',
        description: 'Rigid gift box',
        status: 'IN_PROGRESS',
        operations: [
          { id: 'op-1', label: 'Die cutting', status: 'RUNNING', runningSince: new Date(Date.now() - 30 * 60000).toISOString(), actualMinutes: 15 },
        ],
      },
    ]);

    const res = await skill.resolve({ queryType: 'ACTIVE_JOBS' }, ctx);
    expect(res.kind).toBe('resolved');
    if (res.kind === 'resolved') {
      const outcome = await skill.execute(res.value, ctx);
      expect(outcome.reply).toContain('Die cutting');
      expect(outcome.reply).toContain('WO-2026-0003');
    }
  });

  it('summarizes a single work order', async () => {
    (production.list as jest.Mock).mockResolvedValue([
      {
        id: 'wo-1',
        woNumber: 'WO-2026-0001',
        description: 'Rigid gift box',
        status: 'COMPLETE',
        qty: 200,
        operations: [
          { id: 'op-1', label: 'Print', status: 'DONE', actualMinutes: 45, estimatedSetupMinutes: 10, estimatedRunMinutes: 30 },
        ],
      },
    ]);

    const res = await skill.resolve({ workOrderNumber: 'WO-2026-0001' }, ctx);
    expect(res.kind).toBe('resolved');
    if (res.kind === 'resolved') {
      const outcome = await skill.execute(res.value, ctx);
      expect(outcome.reply).toContain('WO-2026-0001');
      expect(outcome.reply).toContain('COMPLETE');
    }
  });

  it('handles empty active jobs', async () => {
    (production.list as jest.Mock).mockResolvedValue([
      {
        id: 'wo-1',
        woNumber: 'WO-2026-0001',
        description: 'Rigid gift box',
        status: 'PLANNED',
        operations: [
          { id: 'op-1', label: 'Print', status: 'PENDING' },
        ],
      },
    ]);

    const res = await skill.resolve({ queryType: 'ACTIVE_JOBS' }, ctx);
    expect(res.kind).toBe('resolved');
    if (res.kind === 'resolved') {
      const outcome = await skill.execute(res.value, ctx);
      expect(outcome.reply).toContain('No machine clocks or operations are currently running');
    }
  });

  it('reports overdue jobs when present', async () => {
    const pastDate = new Date();
    pastDate.setDate(pastDate.getDate() - 3);

    (production.list as jest.Mock).mockResolvedValue([
      {
        id: 'wo-1',
        woNumber: 'WO-2026-0002',
        description: 'Luxury packaging',
        status: 'IN_PROGRESS',
        dueDate: pastDate.toISOString(),
        operations: [],
      },
    ]);

    const res = await skill.resolve({ queryType: 'OVERDUE_JOBS' }, ctx);
    expect(res.kind).toBe('resolved');
    if (res.kind === 'resolved') {
      const outcome = await skill.execute(res.value, ctx);
      expect(outcome.reply).toContain('Overdue Job(s)');
      expect(outcome.reply).toContain('WO-2026-0002');
    }
  });

  it('reports no overdue jobs when all on schedule', async () => {
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 5);

    (production.list as jest.Mock).mockResolvedValue([
      {
        id: 'wo-1',
        woNumber: 'WO-2026-0002',
        description: 'Luxury packaging',
        status: 'IN_PROGRESS',
        dueDate: futureDate.toISOString(),
        operations: [],
      },
    ]);

    const res = await skill.resolve({ queryType: 'OVERDUE_JOBS' }, ctx);
    expect(res.kind).toBe('resolved');
    if (res.kind === 'resolved') {
      const outcome = await skill.execute(res.value, ctx);
      expect(outcome.reply).toContain('No overdue work orders');
    }
  });

  it('returns not found message when queried work order does not exist', async () => {
    (production.list as jest.Mock).mockResolvedValue([]);

    const res = await skill.resolve({ workOrderNumber: 'WO-2026-9999' }, ctx);
    expect(res.kind).toBe('resolved');
    if (res.kind === 'resolved') {
      const outcome = await skill.execute(res.value, ctx);
      expect(outcome.reply).toContain('Could not find work order WO-2026-9999');
    }
  });

  it('asks for work order number when queryType is JOB_STATUS and woNumber is missing', async () => {
    const res = await skill.resolve({ queryType: 'JOB_STATUS' }, ctx);
    expect(res.kind).toBe('question');
    if (res.kind === 'question') {
      expect(res.question).toBe('Which work order would you like to check? (e.g. WO-2026-0003)');
      expect(res.slots).toEqual({ queryType: 'JOB_STATUS' });
    }
  });

  it('previews queries correctly', async () => {
    expect(await skill.preview({ queryType: 'JOB_STATUS', workOrderNumber: 'WO-2026-0001' })).toBe('Check status of WO-2026-0001?');
    expect(await skill.preview({ queryType: 'OVERDUE_JOBS' })).toBe('List overdue production jobs?');
    expect(await skill.preview({ queryType: 'ACTIVE_JOBS' })).toBe('Check active jobs on the floor?');
  });
});
