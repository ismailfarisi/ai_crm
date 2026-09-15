import { PERMISSIONS } from '@saas/shared';
import {
  formatMinutes,
  minutesFromText,
  WorkOrderLogTimeSkill,
} from './work-order-log-time.skill';

const ctx = (message: string) => ({
  organizationId: 'org',
  userId: 'u1',
  provider: 'TELEGRAM' as never,
  senderIdentifier: 's',
  permissions: [PERMISSIONS.WORK_ORDER_EXECUTE],
  message,
});

function makeSkill(status = 'IN_PROGRESS') {
  const ops = [
    {
      id: 'op1',
      label: 'Die cutting',
      workCenterName: 'Bobst',
      operationKey: 'diecut',
      status: 'PAUSED',
      estimatedSetupMinutes: 10,
      estimatedRunMinutes: 20,
      actualMinutes: 15,
    },
    {
      id: 'op2',
      label: 'Hand wrap',
      workCenterName: 'Wrapping bench',
      operationKey: 'wrap',
      status: 'PENDING',
      estimatedSetupMinutes: 0,
      estimatedRunMinutes: 60,
      actualMinutes: 0,
    },
  ];
  const production = {
    findOpenByNumber: jest.fn(async (_o: string, n: string) =>
      n === 'WO-2026-0012'
        ? { id: 'wo1', woNumber: 'WO-2026-0012', status }
        : null,
    ),
    listOperations: jest.fn(async () => ops),
    logTime: jest.fn(async () => ({
      operations: [{ id: 'op1', actualMinutes: 60 }],
    })),
  };
  return { skill: new WorkOrderLogTimeSkill(production as any), production };
}

describe('minutesFromText', () => {
  it.each([
    ['45 minutes', 45],
    ['45', 45],
    ['1.5 hours', 90],
    ['1h 20', 80],
    ['2 hrs', 120],
    ['spent 30 mins on it', 30],
    ['on WO-2026-0012', null],
  ])('%s → %s', (text, expected) => {
    expect(minutesFromText(text)).toBe(expected);
  });
});

describe('formatMinutes', () => {
  it('reads like a person would say it', () => {
    expect(formatMinutes(45)).toBe('45 min');
    expect(formatMinutes(90)).toBe('1h 30m');
    expect(formatMinutes(120)).toBe('2h');
  });
});

describe('WorkOrderLogTimeSkill.resolve', () => {
  it('resolves number, operation and time from one message', async () => {
    const { skill } = makeSkill();
    const result = await skill.resolve(
      { operationQuery: 'die cutting', minutes: 45 },
      ctx('log 45 minutes on WO-2026-0012 die cutting'),
    );
    expect(result).toEqual({
      kind: 'resolved',
      value: expect.objectContaining({
        operationId: 'op1',
        minutes: 45,
        estimatedMinutes: 30,
        loggedMinutes: 15,
      }),
    });
  });

  it('asks which operation when the message does not say, and takes a numbered answer', async () => {
    const { skill } = makeSkill();
    const first = await skill.resolve(
      { minutes: 30 },
      ctx('30 mins on WO-2026-0012'),
    );
    expect(first.kind).toBe('question');
    if (first.kind !== 'question') return;
    expect(first.question).toMatch(/1\. Die cutting/);

    const second = await skill.resolve(first.slots, ctx('2'));
    expect(second).toEqual({
      kind: 'resolved',
      value: expect.objectContaining({ operationId: 'op2', minutes: 30 }),
    });
  });

  it('asks how long rather than guessing', async () => {
    const { skill } = makeSkill();
    const result = await skill.resolve(
      { operationQuery: 'wrap' },
      ctx('did the wrapping on WO-2026-0012'),
    );
    expect(result.kind).toBe('question');
    if (result.kind === 'question') expect(result.question).toMatch(/How long/);
  });

  it('refuses a job that is not on the floor', async () => {
    const { skill } = makeSkill('COMPLETE');
    const result = await skill.resolve(
      { minutes: 10 },
      ctx('10 min on WO-2026-0012 wrap'),
    );
    expect(result).toEqual({
      kind: 'refused',
      reason: expect.stringMatching(/complete/),
    });
  });

  it('refuses an unknown job instead of picking another', async () => {
    const { skill } = makeSkill();
    const result = await skill.resolve(
      { minutes: 10 },
      ctx('10 min on WO-2026-9999'),
    );
    expect(result.kind).toBe('refused');
  });
});
