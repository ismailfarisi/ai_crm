'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ColumnDef } from '@tanstack/react-table';
import { Pencil, Plus, Trash2, Users } from 'lucide-react';
import {
  CONTACT_SOURCES,
  CONTACT_SOURCE_LABELS,
  CONTACT_STATUSES,
  CONTACT_STATUS_LABELS,
  PERMISSIONS,
  type ContactDto,
  type ContactStatus,
} from '@saas/shared';
import { useSession } from '@/lib/session-context';
import { useContacts, useDeleteContact } from '@/hooks/use-contacts';
import { api, queryKeys } from '@/lib/api/endpoints';
import { formatRelative } from '@/lib/utils';
import { Can } from '@/components/auth/can';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Select } from '@/components/ui/field';
import { Badge, EmptyState, PageHeader } from '@/components/ui/primitives';
import { DataTable } from '@/components/ui/data-table';
import { DataTableColumnHeader } from '@/components/ui/data-table/data-table-column-header';
import { ContactFormDialog } from './contact-form-dialog';

const STATUS_TONES: Record<ContactStatus, 'brand' | 'success' | 'warning' | 'danger' | 'neutral'> = {
  lead: 'brand',
  qualified: 'warning',
  customer: 'success',
  churned: 'danger',
  archived: 'neutral',
};

const PAGE_SIZE = 20;

export function ContactsView() {
  const { can } = useSession();
  const canSeeAll = can(PERMISSIONS.CONTACT_READ_ALL);
  const canSeeTeam = can(PERMISSIONS.CONTACT_READ_TEAM);

  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [status, setStatus] = useState('');
  const [source, setSource] = useState('');
  const [page, setPage] = useState(1);

  const [editing, setEditing] = useState<ContactDto | null>(null);
  const [creating, setCreating] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<ContactDto | null>(null);

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
      status: status || undefined,
      source: source || undefined,
    }),
    [page, debouncedSearch, status, source],
  );

  const { data, isPending, isError, error } = useContacts(params);
  const remove = useDeleteContact();

  // Only fetched when the user may reassign — otherwise the API would 403.
  const { data: team } = useQuery({
    queryKey: queryKeys.users,
    queryFn: api.users.list,
    enabled: (canSeeAll || canSeeTeam) && can(PERMISSIONS.USER_READ),
  });

  const contacts = data?.items ?? [];

  // Team leads may only reassign within their team — the API enforces this too,
  // so filter the dropdown to their team so the UI matches the server.
  const { user } = useSession().session;
  const reassignableMembers = useMemo(() => {
    if (canSeeAll) return team ?? [];
    if (canSeeTeam) return (team ?? []).filter((member) => member.teamId === user.teamId);
    return [];
  }, [canSeeAll, canSeeTeam, team, user.teamId]);

  const scopeDescription = canSeeAll
    ? "Everyone in your organization's pipeline."
    : canSeeTeam
      ? "Your team's pipeline — contacts owned by you and your team."
      : 'The contacts assigned to you.';

  const columns = useMemo<ColumnDef<ContactDto, any>[]>(
    () => [
      {
        accessorKey: 'fullName',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Name" />,
        cell: ({ row }) => (
          <div>
            <Link
              href={`/contacts/${row.original.id}`}
              className="font-medium text-ink hover:text-brand transition-colors"
            >
              {row.original.fullName}
            </Link>
            {row.original.email && (
              <p className="text-xs text-ink-subtle">{row.original.email}</p>
            )}
          </div>
        ),
      },
      {
        accessorKey: 'company',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Company" />,
        cell: ({ row }) => (
          <div className="text-ink-muted">
            {row.original.company ?? '—'}
            {row.original.jobTitle && (
              <p className="text-xs text-ink-subtle">{row.original.jobTitle}</p>
            )}
          </div>
        ),
      },
      {
        accessorKey: 'status',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
        cell: ({ row }) => (
          <Badge tone={STATUS_TONES[row.original.status]}>
            {CONTACT_STATUS_LABELS[row.original.status]}
          </Badge>
        ),
      },
      {
        accessorKey: 'source',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Source" />,
        cell: ({ row }) => (
          <span className="text-ink-muted">{CONTACT_SOURCE_LABELS[row.original.source]}</span>
        ),
      },
      ...(canSeeAll || canSeeTeam
        ? [
            {
              id: 'owner',
              header: ({ column }: any) => <DataTableColumnHeader column={column} title="Owner" />,
              cell: ({ row }: any) => (
                <span className="text-ink-muted">
                  {row.original.owner?.fullName ?? 'Unassigned'}
                </span>
              ),
            } as ColumnDef<ContactDto, any>,
          ]
        : []),
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
            <Can permission={PERMISSIONS.CONTACT_UPDATE}>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Edit ${row.original.fullName}`}
                onClick={() => setEditing(row.original)}
              >
                <Pencil className="size-4" />
              </Button>
            </Can>
            <Can permission={PERMISSIONS.CONTACT_DELETE}>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Delete ${row.original.fullName}`}
                onClick={() => setPendingDelete(row.original)}
              >
                <Trash2 className="size-4 text-danger" />
              </Button>
            </Can>
          </div>
        ),
      },
    ],
    [canSeeAll, canSeeTeam]
  );

  return (
    <>
      <PageHeader
        title="Contacts"
        description={scopeDescription}
        actions={
          <Can permission={PERMISSIONS.CONTACT_CREATE}>
            <Button onClick={() => setCreating(true)}>
              <Plus className="size-4" />
              New contact
            </Button>
          </Can>
        }
      />

      {isError ? (
        <EmptyState
          title="Couldn't load contacts"
          description={error instanceof Error ? error.message : 'Please try again.'}
        />
      ) : (
        <DataTable
          columns={columns}
          data={contacts}
          isLoading={isPending}
          getRowId={(row) => row.id}
          cardTitleKey="fullName"
          cardSubtitleKey="company"
          enableRowSelection
          searchPlaceholder="Search name, email or company…"
          toolbarActions={
            <div className="flex items-center gap-2">
              <Select
                aria-label="Filter by status"
                placeholder="All statuses"
                containerClassName="w-36"
                value={status}
                onChange={(event) => {
                  setStatus(event.target.value);
                  setPage(1);
                }}
                options={CONTACT_STATUSES.map((s) => ({ value: s, label: CONTACT_STATUS_LABELS[s] }))}
              />
              <Select
                aria-label="Filter by source"
                placeholder="All sources"
                containerClassName="w-36"
                value={source}
                onChange={(event) => {
                  setSource(event.target.value);
                  setPage(1);
                }}
                options={CONTACT_SOURCES.map((s) => ({ value: s, label: CONTACT_SOURCE_LABELS[s] }))}
              />
            </div>
          }
          emptyTitle={debouncedSearch || status || source ? 'No matching contacts' : 'No contacts yet'}
          emptyDescription={
            debouncedSearch || status || source
              ? 'Try a different search or clear the filters.'
              : 'Add your first contact to start building the pipeline.'
          }
          emptyIcon={<Users className="size-8 text-ink-muted" />}
        />
      )}

      <ContactFormDialog
        open={creating || editing !== null}
        contact={editing}
        teamMembers={reassignableMembers}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
      />

      <Dialog
        open={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        size="sm"
        title="Delete contact"
        description={`${pendingDelete?.fullName} will be removed from your pipeline. This can be undone by an administrator.`}
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
