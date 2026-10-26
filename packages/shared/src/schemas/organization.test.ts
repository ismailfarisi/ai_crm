import { describe, expect, it } from 'vitest';
import { formatOrganizationAddress, updateOrganizationSchema } from './organization';

describe('updateOrganizationSchema', () => {
  it('leaves an omitted key out, so a PATCH touches only what it sends', () => {
    const out = updateOrganizationSchema.parse({ name: 'X' });
    expect(out).toEqual({ name: 'X' });
    expect(out).not.toHaveProperty('country');
    expect(out).not.toHaveProperty('addressLine1');
  });

  it('clears a field sent as empty or null', () => {
    expect(updateOrganizationSchema.parse({ country: '' })).toEqual({ country: null });
    expect(updateOrganizationSchema.parse({ city: null, email: '' })).toEqual({ city: null, email: null });
  });

  it('still normalises what is sent', () => {
    expect(updateOrganizationSchema.parse({ country: 'ae', taxId: '100-1234-5678-9012' })).toEqual({
      country: 'AE',
      taxId: '100123456789012',
    });
  });
});

describe('formatOrganizationAddress', () => {
  const base = { addressLine1: 'Warehouse 12, Al Quoz 3', addressLine2: null, postalCode: null, country: 'AE' };

  it('says the city once when the emirate is the same city', () => {
    expect(formatOrganizationAddress({ ...base, city: 'Dubai', region: 'Dubai' })).toEqual([
      'Warehouse 12, Al Quoz 3',
      'Dubai',
      'AE',
    ]);
    expect(formatOrganizationAddress({ ...base, city: 'Dubai', region: ' dubai ' })[1]).toBe('Dubai');
  });

  it('keeps a region that differs from the city', () => {
    expect(formatOrganizationAddress({ ...base, city: 'Khor Fakkan', region: 'Sharjah', postalCode: '123' })[1]).toBe(
      'Khor Fakkan, Sharjah, 123',
    );
  });
});
