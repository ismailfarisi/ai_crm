import { describe, expect, it } from 'vitest';
import { adjustStockSchema } from './inventory';

const materialId = '11111111-1111-4111-8111-111111111111';
const issues = (input: unknown) => {
  const result = adjustStockSchema.safeParse(input);
  return result.success ? [] : result.error.issues.map((i) => i.path.join('.'));
};

describe('adjustStockSchema', () => {
  it('is a correction unless it says otherwise', () => {
    const parsed = adjustStockSchema.parse({ materialId, qtyDelta: -3, note: 'Damaged' });
    expect(parsed.kind).toBe('CORRECTION');
    expect(parsed.unitCost).toBeNull();
  });

  it('does not take a unit cost as a sign of an opening count', () => {
    expect(issues({ materialId, qtyDelta: 5, unitCost: 12, note: 'Recount' })).toEqual([
      'unitCost',
    ]);
    // A form that sends an explicit null is still a plain correction.
    expect(issues({ materialId, qtyDelta: 5, unitCost: null, note: 'Recount' })).toEqual([]);
  });

  it('accepts an opening count with a quantity and a cost', () => {
    const parsed = adjustStockSchema.parse({
      materialId,
      kind: 'OPENING',
      qtyDelta: '20',
      unitCost: '12',
      note: 'Opening stock count',
    });
    expect(parsed).toMatchObject({ kind: 'OPENING', qtyDelta: 20, unitCost: 12 });
  });

  it('refuses an opening count without a cost, or one that takes stock away', () => {
    expect(issues({ materialId, kind: 'OPENING', qtyDelta: 20, note: 'Opening' })).toEqual([
      'unitCost',
    ]);
    expect(
      issues({ materialId, kind: 'OPENING', qtyDelta: -20, unitCost: 12, note: 'Opening' }),
    ).toEqual(['qtyDelta']);
  });
});
