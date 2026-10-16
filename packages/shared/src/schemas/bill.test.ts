import { describe, expect, it } from 'vitest';
import { billLineSchema } from './bill';

const base = { description: 'Lease', qty: 1, unitCost: 100 };

describe('billLineSchema service period', () => {
  it('accepts a full period', () => {
    const r = billLineSchema.safeParse({ ...base, servicePeriodStart: '2026-01-01', servicePeriodEnd: '2026-12-31' });
    expect(r.success).toBe(true);
  });
  it('accepts neither', () => {
    const r = billLineSchema.parse(base);
    expect(r.servicePeriodStart).toBeNull();
    expect(r.servicePeriodEnd).toBeNull();
  });
  it('rejects only a start', () => {
    expect(billLineSchema.safeParse({ ...base, servicePeriodStart: '2026-01-01' }).success).toBe(false);
  });
  it('rejects an end before the start', () => {
    expect(billLineSchema.safeParse({ ...base, servicePeriodStart: '2026-02-01', servicePeriodEnd: '2026-01-01' }).success).toBe(false);
  });
  it('rejects a period on an order line', () => {
    const r = billLineSchema.safeParse({
      ...base,
      purchaseOrderLineId: '11111111-1111-4111-8111-111111111111',
      servicePeriodStart: '2026-01-01',
      servicePeriodEnd: '2026-12-31',
    });
    expect(r.success).toBe(false);
  });
});
