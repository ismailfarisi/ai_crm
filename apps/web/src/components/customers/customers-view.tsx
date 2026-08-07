'use client';

import { useEffect, useMemo, useState } from 'react';
import { Building2, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { PERMISSIONS, type CustomerDto } from '@saas/shared';
import { useCustomers, useDeleteCustomer } from '@/hooks/use-customers';
import { formatRelative } from '@/lib/utils';
import { Can } from '@/components/auth/can';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/field';
import { Card, EmptyState, PageHeader, Skeleton } from '@/components/ui/primitives';
import { CustomerFormDialog } from './customer-form-dialog';

const PAGE_SIZE = 20;

export function CustomersView() {
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [page, setPage] = useState(1);

  const [editing, setEditing] = useState<CustomerDto | null>(null);
  const [creating, setCreating] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<CustomerDto | null>(null);

  // Debounce so typing doesn't fire a request per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const params = useMemo(
    () => ({
      page,
      limit: PAGE_SIZE,
      search: debouncedSearch || undefined,
    }),
    [page, debouncedSearch],
  );

  const { data, isPending, isError, error } = useCustomers(params);
  const remove = useDeleteCustomer();

  const customers = data?.items ?? [];
  const meta = data?.meta;

  return (
    <>
      <PageHeader
        title="Customers"
        description="The companies you sell to."
        actions={
          <Can permission={PERMISSIONS.CUSTOMER_CREATE}>
            <Button onClick={() => setCreating(true)}>
              <Plus className="size-4" />
              New customer
            </Button>
          </Can>
        }
      />

      <Card>
        <div className="flex flex-wrap items-end gap-3 border-b border-border px-4 py-3">
          <div className="relative min-w-56 flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-subtle" />
            <Input
              aria-label="Search customers"
              placeholder="Search company, contact, email or city…"
              className="pl-9"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
        </div>

        {isPending ? (
          <div className="space-y-3 p-4">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : isError ? (
          <EmptyState
            title="Couldn't load customers"
            description={error instanceof Error ? error.message : 'Please try again.'}
          />
        ) : customers.length === 0 ? (
          <EmptyState
            icon={<Building2 className="size-8" />}
            title={debouncedSearch ? 'No matching customers' : 'No customers yet'}
            description={
              debouncedSearch
                ? 'Try a different search.'
                : 'Add your first customer to start building your book of business.'
            }
            action={
              <Can permission={PERMISSIONS.CUSTOMER_CREATE}>
                <Button onClick={() => setCreating(true)}>
                  <Plus className="size-4" />
                  New customer
                </Button>
              </Can>
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-ink-subtle">
                  <th scope="col" className="px-4 py-2.5 font-medium">Company</th>
                  <th scope="col" className="hidden px-4 py-2.5 font-medium md:table-cell">Contact</th>
                  <th scope="col" className="hidden px-4 py-2.5 font-medium sm:table-cell">City</th>
                  <th scope="col" className="hidden px-4 py-2.5 font-medium sm:table-cell">Country</th>
                  <th scope="col" className="px-4 py-2.5 font-medium">Currency</th>
                  <th scope="col" className="hidden px-4 py-2.5 font-medium sm:table-cell">Added</th>
                  <th scope="col" className="px-4 py-2.5 text-right font-medium">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {customers.map((customer) => (
                  <tr
                    key={customer.id}
                    className="border-b border-border last:border-0 hover:bg-surface-muted/60"
                  >
                    <td className="px-4 py-3">
                      <p className="font-medium text-ink">{customer.companyName}</p>
                      {customer.email && (
                        <p className="text-xs text-ink-subtle">{customer.email}</p>
                      )}
                    </td>
                    <td className="hidden px-4 py-3 text-ink-muted md:table-cell">
                      {customer.contactName ?? '—'}
                    </td>
                    <td className="hidden px-4 py-3 text-ink-muted sm:table-cell">
                      {customer.city ?? '—'}
                    </td>
                    <td className="hidden px-4 py-3 text-ink-muted sm:table-cell">
                      {customer.country ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-ink-muted">{customer.currency ?? '—'}</td>
                    <td className="hidden px-4 py-3 text-ink-subtle sm:table-cell">
                      {formatRelative(customer.createdAt)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1">
                        <Can permission={PERMISSIONS.CUSTOMER_UPDATE}>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Edit ${customer.companyName}`}
                            onClick={() => setEditing(customer)}
                          >
                            <Pencil className="size-4" />
                          </Button>
                        </Can>
                        <Can permission={PERMISSIONS.CUSTOMER_DELETE}>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Delete ${customer.companyName}`}
                            onClick={() => setPendingDelete(customer)}
                          >
                            <Trash2 className="size-4 text-danger" />
                          </Button>
                        </Can>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {meta && meta.total > 0 && (
          <div className="flex items-center justify-between border-t border-border px-4 py-3 text-sm">
            <p className="text-ink-muted">
              {(meta.page - 1) * meta.limit + 1}–{Math.min(meta.page * meta.limit, meta.total)} of{' '}
              {meta.total}
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={!meta.hasPreviousPage}
                onClick={() => setPage((p) => p - 1)}
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={!meta.hasNextPage}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </Card>

      <CustomerFormDialog
        open={creating || editing !== null}
        customer={editing}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
      />

      <Dialog
        open={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        size="sm"
        title="Delete customer"
        description={`${pendingDelete?.companyName} will be removed from your customers. This can be undone by an administrator.`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setPendingDelete(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={remove.isPending}
              onClick={async () => {
                if (!pendingDelete) return;
                await remove.mutateAsync(pendingDelete.id);
                setPendingDelete(null);
              }}
            >
              Delete
            </Button>
          </>
        }
      >
        <p className="text-sm text-ink-muted">
          Deleting is a soft delete — the record is hidden but retained for audit purposes.
        </p>
      </Dialog>
    </>
  );
}
