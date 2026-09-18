import { describe, expect, it } from 'vitest';
import { createCustomerSchema } from './customer';
import { countryCodeField } from './country';

/**
 * The bug being guarded: `taxRuleFor` matches an exact country code, so a
 * free-text country matched no rule and the sale was taxed wrongly or not at
 * all.
 */
describe('country codes on customers and suppliers', () => {
  it('keeps a code as a code', () => {
    expect(countryCodeField.parse('GB')).toBe('GB');
    expect(countryCodeField.parse('us')).toBe('US');
  });

  it('converts a name typed before the picker existed', () => {
    expect(countryCodeField.parse('United States')).toBe('US');
    expect(countryCodeField.parse('united kingdom')).toBe('GB');
  });

  it('converts the names people actually type', () => {
    expect(countryCodeField.parse('USA')).toBe('US');
    expect(countryCodeField.parse('UK')).toBe('GB');
    expect(countryCodeField.parse('UAE')).toBe('AE');
  });

  it('treats blank as absent rather than as a country', () => {
    expect(countryCodeField.parse('')).toBeNull();
    expect(countryCodeField.parse(null)).toBeNull();
    expect(countryCodeField.parse(undefined)).toBeNull();
  });

  it('refuses something that is not a country at all', () => {
    expect(() => countryCodeField.parse('Narnia')).toThrow(/Pick a country/);
  });

  it('normalises through the customer schema', () => {
    const parsed = createCustomerSchema.parse({
      companyName: 'Harbourline Foods Ltd',
      country: 'United Kingdom',
    });
    expect(parsed.country).toBe('GB');
  });
});
