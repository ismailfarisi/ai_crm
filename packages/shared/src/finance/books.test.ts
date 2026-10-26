import { describe, expect, it } from 'vitest';
import {
  parseStatementAmount,
  parseStatementCsv,
  parseStatementDate,
  suggestMatches,
  type LedgerMovementDto,
} from './books';
import { manualJournalSchema, periodLockSchema } from '../schemas/books';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

describe('parseStatementAmount', () => {
  it.each([
    ['1,234.50', 1234.5],
    ['(45.00)', -45],
    ['-45', -45],
    ['AED 12.00', 12],
    ['12.00-', -12],
    ['', null],
    ['abc', null],
  ])('%s → %s', (raw, expected) => {
    expect(parseStatementAmount(raw)).toBe(expected);
  });
});

describe('parseStatementDate', () => {
  it.each([
    ['2026-10-05', '2026-10-05'],
    ['05/10/2026', '2026-10-05'],
    ['5-10-26', '2026-10-05'],
    ['05 Oct 2026', '2026-10-05'],
    ['31/02/2026', null],
    ['yesterday', null],
  ])('%s → %s', (raw, expected) => {
    expect(parseStatementDate(raw)).toBe(expected);
  });
});

describe('parseStatementCsv', () => {
  it('reads a signed amount column in any order', () => {
    const csv = 'Description,Amount,Date\n"Salary, October",-12000.00,30/10/2026\nCard refund,45,01/10/2026\n';
    const { lines, errors } = parseStatementCsv(csv);
    expect(errors).toEqual([]);
    expect(lines).toEqual([
      { date: '2026-10-30', description: 'Salary, October', amount: -12000, reference: null },
      { date: '2026-10-01', description: 'Card refund', amount: 45, reference: null },
    ]);
  });

  it('combines debit and credit columns, semicolon separated', () => {
    const csv = 'Value Date;Narrative;Debit;Credit;Reference\n2026-10-02;DEWA;350.00;;TX1\n2026-10-03;Customer;;1050.00;TX2';
    const { lines } = parseStatementCsv(csv);
    expect(lines.map((l) => [l.amount, l.reference])).toEqual([
      [-350, 'TX1'],
      [1050, 'TX2'],
    ]);
  });

  it('reports rows it cannot read instead of dropping them silently', () => {
    const { lines, errors } = parseStatementCsv('Date,Description,Amount\nnot a date,x,1\n2026-10-01,y,\n2026-10-01,z,5');
    expect(lines).toHaveLength(1);
    expect(errors.map((e) => e.row)).toEqual([1, 2]);
  });

  it('refuses a file without recognisable columns', () => {
    expect(parseStatementCsv('a,b,c\n1,2,3').errors[0].row).toBe(0);
  });
});

describe('suggestMatches', () => {
  const movement = (id: string, amount: number, entryDate: string): LedgerMovementDto => ({
    journalEntryId: id,
    entryNumber: id,
    entryDate,
    referenceType: 'INVOICE',
    description: '',
    amount,
  });

  it('keeps exact amounts inside the window, nearest date first', () => {
    const found = suggestMatches({ amount: 100, date: '2026-10-10' }, [
      movement('far', 100, '2026-09-01'),
      movement('later', 100, '2026-10-13'),
      movement('wrong', 100.01, '2026-10-10'),
      movement('near', 100, '2026-10-09T08:00:00.000Z'),
    ]);
    expect(found.map((m) => m.journalEntryId)).toEqual(['near', 'later']);
  });
});

describe('manualJournalSchema', () => {
  const base = { entryDate: '2026-10-31', memo: 'Depreciation October' };

  it('accepts a balanced journal', () => {
    const parsed = manualJournalSchema.parse({
      ...base,
      lines: [
        { ledgerAccountId: A, debit: 100.1 },
        { ledgerAccountId: B, credit: 100.1 },
      ],
    });
    expect(parsed.lines[0].credit).toBe(0);
  });

  it('refuses an unbalanced one', () => {
    const result = manualJournalSchema.safeParse({
      ...base,
      lines: [
        { ledgerAccountId: A, debit: 100 },
        { ledgerAccountId: B, credit: 99.99 },
      ],
    });
    expect(result.success).toBe(false);
  });

  it('refuses a line with both sides or neither', () => {
    for (const bad of [{ debit: 5, credit: 5 }, { debit: 0, credit: 0 }]) {
      const result = manualJournalSchema.safeParse({
        ...base,
        lines: [
          { ledgerAccountId: A, ...bad },
          { ledgerAccountId: B, debit: 0, credit: 0 },
        ],
      });
      expect(result.success).toBe(false);
    }
  });

  it('refuses an impossible date', () => {
    expect(periodLockSchema.safeParse({ lockedThrough: '2026-02-30' }).success).toBe(false);
    expect(periodLockSchema.parse({ lockedThrough: null }).lockedThrough).toBeNull();
  });
});
