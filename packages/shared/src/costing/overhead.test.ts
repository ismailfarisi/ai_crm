import { describe, expect, it } from 'vitest';
import { overheadWindow, suggestOverheadRate, type OverheadLedgerAccount } from './overhead';

const TODAY = new Date('2026-11-25T10:00:00Z');
const SIX = ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'];

const every = (months: string[], amount: number) =>
  Object.fromEntries(months.map((m) => [m, amount]));

const rent: OverheadLedgerAccount = {
  code: '6100', name: 'Rent & premises', kind: 'OVERHEAD', role: 'RENT', byMonth: every(SIX, 10_000),
};
const salaries: OverheadLedgerAccount = {
  code: '6300', name: 'Salaries & wages', kind: 'OVERHEAD', role: 'SALARIES', byMonth: every(SIX, 30_000),
};
const absorbed: OverheadLedgerAccount = {
  code: '6390', name: 'Labour absorbed', kind: 'OVERHEAD', role: 'LABOUR_ABSORBED', byMonth: every(SIX, -20_000),
};
const marketing: OverheadLedgerAccount = {
  code: '6700', name: 'Marketing', kind: 'OVERHEAD', role: 'MARKETING', byMonth: every(SIX, 2_000),
};
const cogs: OverheadLedgerAccount = {
  code: '5000', name: 'Cost of goods sold', kind: 'DIRECT', role: 'COGS', byMonth: every(SIX, 80_000),
};

describe('overheadWindow', () => {
  it('counts only months that have fully ended', () => {
    expect(overheadWindow(TODAY, 3, new Date('2020-01-01')).counted).toEqual(['2026-08', '2026-09', '2026-10']);
  });

  it('leaves out the month the books started part-way through', () => {
    const { counted, firstFullMonth } = overheadWindow(TODAY, 6, new Date('2026-07-14'));
    expect(firstFullMonth).toBe('2026-08');
    expect(counted).toEqual(['2026-08', '2026-09', '2026-10']);
  });

  it('keeps a month the books started on its first day', () => {
    expect(overheadWindow(TODAY, 6, new Date('2026-08-01')).counted).toEqual(['2026-08', '2026-09', '2026-10']);
  });

  it('crosses a year end', () => {
    expect(overheadWindow(new Date('2027-02-03'), 3, new Date('2020-01-01')).counted).toEqual([
      '2026-11', '2026-12', '2027-01',
    ]);
  });
});

describe('suggestOverheadRate', () => {
  const run = (overrides: Partial<Parameters<typeof suggestOverheadRate>[0]> = {}) =>
    suggestOverheadRate({
      today: TODAY,
      months: 6,
      firstPosting: new Date('2025-01-01'),
      accounts: [rent, salaries, absorbed, marketing, cogs],
      ...overrides,
    });

  it('divides running costs, net of labour charged to jobs, by cost of sales', () => {
    const s = run();
    // (10k + 30k − 20k + 2k) × 6 = 132k over 80k × 6 = 480k.
    expect(s.status).toBe('READY');
    expect(s.overheadTotal).toBe(132_000);
    expect(s.directTotal).toBe(480_000);
    expect(s.ratePct).toBe(0.275);
    expect(s.suggestedPct).toBe(0.275);
    expect(s.monthsCounted).toEqual(SIX);
    expect(s.from).toBe('2026-05-01');
    expect(s.to).toBe('2026-10-31');
    expect(s.byMonth[0]).toEqual({ month: '2026-05', overhead: 22_000, direct: 80_000 });
  });

  it('lists each account with its total, largest codes in order', () => {
    const s = run();
    expect(s.overheadAccounts.map((a) => [a.code, a.amount])).toEqual([
      ['6100', 60_000], ['6300', 180_000], ['6390', -120_000], ['6700', 12_000],
    ]);
    expect(s.directAccounts.map((a) => [a.code, a.amount])).toEqual([['5000', 480_000]]);
  });

  it('leaves out an account the owner unticked but keeps it on the list', () => {
    const s = run({ excludeAccountCodes: ['6700'] });
    expect(s.overheadTotal).toBe(120_000);
    expect(s.ratePct).toBe(0.25);
    expect(s.overheadAccounts.find((a) => a.code === '6700')).toMatchObject({ included: false, amount: 12_000 });
  });

  it('never lets direct cost be unticked', () => {
    expect(run({ excludeAccountCodes: ['5000'] }).directTotal).toBe(480_000);
  });

  it('rounds the suggestion to a tenth of a percent', () => {
    const s = run({ accounts: [{ ...rent, byMonth: every(SIX, 10_001) }, cogs] });
    expect(s.ratePct).toBe(0.125);
    expect(s.suggestedPct).toBe(0.125);
    const odd = run({ accounts: [{ ...rent, byMonth: every(SIX, 10_000) }, { ...cogs, byMonth: every(SIX, 30_000) }] });
    expect(odd.ratePct).toBe(0.3333);
    expect(odd.suggestedPct).toBe(0.333);
  });

  it('waits for three full months on a new shop and says when', () => {
    const s = run({ firstPosting: new Date('2026-09-10') });
    expect(s.status).toBe('NOT_ENOUGH_HISTORY');
    expect(s.monthsCounted).toEqual(['2026-10']);
    expect(s.suggestedPct).toBeNull();
    expect(s.availableFrom).toBe('2027-01-01');
  });

  it('handles empty books', () => {
    const s = run({ firstPosting: null, accounts: [] });
    expect(s.status).toBe('NOT_ENOUGH_HISTORY');
    expect(s.availableFrom).toBeNull();
    expect(s.from).toBeNull();
  });

  it('uses the full months there are when fewer than asked', () => {
    const s = run({ firstPosting: new Date('2026-07-01') });
    expect(s.status).toBe('READY');
    expect(s.monthsCounted).toEqual(['2026-07', '2026-08', '2026-09', '2026-10']);
    expect(s.notes.join(' ')).toMatch(/only have 4 full months/);
  });

  it('refuses to divide by nothing', () => {
    const s = run({ accounts: [rent] });
    expect(s.status).toBe('NO_DIRECT_COST');
    expect(s.ratePct).toBeNull();
  });

  it('says so when no running costs were booked', () => {
    expect(run({ accounts: [cogs] }).status).toBe('NO_OVERHEAD');
  });

  it('flags overheads above direct cost instead of suggesting them', () => {
    const s = run({ accounts: [rent, salaries, { ...cogs, byMonth: every(SIX, 5_000) }] });
    expect(s.status).toBe('ABOVE_100');
    expect(s.ratePct).toBe(8);
    expect(s.suggestedPct).toBeNull();
    expect(s.notes.join(' ')).toMatch(/more than direct cost/);
  });

  it('warns that salaries may be charged twice when none were charged to jobs', () => {
    expect(run({ accounts: [rent, salaries, cogs] }).notes.join(' ')).toMatch(/charged twice/);
    expect(run().notes.join(' ')).not.toMatch(/charged twice/);
  });

  it('clamps the window to 3–12 months', () => {
    expect(run({ months: 1 }).monthsAsked).toBe(3);
    expect(run({ months: 40 }).monthsAsked).toBe(12);
  });
});
