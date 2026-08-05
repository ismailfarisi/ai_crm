'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Check, Lock, Minus, Plus, ShieldCheck, Trash2 } from 'lucide-react';
import {
  PERMISSIONS,
  PERMISSION_DESCRIPTIONS,
  PERMISSION_GROUPS,
  SYSTEM_ROLES,
  type Permission,
} from '@saas/shared';
import { api, queryKeys } from '@/lib/api/endpoints';
import { ApiError } from '@/lib/api/client';
import { useCan, useSession } from '@/lib/session-context';
import { Can } from '@/components/auth/can';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/field';
import { Badge, Card, CardBody, CardHeader, CardTitle, PageHeader, Skeleton } from '@/components/ui/primitives';

export function RolesView() {
  const queryClient = useQueryClient();
  const { session, refresh } = useSession();
  const canEditRoles = useCan({ permission: PERMISSIONS.ROLE_UPDATE });

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Set<Permission>>(new Set());
  const [creating, setCreating] = useState(false);
  const [newRoleName, setNewRoleName] = useState('');

  const { data: roles, isPending } = useQuery({
    queryKey: queryKeys.roles,
    queryFn: api.roles.list,
  });

  const selected = roles?.find((role) => role.id === selectedId) ?? roles?.[0] ?? null;

  // Reset the draft whenever the selected role changes or the server sends new
  // data. Adjusted during render (React re-renders before committing) rather
  // than in an effect, so no stale draft is ever painted.
  const [lastReset, setLastReset] = useState<{ id?: string; permissions?: Permission[] }>({});
  if (
    selected &&
    (selected.id !== lastReset.id || selected.permissions !== lastReset.permissions)
  ) {
    setLastReset({ id: selected.id, permissions: selected.permissions });
    setDraft(new Set(selected.permissions));
  }

  const save = useMutation({
    mutationFn: (input: { id: string; permissions: Permission[] }) =>
      api.roles.update(input.id, { permissions: input.permissions }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.roles });
      // The editor may have just changed their own effective permissions.
      await refresh();
      toast.success('Role updated');
    },
    onError: (error) =>
      toast.error(error instanceof ApiError ? error.message : 'Could not save the role'),
  });

  const create = useMutation({
    mutationFn: (name: string) => api.roles.create({ name, description: '', permissions: [] }),
    onSuccess: async (role) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.roles });
      setSelectedId(role.id);
      setCreating(false);
      setNewRoleName('');
      toast.success(`Created “${role.name}”`);
    },
    onError: (error) =>
      toast.error(error instanceof ApiError ? error.message : 'Could not create the role'),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.roles.remove(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.roles });
      setSelectedId(null);
      toast.success('Role deleted');
    },
    onError: (error) =>
      toast.error(error instanceof ApiError ? error.message : 'Could not delete the role'),
  });

  if (isPending) {
    return (
      <>
        <PageHeader title="Roles & permissions" />
        <Skeleton className="h-96 w-full" />
      </>
    );
  }

  // Three separate reasons this editor can be look-but-don't-touch. All are
  // enforced by the API too; this only keeps the UI honest about them.
  //
  // `canEditRoles` matters most: role:read and role:update are distinct, so a
  // manager reaches this screen legitimately. Without this check they'd get
  // live checkboxes and no Save button — ticking boxes that go nowhere.
  const isOwnerRole = selected?.slug === SYSTEM_ROLES.OWNER;
  const outranksMe = selected ? selected.level <= currentLevel(session.user.roles) : false;
  const readOnly = isOwnerRole || outranksMe || !canEditRoles;

  const dirty =
    selected &&
    (draft.size !== selected.permissions.length ||
      selected.permissions.some((p) => !draft.has(p)));

  return (
    <>
      <PageHeader
        title="Roles & permissions"
        description="Every role belongs to your organization — editing one here affects nobody else's workspace."
        actions={
          <Can permission={PERMISSIONS.ROLE_CREATE}>
            <Button onClick={() => setCreating(true)}>
              <Plus className="size-4" />
              New role
            </Button>
          </Can>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[16rem_1fr]">
        <Card className="h-fit">
          <CardHeader>
            <CardTitle>Roles</CardTitle>
          </CardHeader>
          <ul className="p-2">
            {roles?.map((role) => (
              <li key={role.id}>
                <button
                  onClick={() => setSelectedId(role.id)}
                  aria-current={selected?.id === role.id ? 'true' : undefined}
                  className={`flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                    selected?.id === role.id
                      ? 'bg-brand-soft text-brand'
                      : 'text-ink-muted hover:bg-surface-muted hover:text-ink'
                  }`}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="truncate font-medium">{role.name}</span>
                    {role.isSystem && <Lock className="size-3 shrink-0 opacity-60" />}
                  </span>
                  <span className="shrink-0 text-xs tabular-nums opacity-70">{role.userCount}</span>
                </button>
              </li>
            ))}
          </ul>
        </Card>

        {selected && (
          <Card>
            <CardHeader className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <ShieldCheck className="size-4 text-ink-subtle" />
                  {selected.name}
                  {selected.isSystem && <Badge>System role</Badge>}
                </CardTitle>
                <p className="mt-1 text-sm text-ink-muted">{selected.description}</p>
              </div>

              <div className="flex items-center gap-2">
                {!selected.isSystem && (
                  // Lacking the permission hides the button; a role that is
                  // still assigned shows it disabled with the reason, because
                  // that one is something the user can actually go and fix.
                  <Can permission={PERMISSIONS.ROLE_DELETE}>
                    <Button
                      variant="ghost"
                      size="sm"
                      loading={remove.isPending}
                      disabled={selected.userCount > 0}
                      title={
                        selected.userCount > 0
                          ? `${selected.userCount} team member(s) still hold this role. Reassign them first.`
                          : undefined
                      }
                      onClick={() => remove.mutate(selected.id)}
                    >
                      <Trash2 className="size-4 text-danger" />
                      Delete
                    </Button>
                  </Can>
                )}
                <Can permission={PERMISSIONS.ROLE_UPDATE}>
                  <Button
                    size="sm"
                    disabled={!dirty || readOnly}
                    loading={save.isPending}
                    onClick={() => save.mutate({ id: selected.id, permissions: [...draft] })}
                  >
                    Save changes
                  </Button>
                </Can>
              </div>
            </CardHeader>

            <CardBody className="space-y-6">
              {readOnly && (
                <p className="rounded-lg bg-warning-soft px-3 py-2 text-sm text-warning">
                  {isOwnerRole
                    ? 'The Owner role always holds every permission and cannot be edited.'
                    : outranksMe
                      ? 'This role is at or above your own level, so you can view it but not change it.'
                      : "Your role lets you view roles but not change them. Ask an administrator if you need to edit permissions."}
                </p>
              )}

              {PERMISSION_GROUPS.map((group) => (
                <fieldset key={group.key}>
                  <legend className="mb-2 text-xs font-semibold tracking-wider text-ink-subtle uppercase">
                    {group.label}
                  </legend>
                  <div className="space-y-1">
                    {group.permissions.map((permission) => {
                      const granted = draft.has(permission);

                      const detail = (
                        <span className="min-w-0">
                          <span className="block text-sm text-ink">
                            {PERMISSION_DESCRIPTIONS[permission]}
                          </span>
                          <code className="text-xs text-ink-subtle">{permission}</code>
                        </span>
                      );

                      // A disabled checkbox renders its tick in the UA's grey,
                      // which reads as "unchecked" at a glance — exactly the
                      // wrong impression for the all-powerful Owner role. When
                      // the role can't be edited, state it in words instead.
                      if (readOnly) {
                        return (
                          <div
                            key={permission}
                            className="flex items-start gap-3 rounded-lg px-2 py-2"
                          >
                            {granted ? (
                              <Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
                            ) : (
                              <Minus
                                className="mt-0.5 size-4 shrink-0 text-ink-subtle"
                                aria-hidden
                              />
                            )}
                            {detail}
                            <span className="sr-only">
                              {granted ? 'Granted' : 'Not granted'}
                            </span>
                          </div>
                        );
                      }

                      return (
                        <label
                          key={permission}
                          className="flex cursor-pointer items-start gap-3 rounded-lg px-2 py-2 hover:bg-surface-muted"
                        >
                          <input
                            type="checkbox"
                            className="mt-0.5 size-4 accent-[var(--color-brand)]"
                            checked={granted}
                            onChange={(event) => {
                              setDraft((current) => {
                                const next = new Set(current);
                                if (event.target.checked) next.add(permission);
                                else next.delete(permission);
                                return next;
                              });
                            }}
                          />
                          {detail}
                        </label>
                      );
                    })}
                  </div>
                </fieldset>
              ))}
            </CardBody>
          </Card>
        )}
      </div>

      <Dialog
        open={creating}
        onClose={() => setCreating(false)}
        size="sm"
        title="New role"
        description="Starts with no permissions — add them once it exists."
        footer={
          <>
            <Button variant="secondary" onClick={() => setCreating(false)}>
              Cancel
            </Button>
            <Button
              loading={create.isPending}
              disabled={newRoleName.trim().length < 2}
              onClick={() => create.mutate(newRoleName.trim())}
            >
              Create role
            </Button>
          </>
        }
      >
        <Input
          label="Role name"
          placeholder="Support agent"
          value={newRoleName}
          onChange={(event) => setNewRoleName(event.target.value)}
        />
      </Dialog>
    </>
  );
}

function currentLevel(roles: { level: number }[]): number {
  return roles.length ? Math.min(...roles.map((r) => r.level)) : Number.MAX_SAFE_INTEGER;
}
