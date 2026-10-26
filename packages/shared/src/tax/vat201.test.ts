import { describe, expect, it } from 'vitest';
import { buildVat201, reverseChargeTax } from './vat201';

const box = (dto: ReturnType<typeof buildVat201>, id: string) => dto.rows.find((r) => r.box === id)!;

describe('buildVat201', () => {
  const period = { from: '2026-07-01', to: '2026-09-30' };

  it('places sales by treatment and nets credit notes', () => {
    const dto = buildVat201({
      ...period,
      emirate: 'DXB',
      sales: [
        { treatment: 'STANDARD', rate: 5, net: 1000, tax: 50, creditNote: false },
        { treatment: 'STANDARD', rate: 5, net: -200, tax: -10, creditNote: true },
        { treatment: 'ZERO_RATED', rate: 0, net: 300, tax: 0, creditNote: false },
        { treatment: 'EXEMPT', rate: 0, net: 70, tax: 0, creditNote: false },
        { treatment: 'OUT_OF_SCOPE', rate: 0, net: 999, tax: 0, creditNote: false },
      ],
      purchases: [],
    });
    expect(box(dto, '1b')).toMatchObject({ amount: 800, vat: 50, adjustment: -10 });
    expect(box(dto, '1a').amount).toBe(0);
    expect(box(dto, '4').amount).toBe(300);
    expect(box(dto, '5').amount).toBe(70);
    expect(box(dto, '8')).toMatchObject({ amount: 1170, vat: 50, adjustment: -10 });
    expect(dto.totalDueTax).toBe(40);
    expect(dto.warnings).toEqual([]);
  });

  it('books reverse charge as due and recoverable, and leaves blocked VAT out', () => {
    const dto = buildVat201({
      ...period,
      emirate: 'AUH',
      sales: [{ treatment: 'STANDARD', rate: 5, net: 2000, tax: 100, creditNote: false }],
      purchases: [
        { treatment: 'STANDARD', rate: 5, net: 400, tax: 20, selfAssessed: 0 },
        { treatment: 'REVERSE_CHARGE', rate: 5, net: 600, tax: 0, selfAssessed: 30 },
        { treatment: 'IMPORT_GOODS', rate: 5, net: 1000, tax: 0, selfAssessed: 50 },
        { treatment: 'BLOCKED', rate: 5, net: 100, tax: 5, selfAssessed: 0 },
      ],
    });
    expect(box(dto, '3')).toMatchObject({ amount: 600, vat: 30 });
    expect(box(dto, '6')).toMatchObject({ amount: 1000, vat: 50 });
    expect(box(dto, '9')).toMatchObject({ amount: 400, vat: 20 });
    expect(box(dto, '10')).toMatchObject({ amount: 1600, vat: 80 });
    expect(dto.totalDueTax).toBe(180);
    expect(dto.totalRecoverableTax).toBe(100);
    // The self-assessed tax cancels: only the sale's 100 less the 20 reclaimed is owed.
    expect(dto.payableTax).toBe(80);
  });

  it('warns rather than guesses', () => {
    const dto = buildVat201({
      ...period,
      emirate: null,
      sales: [
        { treatment: null, rate: 5, net: 100, tax: 5, creditNote: false },
        { treatment: null, rate: 0, net: 100, tax: 0, creditNote: false },
      ],
      purchases: [],
    });
    expect(dto.warnings).toHaveLength(2);
    expect(box(dto, '8').amount).toBe(0);
  });
});

describe('reverseChargeTax', () => {
  it('is the rate on the net, to the fil', () => {
    expect(reverseChargeTax(1234.57, 5)).toBe(61.73);
    expect(reverseChargeTax(100, 0)).toBe(0);
  });
});
