import { describe, expect, it } from 'vitest';
import { buildSif, sifIncomeSplit } from './wps';

const employer = { employerId: '1234567', employerIdType: 'MOHRE' as const, payerRoutingCode: '803320101' };
const row = { personId: '10000000000001', routingCode: '803320101', iban: 'AE070331234567890123450', payStart: '2026-10-01', payEnd: '2026-10-31', days: 31, fixed: 22000, variable: 312.5, leaveDays: 2 };

describe('buildSif', () => {
  it('writes the exact MOHRE layout', () => {
    const out = buildSif({ employer, rows: [row], salaryMonth: '2026-10', createdAt: new Date('2026-10-28T06:05:09Z'), reference: 'PR-2026-0007' });
    // UAE time is UTC+4 with no daylight saving.
    expect(out.fileName).toBe('0000001234567261028100509.SIF');
    expect(out.content).toBe(
      'EDR,10000000000001,803320101,AE070331234567890123450,2026-10-01,2026-10-31,31,22000.00,312.50,2\r\n' +
        'SCR,0000001234567,803320101,2026-10-28,1005,102026,1,22312.50,AED,PR-2026-0007\r\n',
    );
  });

  it('free-zone employer IDs are not padded', () => {
    const out = buildSif({ employer: { ...employer, employerIdType: 'FREE_ZONE', employerId: 'JAFZA-778' }, rows: [row], salaryMonth: '2026-10', createdAt: new Date('2026-10-28T06:05:09Z'), reference: 'R' });
    expect(out.fileName).toBe('JAFZA-778261028100509.SIF');
    expect(out.content.split('\r\n')[1].startsWith('SCR,JAFZA-778,')).toBe(true);
  });

  it('rounds fractional leave days', () => {
    const out = buildSif({ employer, rows: [{ ...row, leaveDays: 1.5 }], salaryMonth: '2026-10', createdAt: new Date('2026-10-28T06:05:09Z'), reference: 'R' });
    expect(out.content.split('\r\n')[0].endsWith(',2')).toBe(true);
  });
});

describe('sifIncomeSplit', () => {
  it('fixed is net less variable', () => expect(sifIncomeSplit(9000, 500)).toEqual({ fixed: 8500, variable: 500 }));
  it('when deductions swallow the fixed part, everything is variable', () => expect(sifIncomeSplit(300, 500)).toEqual({ fixed: 0, variable: 300 }));
});
