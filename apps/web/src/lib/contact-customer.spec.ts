import { describe, expect, it } from 'vitest';
import type { CustomerDto } from '@saas/shared';
import { customerForContact, customerSearchFor } from './contact-customer';

const customer = (over: Partial<CustomerDto>) => ({ id: 'c', companyName: 'X', email: null, ...over }) as CustomerDto;

describe('customerForContact', () => {
  const list = [
    customer({ id: 'a', companyName: 'Northwind Trading LLC', email: 'buy@northwind.ae' }),
    customer({ id: 'b', companyName: 'Northwind', email: 'ops@acme.ae' }),
  ];

  it('matches the company name exactly, ignoring case and spaces, not as a substring', () => {
    expect(customerForContact({ company: ' northwind ', email: null }, list)?.id).toBe('b');
  });

  it('falls back to the email when the company does not match', () => {
    expect(customerForContact({ company: 'Unknown', email: 'BUY@northwind.ae' }, list)?.id).toBe('a');
  });

  it('returns null when nothing matches or the contact has no company or email', () => {
    expect(customerForContact({ company: 'Other', email: 'x@y.z' }, list)).toBeNull();
    expect(customerForContact({ company: null, email: null }, list)).toBeNull();
  });

  it('searches by company, else email', () => {
    expect(customerSearchFor({ company: 'Acme', email: 'a@b.c' })).toBe('Acme');
    expect(customerSearchFor({ company: '  ', email: 'a@b.c' })).toBe('a@b.c');
  });
});
