'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { Check, Copy, MailPlus, UserPlus } from 'lucide-react';
import {
  PERMISSIONS,
  PERMISSION_DESCRIPTIONS,
  inviteUserSchema,
  type InvitationDto,
  type InviteUserInput,
  type Permission,
  type RoleDto,
  type TeamDto,
  type UserDto,
} from '@saas/shared';
import { api, queryKeys } from '@/lib/api/endpoints';
import { ApiError } from '@/lib/api/client';
import { useSession } from '@/lib/session-context';
import { formatRelative, initials } from '@/lib/utils';
import { Can } from '@/components/auth/can';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/field';
import { Badge, Card, EmptyState, PageHeader, Skeleton } from '@/components/ui/primitives';

/** A change to someone's access, held until it is confirmed. */
export type AccessChange =
  | { kind: 'role'; member: UserDto; roleId: string }
  | { kind: 'team'; member: UserDto; teamId: string | null }
  | { kind: 'active'; member: UserDto; isActive: boolean };

export function TeamView() {
  const queryClient = useQueryClient();
  const { session, can } = useSession();
  const [inviting, setInviting] = useState(false);
  // Picking a role or team, or pressing Deactivate, only asks; nothing is
  // saved until the dialog is confirmed. `change` outlives `confirming` so the
  // dialog keeps its words while it closes.
  const [change, setChange] = useState<AccessChange | null>(null);
  const [confirming, setConfirming] = useState(false);
  const ask = (next: AccessChange) => {
    setChange(next);
    setConfirming(true);
  };
  const [inviteLinks, setInviteLinks] = useState<Record<string, string>>({});

  const { data: members, isPending } = useQuery({
    queryKey: queryKeys.users,
    queryFn: api.users.list,
  });

  const { data: roles } = useQuery({
    queryKey: queryKeys.roles,
    queryFn: api.roles.list,
    enabled: can(PERMISSIONS.ROLE_READ),
  });

  const { data: teams } = useQuery({
    queryKey: queryKeys.teams,
    queryFn: api.teams.list,
    enabled: can(PERMISSIONS.USER_UPDATE),
  });

  const { data: invitations } = useQuery({
    queryKey: queryKeys.invitations,
    queryFn: api.invitations.list,
    enabled: can(PERMISSIONS.USER_READ),
  });

  const cancelInvite = useMutation({
    mutationFn: (id: string) => api.invitations.cancel(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.invitations });
      toast.success('Invite cancelled');
    },
    onError: (error) =>
      toast.error(error instanceof ApiError ? error.message : 'Could not cancel the invite'),
  });

  /**
   * Re-sends the invite and keeps the link it returns.
   *
   * If the mail never arrives — a misconfigured provider, a spam filter — the
   * owner's only option used to be to cancel, re-invite and hope. The link is
   * held in component state only, and only for the invite just re-sent.
   */
  const resendInvite = useMutation({
    mutationFn: (id: string) => api.invitations.resend(id),
    onSuccess: async (invitation) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.invitations });
      setInviteLinks((links) => ({ ...links, [invitation.id]: invitation.acceptUrl }));
      toast.success(`Invite re-sent to ${invitation.email}`);
    },
    onError: (error) =>
      toast.error(error instanceof ApiError ? error.message : 'Could not re-send the invite'),
  });

  const setActive = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      api.users.setActive(id, isActive),
    onSuccess: async (user) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.users });
      toast.success(`${user.fullName} ${user.isActive ? 'reactivated' : 'deactivated'}`);
    },
  });

  const assignRoles = useMutation({
    mutationFn: ({ id, roleIds }: { id: string; roleIds: string[] }) =>
      api.users.assignRoles(id, { roleIds }),
    onSuccess: async (user) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.users });
      toast.success(`Updated roles for ${user.fullName}`);
    },
  });

  const assignTeam = useMutation({
    mutationFn: ({ id, teamId }: { id: string; teamId: string | null }) =>
      api.users.assignTeam(id, teamId),
    onSuccess: async (user) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.users });
      await queryClient.invalidateQueries({ queryKey: queryKeys.teams });
      toast.success(`Updated team for ${user.fullName}`);
    },
  });

  // Errors reject into the confirmation dialog, which shows them in place.
  const applyChange = async () => {
    if (!change) return;
    if (change.kind === 'role') {
      await assignRoles.mutateAsync({ id: change.member.id, roleIds: [change.roleId] });
    } else if (change.kind === 'team') {
      await assignTeam.mutateAsync({ id: change.member.id, teamId: change.teamId });
    } else {
      await setActive.mutateAsync({ id: change.member.id, isActive: change.isActive });
    }
  };

  return (
    <>
      <PageHeader
        title="Team"
        description="Everyone with access to this workspace, what they can do, and which team they're on."
        actions={
          <Can permission={PERMISSIONS.USER_CREATE}>
            <Button onClick={() => setInviting(true)}>
              <UserPlus className="size-4" />
              Add member
            </Button>
          </Can>
        }
      />

      <Card>
        {isPending ? (
          <div className="space-y-3 p-4">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        ) : !members?.length ? (
          <EmptyState title="No team members" />
        ) : (
          <ul className="divide-y divide-border">
            {members.map((member) => (
              <MemberRow
                key={member.id}
                member={member}
                isSelf={member.id === session.user.id}
                roles={roles ?? []}
                teams={teams ?? []}
                canAssignTeam={can(PERMISSIONS.USER_UPDATE)}
                onToggleActive={(isActive) => ask({ kind: 'active', member, isActive })}
                onAssignRoles={(roleIds) => ask({ kind: 'role', member, roleId: roleIds[0] })}
                onAssignTeam={(teamId) => ask({ kind: 'team', member, teamId })}
              />
            ))}
          </ul>
        )}
      </Card>

      {change && (
        <AccessChangeDialog
          open={confirming}
          change={change}
          roles={roles ?? []}
          teams={teams ?? []}
          onClose={() => setConfirming(false)}
          onConfirm={applyChange}
        />
      )}

      <InviteDialog open={inviting} onClose={() => setInviting(false)} roles={roles ?? []} teams={teams ?? []} />

      {invitations && invitations.length > 0 && (
        <Card className="mt-4">
          <div className="flex items-center gap-2 border-b border-border px-4 py-3">
            <MailPlus className="size-4 text-ink-subtle" />
            <h2 className="text-sm font-semibold text-ink">Pending invitations</h2>
          </div>
          <ul className="divide-y divide-border">
            {invitations.map((invitation) => (
              <PendingInviteRow
                key={invitation.id}
                invitation={invitation}
                inviteLink={inviteLinks[invitation.id]}
                isResending={resendInvite.isPending && resendInvite.variables === invitation.id}
                onResend={() => resendInvite.mutate(invitation.id)}
                onCancel={() => cancelInvite.mutate(invitation.id)}
              />
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}

function PendingInviteRow({
  invitation,
  inviteLink,
  isResending,
  onResend,
  onCancel,
}: {
  invitation: InvitationDto;
  /** Present once this invite has been re-sent in this session. */
  inviteLink?: string;
  isResending: boolean;
  onResend: () => void;
  onCancel: () => void;
}) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    if (!inviteLink) return;
    try {
      await navigator.clipboard.writeText(inviteLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Could not copy the link — select and copy it by hand.');
    }
  };

  return (
    <li className="flex flex-wrap items-center gap-4 px-4 py-3">
      <span className="grid size-9 shrink-0 place-items-center rounded-full bg-brand-soft text-xs font-semibold text-ink">
        {initials(invitation.firstName, invitation.lastName)}
      </span>

      <div className="min-w-40 flex-1">
        <p className="text-sm font-medium text-ink">
          {invitation.firstName} {invitation.lastName}
        </p>
        <p className="text-xs text-ink-subtle">{invitation.email}</p>
        {inviteLink && (
          <div className="mt-1.5 flex items-center gap-2">
            <code className="truncate rounded bg-surface-muted px-1.5 py-0.5 font-mono text-[11px] text-ink-muted">
              {inviteLink}
            </code>
            <button
              type="button"
              onClick={copy}
              className="inline-flex shrink-0 items-center gap-1 text-[11px] font-semibold text-ink underline-offset-2 hover:underline cursor-pointer"
            >
              {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
              {copied ? 'Copied' : 'Copy link'}
            </button>
          </div>
        )}
      </div>

      <div className="hidden text-xs text-ink-subtle sm:block">
        Expires {formatRelative(invitation.expiresAt)}
      </div>

      <Can permission={PERMISSIONS.USER_CREATE}>
        <Button variant="ghost" size="sm" onClick={onResend} loading={isResending}>
          Resend
        </Button>
      </Can>

      <Can permission={PERMISSIONS.USER_UPDATE}>
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </Can>
    </li>
  );
}

function MemberRow({
  member,
  isSelf,
  roles,
  teams,
  canAssignTeam,
  onToggleActive,
  onAssignRoles,
  onAssignTeam,
}: {
  member: UserDto;
  isSelf: boolean;
  roles: Pick<RoleDto, 'id' | 'name' | 'level'>[];
  teams: TeamDto[];
  canAssignTeam: boolean;
  onToggleActive: (isActive: boolean) => void;
  onAssignRoles: (roleIds: string[]) => void;
  onAssignTeam: (teamId: string | null) => void;
}) {
  const currentRoleId = member.roles[0]?.id ?? '';

  return (
    <li className="flex flex-wrap items-center gap-4 px-4 py-3">
      <span className="grid size-9 shrink-0 place-items-center rounded-full bg-brand-soft text-xs font-semibold text-ink">
        {initials(member.firstName, member.lastName)}
      </span>

      <div className="min-w-40 flex-1">
        <p className="flex items-center gap-2 text-sm font-medium text-ink">
          {member.fullName}
          {isSelf && <Badge>You</Badge>}
          {!member.isActive && <Badge tone="danger">Deactivated</Badge>}
        </p>
        <p className="text-xs text-ink-subtle">{member.email}</p>
      </div>

      <div className="hidden text-xs text-ink-subtle sm:block">
        Last seen {formatRelative(member.lastLoginAt)}
      </div>

      <Can
        permission={PERMISSIONS.USER_ASSIGN_ROLE}
        fallback={
          <div className="flex gap-1.5">
            {member.roles.map((role) => (
              <Badge key={role.id} tone="brand">
                {role.name}
              </Badge>
            ))}
          </div>
        }
      >
        <select
          aria-label={`Role for ${member.fullName}`}
          className="h-10 rounded-xl border border-border-control bg-surface px-2 text-sm text-ink disabled:opacity-60"
          value={currentRoleId}
          disabled={isSelf}
          onChange={(event) => {
            if (event.target.value && event.target.value !== currentRoleId) onAssignRoles([event.target.value]);
          }}
        >
          {roles.map((role) => (
            <option key={role.id} value={role.id}>
              {role.name}
            </option>
          ))}
        </select>
      </Can>

      {canAssignTeam ? (
        <select
          aria-label={`Team for ${member.fullName}`}
          className="h-10 rounded-xl border border-border-control bg-surface px-2 text-sm text-ink disabled:opacity-60"
          value={member.teamId ?? ''}
          disabled={isSelf}
          onChange={(event) => {
            const teamId = event.target.value || null;
            if (teamId !== member.teamId) onAssignTeam(teamId);
          }}
        >
          <option value="">No team</option>
          {teams.map((team) => (
            <option key={team.id} value={team.id}>
              {team.name}
            </option>
          ))}
        </select>
      ) : member.teamId ? (
        <Badge tone="neutral">{teams.find((team) => team.id === member.teamId)?.name ?? 'Team'}</Badge>
      ) : null}

      <Can permission={PERMISSIONS.USER_UPDATE}>
        <Button
          variant="ghost"
          size="sm"
          disabled={isSelf}
          onClick={() => onToggleActive(!member.isActive)}
        >
          {member.isActive ? 'Deactivate' : 'Reactivate'}
        </Button>
      </Can>
    </li>
  );
}

/** What a role change adds and takes away, from the roles' own permission lists. */
export function permissionChange(
  member: Pick<UserDto, 'roles'>,
  roleId: string,
  roles: Pick<RoleDto, 'id' | 'permissions'>[],
): { gained: Permission[]; lost: Permission[] } {
  const byId = new Map(roles.map((role) => [role.id, role]));
  const before = new Set(member.roles.flatMap((role) => byId.get(role.id)?.permissions ?? []));
  const after = new Set(byId.get(roleId)?.permissions ?? []);
  return {
    gained: [...after].filter((permission) => !before.has(permission)),
    lost: [...before].filter((permission) => !after.has(permission)),
  };
}

const SHOWN_PERMISSIONS = 6;

function PermissionList({ title, permissions }: { title: string; permissions: Permission[] }) {
  if (!permissions.length) return null;
  const shown = permissions.slice(0, SHOWN_PERMISSIONS);
  const more = permissions.length - shown.length;
  return (
    <div>
      <p className="text-xs font-semibold text-ink">
        {title} ({permissions.length})
      </p>
      <ul className="mt-1 list-disc space-y-0.5 ps-5 text-sm text-ink-muted">
        {shown.map((permission) => (
          <li key={permission}>{PERMISSION_DESCRIPTIONS[permission] ?? permission}</li>
        ))}
        {more > 0 && <li className="list-none text-ink-subtle">and {more} more</li>}
      </ul>
    </div>
  );
}

function AccessChangeDialog({
  open,
  change,
  roles,
  teams,
  onClose,
  onConfirm,
}: {
  open: boolean;
  change: AccessChange;
  roles: RoleDto[];
  teams: TeamDto[];
  onClose: () => void;
  onConfirm: () => Promise<void>;
}) {
  const { member } = change;
  const name = member.fullName;

  if (change.kind === 'role') {
    const from = member.roles.map((role) => role.name).join(', ') || 'no role';
    const to = roles.find((role) => role.id === change.roleId)?.name ?? 'the new role';
    const { gained, lost } = permissionChange(member, change.roleId, roles);
    return (
      <ConfirmDialog
        open={open}
        onClose={onClose}
        onConfirm={onConfirm}
        title={`Make ${name} ${to}?`}
        description={`They move from ${from} to ${to}. It applies from their next click.`}
        confirmLabel="Change role"
        tone={lost.length ? 'danger' : 'primary'}
      >
        <div className="space-y-3">
          <PermissionList title="They gain" permissions={gained} />
          <PermissionList title="They lose" permissions={lost} />
          {!gained.length && !lost.length && (
            <p className="text-sm text-ink-muted">What they can do stays the same.</p>
          )}
        </div>
      </ConfirmDialog>
    );
  }

  if (change.kind === 'team') {
    const teamName = (id: string | null) =>
      id ? (teams.find((team) => team.id === id)?.name ?? 'their team') : null;
    const from = teamName(member.teamId);
    const to = teamName(change.teamId);
    return (
      <ConfirmDialog
        open={open}
        onClose={onClose}
        onConfirm={onConfirm}
        title={to ? `Move ${name} to ${to}?` : `Take ${name} off ${from ?? 'their team'}?`}
        description={[
          from ? `They leave ${from}.` : null,
          to
            ? `People who see contacts by team will find theirs under ${to}, and they see ${to}'s if their role allows it.`
            : "They stop seeing their old team's contacts, and that team stops seeing theirs.",
        ]
          .filter(Boolean)
          .join(' ')}
        confirmLabel={to ? 'Move to team' : 'Remove from team'}
      />
    );
  }

  return change.isActive ? (
    <ConfirmDialog
      open={open}
      onClose={onClose}
      onConfirm={onConfirm}
      title={`Reactivate ${name}?`}
      description="They can sign in again, with the role they had before."
      confirmLabel="Reactivate"
    />
  ) : (
    <ConfirmDialog
      open={open}
      onClose={onClose}
      onConfirm={onConfirm}
      title={`Deactivate ${name}?`}
      description="They are signed out straight away and can no longer sign in. Their customers, quotes and history stay, and you can reactivate them later."
      confirmLabel="Deactivate"
      tone="danger"
    />
  );
}

function InviteDialog({
  open,
  onClose,
  roles,
  teams,
}: {
  open: boolean;
  onClose: () => void;
  roles: { id: string; name: string }[];
  teams: TeamDto[];
}) {
  const queryClient = useQueryClient();

  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<InviteUserInput>({
    resolver: zodResolver(inviteUserSchema),
    defaultValues: { email: '', firstName: '', lastName: '', roleIds: [], teamId: null },
  });

  const onSubmit = handleSubmit(async (values) => {
    try {
      await api.invitations.invite(values);
      await queryClient.invalidateQueries({ queryKey: queryKeys.invitations });
      toast.success(`Invite sent to ${values.email}`);
      reset();
      onClose();
    } catch (error) {
      if (error instanceof ApiError) {
        for (const [field, message] of Object.entries(error.fieldErrors)) {
          setError(field as keyof InviteUserInput, { message });
        }
        toast.error(error.message);
      }
    }
  });

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Add a team member"
      description="We'll email them a link to set their own password and sign in."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} type="button">
            Cancel
          </Button>
          <Button type="submit" form="invite-form" loading={isSubmitting}>
            Send invite
          </Button>
        </>
      }
    >
      <form id="invite-form" onSubmit={onSubmit} className="space-y-4" noValidate>
        <div className="grid grid-cols-2 gap-3">
          <Input label="First name" required error={errors.firstName?.message} {...register('firstName')} />
          <Input label="Last name" required error={errors.lastName?.message} {...register('lastName')} />
        </div>

        <Input label="Email" type="email" required error={errors.email?.message} {...register('email')} />

        <div className="space-y-1.5">
          <span className="block text-sm font-medium text-ink">Role</span>
          <select
            multiple={false}
            className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm"
            {...register('roleIds.0')}
          >
            <option value="">Select a role…</option>
            {roles.map((role) => (
              <option key={role.id} value={role.id}>
                {role.name}
              </option>
            ))}
          </select>
          {errors.roleIds && <p className="text-xs text-danger">Pick a role</p>}
        </div>

        {teams.length > 0 && (
          <div className="space-y-1.5">
            <span className="block text-sm font-medium text-ink">Team</span>
            <select
              multiple={false}
              className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm"
              {...register('teamId')}
            >
              <option value="">No team</option>
              {teams.map((team) => (
                <option key={team.id} value={team.id}>
                  {team.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </form>
    </Dialog>
  );
}
