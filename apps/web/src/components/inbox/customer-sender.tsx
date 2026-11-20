'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link2, ShieldCheck, ShieldQuestion } from 'lucide-react';
import { toast } from 'sonner';
import { PERMISSIONS, type ChannelProvider, type CustomerSenderCheckDto } from '@saas/shared';
import { api, queryKeys } from '@/lib/api/endpoints';
import { ApiError } from '@/lib/api/client';
import { useCan } from '@/lib/session-context';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/field';

const senderKey = (provider: string, identifier: string) =>
  ['channels', 'customer-sender', provider, identifier] as const;

/** What the agents make of this sender, in a sentence. */
function describe(check: CustomerSenderCheckDto, isEmail: boolean): string {
  const name = check.customer?.companyName;
  const what = isEmail ? 'address' : 'number';
  switch (check.status) {
    case 'LINKED':
      return `Linked to ${name}. An agent with the order or quote tools can tell this sender about ${name}'s orders and quotes.`;
    case 'ON_RECORD':
      return `This ${what} is on ${name}'s customer record. An agent with the order or quote tools can tell this sender about ${name}'s orders and quotes.`;
    case 'AMBIGUOUS':
      return `This ${what} is on more than one customer record, so agents tell it nothing about orders or quotes. Link it to the right customer.`;
    case 'UNSUPPORTED':
      return 'This sender cannot be matched to one customer (a group chat, or more than one address), so agents tell it nothing about orders or quotes.';
    default:
      return 'Not matched to a customer. Agents tell this sender nothing about orders or quotes.';
  }
}

interface CustomerSenderBarProps {
  /** The channel and sender of the conversation's latest inbound message. */
  provider: string;
  identifier: string;
}

/**
 * Which customer the agents treat a sender as, with the button to link the
 * sender to a customer or remove that link.
 */
export function CustomerSenderBar({ provider, identifier }: CustomerSenderBarProps) {
  const queryClient = useQueryClient();
  const [picking, setPicking] = useState(false);
  const key = senderKey(provider, identifier);
  // Seeing which customer a sender is needs both the inbox and the customers.
  const canSee = useCan({ permission: [PERMISSIONS.CHANNEL_READ, PERMISSIONS.CUSTOMER_READ] });
  const canLink = useCan({ permission: PERMISSIONS.CUSTOMER_UPDATE });
  const { data: check } = useQuery({
    queryKey: key,
    queryFn: () => api.channels.customerSenders.check(provider, identifier),
    enabled: canSee,
  });
  const unlink = useMutation({
    mutationFn: (id: string) => api.channels.customerSenders.unlink(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: key });
      toast.success('Link removed');
    },
    onError: (error) =>
      toast.error(error instanceof ApiError ? error.message : "Couldn't remove the link"),
  });

  if (!check) return null;
  const known = check.status === 'LINKED' || check.status === 'ON_RECORD';
  const Icon = known ? ShieldCheck : ShieldQuestion;

  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border bg-surface px-4 py-2.5 text-xs">
      <p className="flex min-w-0 items-start gap-1.5 text-ink-muted">
        <Icon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        <span>
          <span className="font-medium text-ink">
            {known ? `Customer: ${check.customer?.companyName}. ` : 'Customer: not known. '}
          </span>
          {describe(check, provider.startsWith('EMAIL'))}
        </span>
      </p>
      {check.status !== 'UNSUPPORTED' && canLink && (
        <>
          <div className="flex shrink-0 items-center gap-2">
            {check.linkId && (
              <Button
                size="sm"
                variant="ghost"
                loading={unlink.isPending}
                onClick={() => unlink.mutate(check.linkId!)}
              >
                Remove link
              </Button>
            )}
            <Button size="sm" variant="secondary" onClick={() => setPicking(true)}>
              <Link2 className="size-3.5" aria-hidden />
              {check.status === 'LINKED' ? 'Change customer' : 'Link to a customer'}
            </Button>
          </div>
          <LinkCustomerDialog
            open={picking}
            onClose={() => setPicking(false)}
            provider={provider}
            identifier={identifier}
            onLinked={() => queryClient.invalidateQueries({ queryKey: key })}
          />
        </>
      )}
    </div>
  );
}

function LinkCustomerDialog({
  open,
  onClose,
  provider,
  identifier,
  onLinked,
}: CustomerSenderBarProps & { open: boolean; onClose: () => void; onLinked: () => void }) {
  const [search, setSearch] = useState('');
  const [customerId, setCustomerId] = useState('');
  const params = { limit: 8, search: search.trim() || undefined, sortBy: 'companyName', sortOrder: 'ASC' } as const;
  const { data, isPending } = useQuery({
    queryKey: queryKeys.customers(params),
    queryFn: () => api.customers.list(params),
    enabled: open,
  });
  const link = useMutation({
    mutationFn: () =>
      api.channels.customerSenders.link({
        customerId,
        provider: provider as ChannelProvider,
        identifier,
      }),
    onSuccess: () => {
      onLinked();
      toast.success('Sender linked to the customer');
      setCustomerId('');
      setSearch('');
      onClose();
    },
    onError: (error) =>
      toast.error(error instanceof ApiError ? error.message : "Couldn't link the sender"),
  });
  const customers = data?.items ?? [];

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="sm"
      title="Link this sender to a customer"
      description={`Only link ${identifier} if you are sure it belongs to the customer. An agent with the order or quote tools will tell this sender about that customer's orders, quotes and balance.`}
      footer={
        <>
          <Button variant="secondary" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={!customerId}
            loading={link.isPending}
            onClick={() => link.mutate()}
          >
            Link sender
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Input
          label="Find the customer"
          placeholder="Company name"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div role="radiogroup" aria-label="Customer" className="space-y-1">
          {customers.map((customer) => (
            <label
              key={customer.id}
              className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-ink hover:bg-surface-muted"
            >
              <input
                type="radio"
                name="link-customer"
                className="size-4 accent-[var(--color-brand)]"
                checked={customerId === customer.id}
                onChange={() => setCustomerId(customer.id)}
              />
              <span className="min-w-0">
                <span className="block truncate">{customer.companyName}</span>
                {(customer.phone || customer.email) && (
                  <span className="block truncate text-xs text-ink-muted">
                    {[customer.phone, customer.email].filter(Boolean).join(' · ')}
                  </span>
                )}
              </span>
            </label>
          ))}
          {!isPending && customers.length === 0 && (
            <p className="px-2 text-xs text-ink-muted">No customer matches that name.</p>
          )}
        </div>
      </div>
    </Dialog>
  );
}
