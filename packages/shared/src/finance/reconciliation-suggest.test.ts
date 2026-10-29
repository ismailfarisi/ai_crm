import { describe, expect, it } from 'vitest';
import { suggestReconciliation, type SuggestionLine } from './reconciliation-suggest';
import type { LedgerMovementDto } from './books';

const line = (id: string, date: string, amount: number, description = 'Transfer', reference: string | null = null): SuggestionLine => ({
  id,
  date,
  amount,
  description,
  reference,
});

const entry = (id: string, date: string, amount: number, description = 'Payment'): LedgerMovementDto => ({
  journalEntryId: id,
  entryNumber: `JE-${id}`,
  entryDate: `${date}T00:00:00.000Z`,
  referenceType: 'PAYMENT',
  description,
  amount,
});

describe('suggestReconciliation', () => {
  it('pairs a line with the one entry of the same amount, and calls it certain', () => {
    const s = suggestReconciliation([line('L1', '2026-10-05', -1250)], [entry('E1', '2026-10-03', -1250)]);
    expect(s).toEqual([
      expect.objectContaining({ kind: 'ONE_TO_ONE', lineIds: ['L1'], journalEntryIds: ['E1'], certain: true }),
    ]);
  });

  it('pairs equal amounts by nearest date, but never calls an ambiguous pairing certain', () => {
    const s = suggestReconciliation(
      [line('L1', '2026-10-01', 500), line('L2', '2026-10-06', 500)],
      [entry('E1', '2026-10-05', 500), entry('E2', '2026-10-02', 500)],
    );
    const pairs = Object.fromEntries(s.map((x) => [x.lineIds[0], x.journalEntryIds[0]]));
    expect(pairs).toEqual({ L1: 'E2', L2: 'E1' });
    expect(s.every((x) => !x.certain)).toBe(true);
  });

  it('prefers the entry whose description names the line’s reference', () => {
    const s = suggestReconciliation(
      [line('L1', '2026-10-05', 840, 'CHQ DEPOSIT', 'INV-2026-0012')],
      [
        entry('E1', '2026-10-05', 840, 'Payment for INV-2026-0099'),
        entry('E2', '2026-10-05', 840, 'Payment for INV-2026-0012'),
      ],
    );
    expect(s[0].journalEntryIds).toEqual(['E2']);
  });

  it('finds the entries a single deposit is made of', () => {
    const s = suggestReconciliation(
      [line('L1', '2026-10-10', 3100, 'CHEQUE DEPOSIT 3 ITEMS')],
      [
        entry('E1', '2026-10-08', 1200),
        entry('E2', '2026-10-09', 700),
        entry('E3', '2026-10-09', 1200),
        entry('E4', '2026-10-09', -700),
      ],
    );
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ kind: 'ONE_LINE_MANY_ENTRIES', lineIds: ['L1'], certain: false });
    expect([...s[0].journalEntryIds].sort()).toEqual(['E1', 'E2', 'E3']);
  });

  it('finds the lines a single entry was paid out as', () => {
    const s = suggestReconciliation(
      [line('L1', '2026-10-28', -2000), line('L2', '2026-10-28', -1800), line('L3', '2026-10-29', -1200), line('L4', '2026-10-28', 900)],
      [entry('E1', '2026-10-27', -5000, 'Payroll October')],
    );
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ kind: 'MANY_LINES_ONE_ENTRY', journalEntryIds: ['E1'] });
    expect([...s[0].lineIds].sort()).toEqual(['L1', 'L2', 'L3']);
  });

  it('suggests nothing outside the date window', () => {
    expect(suggestReconciliation([line('L1', '2026-10-30', 100)], [entry('E1', '2026-09-01', 100)])).toEqual([]);
  });

  it('never uses a line or an entry twice', () => {
    const s = suggestReconciliation(
      [line('L1', '2026-10-05', 300), line('L2', '2026-10-05', 600)],
      [entry('E1', '2026-10-05', 300), entry('E2', '2026-10-05', 300)],
    );
    const lines = s.flatMap((x) => x.lineIds);
    const entries = s.flatMap((x) => x.journalEntryIds);
    expect(new Set(lines).size).toBe(lines.length);
    expect(new Set(entries).size).toBe(entries.length);
    // L1 takes one 300 entry; the other cannot make 600 alone.
    expect(s).toHaveLength(1);
  });

  it('stays quick with many open items', () => {
    const lines = Array.from({ length: 60 }, (_, i) => line(`L${i}`, '2026-10-15', 1000 + i * 37));
    const movements = Array.from({ length: 60 }, (_, i) => entry(`E${i}`, '2026-10-14', 97 + i * 13));
    const started = Date.now();
    suggestReconciliation(lines, movements);
    expect(Date.now() - started).toBeLessThan(1500);
  });
});
