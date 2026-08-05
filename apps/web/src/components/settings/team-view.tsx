'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { UserPlus } from 'lucide-react';
import {
  PERMISSIONS,
  inviteUserSchema,
  type InviteUserInput,
  type TeamDto,
  type UserDto,
} from '@saas/shared';
import { api, queryKeys } from '@/lib/api/endpoints';
import { ApiError } from '@/lib/api/client';
import { useSession } from '@/lib/session-context';
import { formatRelative, initials } from '@/lib/utils';
import { Can } from '@/components/auth/can';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/field';
import { Badge, Card, EmptyState, PageHeader, Skeleton } from '@/components/ui/primitives';

export function TeamView() {
  const queryClient = useQueryClient();
  const { session, can } = useSession();
  const [inviting, setInviting] = useState(false);

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

  const setActive = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      api.users.setActive(id, isActive),
    onSuccess: async (user) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.users });
      toast.success(`${user.fullName} ${user.isActive ? 'reactivated' : 'deactivated'}`);
    },
    onError: (error) =>
      toast.error(error instanceof ApiError ? error.message : 'Could not update the member'),
  });

  const assignRoles = useMutation({
    mutationFn: ({ id, roleIds }: { id: string; roleIds: string[] }) =>
      api.users.assignRoles(id, { roleIds }),
    onSuccess: async (user) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.users });
      toast.success(`Updated roles for ${user.fullName}`);
    },
    onError: (error) =>
      toast.error(error instanceof ApiError ? error.message : 'Could not change roles'),
  });

  const assignTeam = useMutation({
    mutationFn: ({ id, teamId }: { id: string; teamId: string | null }) =>
      api.users.assignTeam(id, teamId),
    onSuccess: async (user) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.users });
      await queryClient.invalidateQueries({ queryKey: queryKeys.teams });
      toast.success(`Updated team for ${user.fullName}`);
    },
    onError: (error) =>
      toast.error(error instanceof ApiError ? error.message : 'Could not change team'),
  });

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
                onToggleActive={(isActive) => setActive.mutate({ id: member.id, isActive })}
                onAssignRoles={(roleIds) => assignRoles.mutate({ id: member.id, roleIds })}
                onAssignTeam={(teamId) => assignTeam.mutate({ id: member.id, teamId })}
              />
            ))}
          </ul>
        )}
      </Card>

      <InviteDialog open={inviting} onClose={() => setInviting(false)} roles={roles ?? []} teams={teams ?? []} />
    </>
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
  roles: { id: string; name: string; level: number }[];
  teams: TeamDto[];
  canAssignTeam: boolean;
  onToggleActive: (isActive: boolean) => void;
  onAssignRoles: (roleIds: string[]) => void;
  onAssignTeam: (teamId: string | null) => void;
}) {
  const currentRoleId = member.roles[0]?.id ?? '';

  return (
    <li className="flex flex-wrap items-center gap-4 px-4 py-3">
      <span className="grid size-9 shrink-0 place-items-center rounded-full bg-brand-soft text-xs font-semibold text-brand">
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
          className="h-9 rounded-lg border border-border bg-surface px-2 text-sm disabled:opacity-60"
          value={currentRoleId}
          disabled={isSelf}
          onChange={(event) => onAssignRoles([event.target.value])}
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
          className="h-9 rounded-lg border border-border bg-surface px-2 text-sm disabled:opacity-60"
          value={member.teamId ?? ''}
          disabled={isSelf}
          onChange={(event) => onAssignTeam(event.target.value || null)}
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
    defaultValues: { email: '', firstName: '', lastName: '', password: '', roleIds: [], teamId: null },
  });

  const onSubmit = handleSubmit(async (values) => {
    try {
      await api.users.invite(values);
      await queryClient.invalidateQueries({ queryKey: queryKeys.users });
      await queryClient.invalidateQueries({ queryKey: queryKeys.teams });
      toast.success(`${values.firstName} added to the team`);
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
      description="They'll sign in with the password you set here — ask them to change it."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} type="button">
            Cancel
          </Button>
          <Button type="submit" form="invite-form" loading={isSubmitting}>
            Add member
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

        <Input
          label="Temporary password"
          type="text"
          required
          hint="At least 10 characters, with upper case, lower case and a number."
          error={errors.password?.message}
          {...register('password')}
        />

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
