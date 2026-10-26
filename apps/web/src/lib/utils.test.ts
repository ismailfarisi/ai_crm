import { describe, expect, it } from 'vitest';
import { formatMoney } from './utils';

// Intl separates the code from the number with a no-break space.
const plain = (s: string) => s.replace(/ /g, ' ');

describe('formatMoney', () => {
  it('prints the currency it is given, not a dollar sign', () => {
    expect(plain(formatMoney(39532.5, 'AED'))).toBe('AED 39,532.50');
    expect(plain(formatMoney(154245, 'AED', { decimals: 0 }))).toBe('AED 154,245');
    expect(formatMoney(12, 'USD')).toBe('$12.00');
  });

  it('prints the bare number while the currency is still unknown', () => {
    expect(formatMoney(1250, undefined)).toBe('1,250.00');
  });

  it('falls back to the code for a currency Intl does not know', () => {
    expect(formatMoney(5, 'XX1')).toBe('XX1 5.00');
  });
});
