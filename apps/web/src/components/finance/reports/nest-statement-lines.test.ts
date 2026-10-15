import { describe, expect, it } from 'vitest';
import type { StatementLineDto } from '@saas/shared';
import { nestStatementLines } from './nest-statement-lines';

const line = (id: string, code: string, amount: number, parentId: string | null = null): StatementLineDto => ({
  ledgerAccountId: id,
  code,
  name: `Account ${code}`,
  type: 'EXPENSE',
  amount,
  parentId,
});

describe('nestStatementLines', () => {
  it('places children after their parent, indented, with a subtotal', () => {
    const rows = nestStatementLines([
      line('c', '6100', 100, 'p'),
      line('x', '7000', 5),
      line('p', '6000', 20),
    ]);
    expect(rows.map((r) => [r.line.code, r.depth, !!r.isSubtotalRow])).toEqual([
      ['7000', 0, false],
      ['6000', 0, false],
      ['6100', 1, false],
      ['6000', 0, true],
    ]);
    expect(rows[1].subtotal).toBe(120);
    expect(rows[3].subtotal).toBe(120);
  });

  it('shows a zero parent with its child total', () => {
    const rows = nestStatementLines([line('p', '6000', 0), line('c', '6100', 80.1, 'p')]);
    expect(rows[0].subtotal).toBe(80.1);
  });

  it('treats a child with a missing parent as top level', () => {
    const rows = nestStatementLines([line('c', '6100', 10, 'gone')]);
    expect(rows).toEqual([{ line: expect.objectContaining({ code: '6100' }), depth: 0, subtotal: undefined }]);
  });

  it('leaves flat lists in order with no subtotals', () => {
    const rows = nestStatementLines([line('a', '1', 1), line('b', '2', 2)]);
    expect(rows.map((r) => r.line.code)).toEqual(['1', '2']);
    expect(rows.every((r) => r.subtotal === undefined)).toBe(true);
  });
});
