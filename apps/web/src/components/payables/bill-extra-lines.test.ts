import { describe, expect, it } from 'vitest';
import { buildExtraLine, emptyExtraLine } from './bill-extra-lines';

const draft = (p: Partial<ReturnType<typeof emptyExtraLine>>) => ({
  ...emptyExtraLine(),
  description: 'Annual lease',
  unitCost: '1200',
  ...p,
});

describe('buildExtraLine', () => {
  it('ignores an untouched draft', () => {
    expect(buildExtraLine(emptyExtraLine()).status).toBe('blank');
  });

  it('builds a plain line with no period', () => {
    const r = buildExtraLine(draft({ category: 'Rent' }));
    expect(r.status).toBe('ok');
    if (r.status === 'ok') {
      expect(r.line).toMatchObject({ category: 'Rent', qty: 1, unitCost: 1200, servicePeriodStart: null, servicePeriodEnd: null });
    }
  });

  it('carries a full spread period', () => {
    const r = buildExtraLine(draft({ spread: true, start: '2026-01-01', end: '2026-12-31' }));
    expect(r.status === 'ok' && r.line.servicePeriodEnd).toBe('2026-12-31');
  });

  it('rejects a spread with only a start', () => {
    const r = buildExtraLine(draft({ spread: true, start: '2026-01-01' }));
    expect(r).toMatchObject({ status: 'invalid', message: expect.stringContaining('both') });
  });

  it('rejects an end before the start', () => {
    const r = buildExtraLine(draft({ spread: true, start: '2026-02-01', end: '2026-01-01' }));
    expect(r).toMatchObject({ status: 'invalid', message: 'The period cannot end before it starts' });
  });

  it('drops dates when the toggle is off', () => {
    const r = buildExtraLine(draft({ spread: false, start: '2026-02-01', end: '2026-01-01' }));
    expect(r.status).toBe('ok');
  });

  it('requires a description', () => {
    expect(buildExtraLine(draft({ description: ' ' })).status).toBe('invalid');
  });
});
