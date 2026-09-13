'use client';

import { useMemo, useState } from 'react';
import { ColumnDef } from '@tanstack/react-table';
import { Factory, Pencil, Plus, Trash2 } from 'lucide-react';
import { PERMISSIONS, type SupplierDto } from '@saas/shared';
import { useDeleteSupplier, useSuppliers } from '@/hooks/use-suppliers';
import { formatRelative } from '@/lib/utils';
import { Can } from '@/components/auth/can';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { EmptyState, PageHeader } from '@/components/ui/primitives';
import { DataTable } from '@/components/ui/data-table';
import { DataTableColumnHeader } from '@/components/ui/data-table/data-table-column-header';
import { SupplierFormDialog } from './supplier-form-dialog';

export function SuppliersView() {
  const [editing, setEditing] = useState<SupplierDto | null>(null);
  const [creating, setCreating] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<SupplierDto | null>(null);

  const { data, isPending, isError, error } = useSuppliers({ page: 1, limit: 100 });
  const remove = useDeleteSupplier();

  const suppliers = data?.items ?? [];

  const columns = useMemo<ColumnDef<SupplierDto, any>[]>(
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
        accessorKey: 'country',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Country" />,
        cell: ({ row }) => <span className="text-ink-muted">{row.original.country ?? '—'}</span>,
      },
      {
        accessorKey: 'leadTimeDays',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Lead time" />,
        cell: ({ row }) => (
          <span className="text-ink-muted tabular-nums">
            {row.original.leadTimeDays == null ? '—' : `${row.original.leadTimeDays} days`}
          </span>
        ),
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
            <Can permission={PERMISSIONS.SUPPLIER_UPDATE}>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Edit ${row.original.companyName}`}
                onClick={() => setEditing(row.original)}
              >
                <Pencil className="size-4" />
              </Button>
            </Can>
            <Can permission={PERMISSIONS.SUPPLIER_DELETE}>
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
    [],
  );

  return (
    <>
      <PageHeader
        title="Suppliers"
        description="The companies you buy from."
        actions={
          <Can permission={PERMISSIONS.SUPPLIER_CREATE}>
            <Button onClick={() => setCreating(true)}>
              <Plus className="size-4" />
              New supplier
            </Button>
          </Can>
        }
      />

      {isError ? (
        <EmptyState
          title="Couldn't load suppliers"
          description={error instanceof Error ? error.message : 'Please try again.'}
        />
      ) : (
        <DataTable
          columns={columns}
          data={suppliers}
          isLoading={isPending}
          getRowId={(row) => row.id}
          cardTitleKey="companyName"
          cardSubtitleKey="contactName"
          enableRowSelection
          searchPlaceholder="Search company, contact or email…"
          emptyTitle="No suppliers yet"
          emptyDescription="Add a supplier to start raising purchase orders against them."
          emptyIcon={<Factory className="size-8 text-ink-muted" />}
        />
      )}

      <SupplierFormDialog
        open={creating || editing !== null}
        supplier={editing}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
      />

      <Dialog
        open={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        size="sm"
        title="Delete supplier"
        description={`${pendingDelete?.companyName} will be removed from your suppliers.`}
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
          Deleting is a soft delete — the record is hidden but retained, so purchase orders already
          raised against this supplier keep their history. It is refused while any of their orders
          are still open.
        </p>
      </Dialog>
    </>
  );
}
