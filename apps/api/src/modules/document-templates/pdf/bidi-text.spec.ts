import { visualRuns } from './bidi-text';

const drawn = (line: string) => visualRuns(line).runs.map((r) => r.text);

describe('visualRuns', () => {
  it('leaves Latin text as one left-to-right run', () => {
    expect(visualRuns('Total: AED 1,050.00')).toEqual({
      runs: [{ text: 'Total: AED 1,050.00', arabicFont: false }],
      rtl: false,
    });
  });

  it('keeps an Arabic run whole, in reading order, for fontkit to shape', () => {
    const { runs, rtl } = visualRuns('فاتورة ضريبية');
    expect(rtl).toBe(true);
    expect(runs).toHaveLength(1);
    expect(runs[0].arabicFont).toBe(true);
  });

  it('puts numbers and Latin inside Arabic in the right place, left to right', () => {
    const runs = drawn('الإجمالي: 1,050.00 AED');
    // Read right to left: label, amount, currency. Drawn left to right, the
    // currency comes first and the label last.
    expect(runs.join('')).toMatch(/^AED 1,050\.00/);
    expect(runs[runs.length - 1]).toContain('الإجمالي');
  });

  it('keeps a percent sign with its number', () => {
    expect(drawn('ضريبة القيمة المضافة (5%)').join('')).toContain('5%');
  });

  it('draws an English-first bilingual label in English then Arabic', () => {
    const runs = drawn('Total / الإجمالي');
    expect(runs[0]).toBe('Total / ');
    expect(runs[1]).toContain('الإجمالي');
  });
});
