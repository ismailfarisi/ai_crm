import { describe, expect, it } from 'vitest';
import { leaveAccrued, leaveForPeriod, leaveServiceDays, recordPeriods, sickDaysByServiceYear, type LeaveRecordInput } from './leave';

describe('leaveAccrued', () => {
  const at = (serviceDays: number) => leaveAccrued({ serviceDays, annualDays: 30 });
  it('nothing under six months', () => expect(at(152)).toBe(0));
  it('two days per completed month from six months', () => expect(at(229)).toBe(14)); // 7.5 months
  it('eleven months', () => expect(at(335)).toBe(22));
  it('a full year jumps to the annual entitlement', () => expect(at(365)).toBe(30));
  it('pro rata after the first year', () => expect(at(1085)).toBe(89.18)); // 3 years less 10 unpaid days
  it('uses the annual override', () => expect(leaveAccrued({ serviceDays: 730, annualDays: 45 })).toBe(90));
});

describe('leaveServiceDays', () => {
  it('excludes unpaid days', () => expect(leaveServiceDays({ joiningDate: '2026-01-01', asOf: '2026-01-31', unpaidDays: 3 })).toBe(28));
  it('never negative', () => expect(leaveServiceDays({ joiningDate: '2026-01-01', asOf: '2026-01-02', unpaidDays: 5 })).toBe(0));
});

const rec = (type: LeaveRecordInput['type'], startDate: string, endDate: string, days?: number): LeaveRecordInput => {
  const cal = Math.round((Date.parse(endDate) - Date.parse(startDate)) / 86_400_000) + 1;
  return { type, startDate, endDate, days: days ?? cal };
};
const base = { joiningDate: '2020-01-15', probationEndDate: null, leavingDate: null };

describe('leaveForPeriod', () => {
  it('a record spanning two months counts in each', () => {
    const records = [rec('ANNUAL', '2026-09-28', '2026-10-03')];
    expect(leaveForPeriod({ ...base, records, period: '2026-09' }).annualDays).toBe(3);
    expect(leaveForPeriod({ ...base, records, period: '2026-10' }).annualDays).toBe(3);
  });

  it('an edited-down record is spread evenly over its dates', () => {
    const r = leaveForPeriod({ ...base, records: [rec('ANNUAL', '2026-10-01', '2026-10-04', 2)], period: '2026-10' });
    expect(r.annualDays).toBe(2);
    expect(r.leaveDays).toBe(2);
  });

  it('sick leave: 15 full, then half, counted across the service year', () => {
    const records = [rec('SICK', '2026-02-01', '2026-02-10'), rec('SICK', '2026-10-01', '2026-10-20')];
    const r = leaveForPeriod({ ...base, records, period: '2026-10' });
    expect(r.sickFullDays).toBe(5);
    expect(r.halfPayDays).toBe(15);
    expect(r.unpaidDays).toBe(0);
    expect(r.leaveDays).toBe(20);
  });

  it('sick leave across the service-year anniversary', () => {
    // Service years start on 15 October. 45 days already used in the year to 14 Oct 2026.
    const records = [rec('SICK', '2026-03-01', '2026-04-14'), rec('SICK', '2026-10-10', '2026-10-20')];
    const r = leaveForPeriod({ ...base, joiningDate: '2020-10-15', records, period: '2026-10' });
    expect(r.unpaidDays).toBe(5); // 10–14 Oct: beyond 45 in the old year
    expect(r.sickFullDays).toBe(6); // 15–20 Oct: a new year, full pay again
    expect(r.halfPayDays).toBe(0);
  });

  it('sick days during probation are unpaid', () => {
    const r = leaveForPeriod({ ...base, joiningDate: '2026-08-01', probationEndDate: '2026-10-05', records: [rec('SICK', '2026-10-03', '2026-10-07')], period: '2026-10' });
    expect(r.unpaidDays).toBe(3);
    expect(r.sickFullDays).toBe(2);
  });

  it('maternity: 45 full, 15 half, then unpaid, counted per record', () => {
    const records = [rec('MATERNITY', '2026-09-01', '2026-11-15')];
    const oct = leaveForPeriod({ ...base, records, period: '2026-10' });
    expect(oct.otherPaidDays).toBe(15); // units 31..45
    expect(oct.halfPayDays).toBe(15); // units 46..60
    expect(oct.unpaidDays).toBe(1); // unit 61
  });

  it('unpaid and other paid leave', () => {
    const r = leaveForPeriod({ ...base, records: [rec('UNPAID', '2026-10-05', '2026-10-06'), rec('OTHER_PAID', '2026-10-10', '2026-10-12')], period: '2026-10' });
    expect(r.unpaidDays).toBe(2);
    expect(r.otherPaidDays).toBe(3);
    expect(r.leaveDays).toBe(5);
  });

  it('stops at the leaving date', () => {
    const r = leaveForPeriod({ ...base, leavingDate: '2026-10-10', records: [rec('ANNUAL', '2026-10-08', '2026-10-14')], period: '2026-10' });
    expect(r.annualDays).toBe(3);
  });
});

describe('sickDaysByServiceYear', () => {
  it('counts post-probation sick days per service year', () => {
    const m = sickDaysByServiceYear({ joiningDate: '2020-10-15', probationEndDate: null, records: [rec('SICK', '2026-10-10', '2026-10-20')] });
    expect(m.get(5)).toBe(5);
    expect(m.get(6)).toBe(6);
  });
});

describe('recordPeriods', () => {
  it('lists every month touched', () => expect(recordPeriods({ startDate: '2026-09-28', endDate: '2026-11-02' })).toEqual(['2026-09', '2026-10', '2026-11']));
});
