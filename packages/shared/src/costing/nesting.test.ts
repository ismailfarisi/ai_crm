import { describe, it, expect } from 'vitest';
import { nestBlankOnSheet } from './nesting';

describe('nestBlankOnSheet', () => {
  it('lays blanks out as a guillotine grid', () => {
    // 980×680 usable after a 10mm margin: 4 across, 3 down.
    const nest = nestBlankOnSheet(240, 220, 1000, 700, { marginMm: 10, gutterMm: 0 });
    expect(nest.across).toBe(4);
    expect(nest.down).toBe(3);
    expect(nest.perSheet).toBe(12);
  });

  it('rotates the blank when that yields more per sheet', () => {
    const nest = nestBlankOnSheet(318, 368, 1000, 700, { marginMm: 10, gutterMm: 0 });
    // As-is: 3 across × 1 down = 3. Rotated: 2 × 2 = 4.
    expect(nest.orientation).toBe('ROTATED');
    expect(nest.perSheet).toBe(4);
  });

  it('refuses to rotate a grained stock, even when rotation would fit more', () => {
    const free = nestBlankOnSheet(318, 368, 1000, 700, { allowRotation: true, marginMm: 10 });
    const grained = nestBlankOnSheet(318, 368, 1000, 700, { allowRotation: false, marginMm: 10 });
    expect(free.perSheet).toBe(4);
    expect(grained.perSheet).toBe(3);
  });

  it('consumes gutters between blanks but not outside them', () => {
    // Rotation off, so this measures the gutter and not a change of orientation.
    const fixed = { marginMm: 10, allowRotation: false };
    const tight = nestBlankOnSheet(240, 220, 1000, 700, { ...fixed, gutterMm: 0 });
    const spaced = nestBlankOnSheet(240, 220, 1000, 700, { ...fixed, gutterMm: 20 });

    // n blanks span n*blank + (n-1)*gutter, so usable 980 fits 4 across at 0mm
    // (960 of board) but only 3 at 20mm (760 of board + 40 of gutter).
    expect(tight.across).toBe(4);
    expect(spaced.across).toBe(3);
  });

  it('returns zero when the blank simply does not fit', () => {
    expect(nestBlankOnSheet(1200, 400, 1000, 700).perSheet).toBe(0);
    // Fits on area alone, but not in either orientation.
    expect(nestBlankOnSheet(990, 690, 1000, 700, { marginMm: 10 }).perSheet).toBe(0);
  });

  it('reports utilisation so a near-miss layout can be flagged', () => {
    const nest = nestBlankOnSheet(490, 340, 1000, 700, { marginMm: 0, gutterMm: 0 });
    expect(nest.perSheet).toBe(4);
    expect(nest.utilisation).toBeCloseTo(0.952, 2);
  });

  it('rejects nonsense dimensions rather than dividing by zero', () => {
    expect(nestBlankOnSheet(0, 100, 1000, 700).perSheet).toBe(0);
    expect(nestBlankOnSheet(100, 100, 0, 700).perSheet).toBe(0);
    expect(nestBlankOnSheet(100, 100, 10, 10, { marginMm: 10 }).perSheet).toBe(0);
  });
});
