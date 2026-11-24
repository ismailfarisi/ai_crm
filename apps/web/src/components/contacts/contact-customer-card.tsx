'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Building2, Plus } from 'lucide-react';
import { PERMISSIONS, type ContactDto, type CustomerDto } from '@saas/shared';
import { useSession } from '@/lib/session-context';
import { useCustomers } from '@/hooks/use-customers';
import { useUpdateContact } from '@/hooks/use-contacts';
import { customerForContact, customerSearchFor } from '@/lib/contact-customer';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/primitives';
import { CustomerFormDialog } from '@/components/customers/customer-form-dialog';

/**
 * Shows the customer company a contact works for, found by company name or
 * email, or offers to create it. Quotes and invoices go to the customer, so a
 * contact marked "Customer" still needs one before you can quote them.
 */
export function ContactCustomerCard({ contact }: { contact: ContactDto }) {
  const { can } = useSession();
  const canRead = can(PERMISSIONS.CUSTOMER_READ);
  const canCreate = can(PERMISSIONS.CUSTOMER_CREATE);
  const canUpdateContact = can(PERMISSIONS.CONTACT_UPDATE);
  const [creating, setCreating] = useState(false);
  const updateContact = useUpdateContact();

  const search = customerSearchFor(contact);
  const { data, isPending } = useCustomers(
    { search: search || undefined, limit: 10 },
    { enabled: canRead && Boolean(search) },
  );
  const customer = canRead && search ? customerForContact(contact, data?.items ?? []) : null;

  const defaults = useMemo(
    () => ({
      companyName: contact.company?.trim() || contact.fullName,
      contactName: contact.fullName,
      email: contact.email ?? '',
      phone: contact.phone ?? '',
    }),
    [contact],
  );

  // Point the contact at the new company so the two stay matched.
  const onSaved = async (saved: CustomerDto) => {
    if (!canUpdateContact) return;
    const input = {
      company: saved.companyName,
      ...(contact.status === 'lead' || contact.status === 'qualified' ? { status: 'customer' as const } : {}),
    };
    if (input.company !== contact.company || 'status' in input) {
      await updateContact.mutateAsync({ id: contact.id, input });
    }
  };

  if (!canRead) return null;

  return (
    <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
      <div className="flex items-start gap-3">
        <span className="grid size-9 place-items-center rounded-xl bg-surface-muted text-ink-subtle">
          <Building2 className="size-4" aria-hidden />
        </span>
        <div className="text-sm">
          <p className="text-xs font-medium uppercase tracking-wider text-ink-subtle">Customer company</p>
          {customer ? (
            <>
              <Link href={`/customers/${customer.id}`} className="font-semibold text-ink underline-offset-2 hover:underline">
                {customer.companyName}
              </Link>
              <p className="text-xs text-ink-muted">Quotes, orders and invoices for this company are on its customer page.</p>
            </>
          ) : isPending && search ? (
            <p className="text-ink-muted">Looking for a matching customer…</p>
          ) : (
            <>
              <p className="font-semibold text-ink">Not a customer company yet</p>
              <p className="max-w-prose text-xs text-ink-muted">
                A contact is a person you talk to. To quote or invoice them, add their company to Customers.
                {contact.status === 'customer' && ' Marking a contact as "Customer" does not do this on its own.'}
              </p>
            </>
          )}
        </div>
      </div>
      {!customer && !(isPending && search) && canCreate && (
        <Button variant="secondary" onClick={() => setCreating(true)}>
          <Plus className="size-4" aria-hidden />
          Make a customer
        </Button>
      )}
      <CustomerFormDialog
        open={creating}
        onClose={() => setCreating(false)}
        defaults={defaults}
        onSaved={onSaved}
      />
    </Card>
  );
}
