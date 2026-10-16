import { BadRequestException } from '@nestjs/common';
import { validPeriod } from './payroll-compliance.controller';

describe('validPeriod', () => {
  it('accepts YYYY-MM', () => {
    expect(validPeriod('2026-10')).toBe('2026-10');
    expect(validPeriod('2026-01')).toBe('2026-01');
  });

  it.each(['2026-13', '2026-00', 'abcd-10', '2026-1', '2026-10-01', ''])(
    'rejects %p with 400',
    (p) => {
      expect(() => validPeriod(p)).toThrow(BadRequestException);
    },
  );
});
