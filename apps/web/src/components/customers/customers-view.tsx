'use client';

import { useMemo, useState } from 'react';
import { ColumnDef } from '@tanstack/react-table';
import { Building2, Pencil, Plus, Trash2 } from 'lucide-react';
import { PERMISSIONS, type CustomerDto } from '@saas/shared';
import { useCustomers, useDeleteCustomer } from '@/hooks/use-customers';
import { formatRelative } from '@/lib/utils';
import { Can } from '@/components/auth/can';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { EmptyState, PageHeader } from '@/components/ui/primitives';
import { DataTable } from '@/components/ui/data-table';
import { DataTableColumnHeader } from '@/components/ui/data-table/data-table-column-header';
import { CustomerFormDialog } from './customer-form-dialog';

const PAGE_SIZE = 20;

export function CustomersView() {
  const [editing, setEditing] = useState<CustomerDto | null>(null);
  const [creating, setCreating] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<CustomerDto | null>(null);

  const { data, isPending, isError, error } = useCustomers({ page: 1, limit: 100 });
  const remove = useDeleteCustomer();

  const customers = data?.items ?? [];

  const columns = useMemo<ColumnDef<CustomerDto, any>[]>(
    () => [
      {
        accessorKey: 'companyName',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Company" />,
        cell: ({ row }) => (
          <div>
            <p className="font-medium text-ink">{row.original.companyName}</p>
            {row.original.email && (
              <p className="text-xs text-ink-subtle">{row.original.email}</p>
            )}
          </div>
        ),
      },
      {
        accessorKey: 'contactName',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Contact" />,
        cell: ({ row }) => <span className="text-ink-muted">{row.original.contactName ?? '—'}</span>,
      },
      {
        accessorKey: 'city',
        header: ({ column }) => <DataTableColumnHeader column={column} title="City" />,
        cell: ({ row }) => <span className="text-ink-muted">{row.original.city ?? '—'}</span>,
      },
      {
        accessorKey: 'country',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Country" />,
        cell: ({ row }) => <span className="text-ink-muted">{row.original.country ?? '—'}</span>,
      },
      {
        accessorKey: 'currency',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Currency" />,
        cell: ({ row }) => <span className="text-ink-muted">{row.original.currency ?? '—'}</span>,
      },
      {
        accessorKey: 'createdAt',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Added" />,
        cell: ({ row }) => (
          <span className="text-ink-subtle text-xs whitespace-nowrap">
            {formatRelative(row.original.createdAt)}
          </span>
        ),
      },
      {
        id: 'actions',
        cell: ({ row }) => (
          <div className="flex justify-end gap-1">
            <Can permission={PERMISSIONS.CUSTOMER_UPDATE}>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Edit ${row.original.companyName}`}
                onClick={() => setEditing(row.original)}
              >
                <Pencil className="size-4" />
              </Button>
            </Can>
            <Can permission={PERMISSIONS.CUSTOMER_DELETE}>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Delete ${row.original.companyName}`}
                onClick={() => setPendingDelete(row.original)}
              >
                <Trash2 className="size-4 text-danger" />
              </Button>
            </Can>
          </div>
        ),
      },
    ],
    []
  );

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

      {isError ? (
        <EmptyState
          title="Couldn't load customers"
          description={error instanceof Error ? error.message : 'Please try again.'}
        />
      ) : (
        <DataTable
          columns={columns}
          data={customers}
          isLoading={isPending}
          getRowId={(row) => row.id}
          cardTitleKey="companyName"
          cardSubtitleKey="contactName"
          enableRowSelection
          searchPlaceholder="Search company, contact, email or city…"
          emptyTitle="No customers yet"
          emptyDescription="Add your first customer to start building your book of business."
          emptyIcon={<Building2 className="size-8 text-ink-muted" />}
        />
      )}

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
