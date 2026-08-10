'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Pencil, Plus, Search, Trash2, Users } from 'lucide-react';
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
import { Input, Select } from '@/components/ui/field';
import { Badge, Card, EmptyState, PageHeader, Skeleton } from '@/components/ui/primitives';
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
  const meta = data?.meta;

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

      <Card>
        <div className="flex flex-wrap items-end gap-3 border-b border-border px-4 py-3">
          <div className="relative min-w-56 flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-subtle" />
            <Input
              aria-label="Search contacts"
              placeholder="Search name, email or company…"
              className="pl-9"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>

          <Select
            aria-label="Filter by status"
            placeholder="All statuses"
            containerClassName="w-40"
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
            containerClassName="w-40"
            value={source}
            onChange={(event) => {
              setSource(event.target.value);
              setPage(1);
            }}
            options={CONTACT_SOURCES.map((s) => ({ value: s, label: CONTACT_SOURCE_LABELS[s] }))}
          />
        </div>

        {isPending ? (
          <div className="space-y-3 p-4">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : isError ? (
          <EmptyState
            title="Couldn't load contacts"
            description={error instanceof Error ? error.message : 'Please try again.'}
          />
        ) : contacts.length === 0 ? (
          <EmptyState
            icon={<Users className="size-8" />}
            title={debouncedSearch || status || source ? 'No matching contacts' : 'No contacts yet'}
            description={
              debouncedSearch || status || source
                ? 'Try a different search or clear the filters.'
                : 'Add your first contact to start building the pipeline.'
            }
            action={
              <Can permission={PERMISSIONS.CONTACT_CREATE}>
                <Button onClick={() => setCreating(true)}>
                  <Plus className="size-4" />
                  New contact
                </Button>
              </Can>
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-ink-subtle">
                  <th scope="col" className="px-4 py-2.5 font-medium">Name</th>
                  <th scope="col" className="px-4 py-2.5 font-medium">Company</th>
                  <th scope="col" className="px-4 py-2.5 font-medium">Status</th>
                  <th scope="col" className="hidden px-4 py-2.5 font-medium md:table-cell">Source</th>
                  {canSeeAll && (
                    <th scope="col" className="hidden px-4 py-2.5 font-medium lg:table-cell">Owner</th>
                  )}
                  {canSeeTeam && !canSeeAll && (
                    <th scope="col" className="hidden px-4 py-2.5 font-medium lg:table-cell">Owner</th>
                  )}
                  <th scope="col" className="hidden px-4 py-2.5 font-medium sm:table-cell">Added</th>
                  <th scope="col" className="px-4 py-2.5 text-right font-medium">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {contacts.map((contact) => (
                  <tr
                    key={contact.id}
                    className="border-b border-border last:border-0 hover:bg-surface-muted/60"
                  >
                    <td className="px-4 py-3">
                      <Link
                        href={`/contacts/${contact.id}`}
                        className="font-medium text-ink hover:text-brand transition-colors"
                      >
                        {contact.fullName}
                      </Link>
                      {contact.email && (
                        <p className="text-xs text-ink-subtle">{contact.email}</p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-ink-muted">
                      {contact.company ?? '—'}
                      {contact.jobTitle && (
                        <p className="text-xs text-ink-subtle">{contact.jobTitle}</p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={STATUS_TONES[contact.status]}>
                        {CONTACT_STATUS_LABELS[contact.status]}
                      </Badge>
                    </td>
                    <td className="hidden px-4 py-3 text-ink-muted md:table-cell">
                      {CONTACT_SOURCE_LABELS[contact.source]}
                    </td>
                    {canSeeAll && (
                      <td className="hidden px-4 py-3 text-ink-muted lg:table-cell">
                        {contact.owner?.fullName ?? 'Unassigned'}
                      </td>
                    )}
                    {canSeeTeam && !canSeeAll && (
                      <td className="hidden px-4 py-3 text-ink-muted lg:table-cell">
                        {contact.owner?.fullName ?? 'Unassigned'}
                      </td>
                    )}
                    <td className="hidden px-4 py-3 text-ink-subtle sm:table-cell">
                      {formatRelative(contact.createdAt)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1">
                        <Can permission={PERMISSIONS.CONTACT_UPDATE}>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Edit ${contact.fullName}`}
                            onClick={() => setEditing(contact)}
                          >
                            <Pencil className="size-4" />
                          </Button>
                        </Can>
                        <Can permission={PERMISSIONS.CONTACT_DELETE}>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Delete ${contact.fullName}`}
                            onClick={() => setPendingDelete(contact)}
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
