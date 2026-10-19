import { describe, expect, it } from 'vitest';
import { updateOrganizationSchema } from './organization';

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
