import { describe, expect, it } from 'vitest';
import {
  createCustomerSchema,
  customerQuerySchema,
  updateCustomerSchema,
} from './customer';

describe('createCustomerSchema', () => {
  it('requires a company name', () => {
    expect(createCustomerSchema.safeParse({}).success).toBe(false);
    expect(createCustomerSchema.safeParse({ companyName: '' }).success).toBe(false);
    expect(
      createCustomerSchema.parse({ companyName: '  Acme  ' }).companyName,
    ).toBe('Acme');
  });

  it('normalizes blank optional text to null', () => {
    const parsed = createCustomerSchema.parse({
      companyName: 'Acme',
      contactName: '',
      city: '   ',
      notes: null,
    });
    expect(parsed.contactName).toBeNull();
    expect(parsed.city).toBeNull();
    expect(parsed.notes).toBeNull();
  });

  it('normalizes and validates email', () => {
    expect(createCustomerSchema.parse({ companyName: 'A', email: ' B@Acme.com ' }).email).toBe(
      'b@acme.com',
    );
    expect(
      createCustomerSchema.safeParse({ companyName: 'A', email: 'not-an-email' }).success,
    ).toBe(false);
  });

  it('leaves currency empty for the organisation default and applies payment terms', () => {
    // No currency means the API fills in the organisation's base currency.
    const parsed = createCustomerSchema.parse({ companyName: 'Acme' });
    expect(parsed.currency).toBeNull();
    expect(parsed.paymentTermsDays).toBe(30);
  });

  it('validates currency shape and normalizes case', () => {
    expect(createCustomerSchema.parse({ companyName: 'A', currency: 'usd' }).currency).toBe('USD');
    expect(createCustomerSchema.safeParse({ companyName: 'A', currency: 'US' }).success).toBe(
      false,
    );
    expect(createCustomerSchema.safeParse({ companyName: 'A', currency: '' }).success).toBe(true);
  });

  it('coerces payment terms to an integer within range', () => {
    expect(
      createCustomerSchema.parse({ companyName: 'A', paymentTermsDays: '45' }).paymentTermsDays,
    ).toBe(45);
    expect(createCustomerSchema.safeParse({ companyName: 'A', paymentTermsDays: 400 }).success).toBe(
      false,
    );
    expect(createCustomerSchema.safeParse({ companyName: 'A', paymentTermsDays: -1 }).success).toBe(
      false,
    );
  });
});

describe('updateCustomerSchema', () => {
  it('is partial and accepts empty updates', () => {
    expect(updateCustomerSchema.safeParse({}).success).toBe(true);
    expect(updateCustomerSchema.safeParse({ companyName: 'Renamed' }).success).toBe(true);
  });

  it('does not re-apply defaults for omitted currency/payment terms', () => {
    const parsed = updateCustomerSchema.parse({ notes: 'hello' });
    expect(parsed).not.toHaveProperty('currency');
    expect(parsed).not.toHaveProperty('paymentTermsDays');
    expect(parsed.notes).toBe('hello');
  });

  it('still validates currency and payment terms when provided', () => {
    const parsed = updateCustomerSchema.parse({ currency: 'eur', paymentTermsDays: '60' });
    expect(parsed.currency).toBe('EUR');
    expect(parsed.paymentTermsDays).toBe(60);
    expect(updateCustomerSchema.safeParse({ currency: 'US' }).success).toBe(false);
  });
});

describe('customerQuerySchema', () => {
  it('coerces page/limit and defaults sort', () => {
    const parsed = customerQuerySchema.parse({ page: '2', limit: '50' });
    expect(parsed.page).toBe(2);
    expect(parsed.limit).toBe(50);
    expect(parsed.sortBy).toBe('createdAt');
    expect(parsed.sortOrder).toBe('DESC');
  });

  it('rejects bad sort fields', () => {
    expect(customerQuerySchema.safeParse({ sortBy: 'email' }).success).toBe(false);
  });
});

describe('UAE fields', () => {
  it('stores an AE TRN as digits only', () => {
    const parsed = createCustomerSchema.parse({
      companyName: 'Acme',
      country: 'AE',
      taxId: '100-1234-5678-9012',
    });
    expect(parsed.taxId).toBe('100123456789012');
  });

  it('rejects a malformed AE TRN on taxId', () => {
    const result = createCustomerSchema.safeParse({
      companyName: 'Acme',
      country: 'AE',
      taxId: '12345',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path[0] === 'taxId');
      expect(issue?.message).toBe('A UAE TRN is 15 digits');
    }
  });

  it('leaves a non-AE tax id unchanged', () => {
    const parsed = createCustomerSchema.parse({
      companyName: 'Acme',
      country: 'GB',
      taxId: 'GB123456789',
    });
    expect(parsed.taxId).toBe('GB123456789');
  });

  it('forces emirate to null outside the UAE', () => {
    const parsed = createCustomerSchema.parse({
      companyName: 'Acme',
      country: 'GB',
      emirate: 'DXB',
    });
    expect(parsed.emirate).toBeNull();
  });

  it('keeps emirate in the UAE', () => {
    const parsed = createCustomerSchema.parse({
      companyName: 'Acme',
      country: 'AE',
      emirate: 'DXB',
    });
    expect(parsed.emirate).toBe('DXB');
  });

  it('re-parses a DTO-shaped customer', () => {
    const dto = {
      id: 'c1',
      companyName: 'Acme',
      contactName: null,
      email: null,
      phone: null,
      addressLine1: null,
      addressLine2: null,
      city: null,
      postalCode: null,
      country: 'AE',
      taxId: '100123456789012',
      emirate: 'DXB',
      vatStatus: 'REGISTERED',
      currency: 'AED',
      paymentTermsDays: 30,
      notes: null,
    };
    const parsed = createCustomerSchema.parse(dto);
    expect(parsed.vatStatus).toBe('REGISTERED');
    expect(parsed.emirate).toBe('DXB');
  });

  it('applies the TRN check on update only when the patch carries AE', () => {
    expect(updateCustomerSchema.safeParse({ taxId: '12345' }).success).toBe(true);
    expect(updateCustomerSchema.safeParse({ country: 'AE', taxId: '12345' }).success).toBe(false);
  });
});
