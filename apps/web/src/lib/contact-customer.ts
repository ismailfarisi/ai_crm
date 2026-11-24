import type { ContactDto, CustomerDto } from '@saas/shared';

const norm = (v: string | null | undefined) => (v ?? '').trim().toLowerCase();

/**
 * Contacts and customers are separate records with no link between them: a
 * contact is a person, a customer is the company you quote and invoice. A
 * contact belongs to a customer when its company name matches the customer's
 * name, or its email matches the customer's email.
 */
export function customerForContact(
  contact: Pick<ContactDto, 'company' | 'email'>,
  customers: CustomerDto[],
): CustomerDto | null {
  const company = norm(contact.company);
  const email = norm(contact.email);
  return (
    (company && customers.find((c) => norm(c.companyName) === company)) ||
    (email && customers.find((c) => norm(c.email) === email)) ||
    null
  );
}

/** What the customer search should look for: the company name, else the email. */
export function customerSearchFor(contact: Pick<ContactDto, 'company' | 'email'>): string {
  return contact.company?.trim() || contact.email?.trim() || '';
}
