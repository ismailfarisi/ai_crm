'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Crown, Plus, Trash2, UserRoundCog } from 'lucide-react';
import { PERMISSIONS, type TeamDto } from '@saas/shared';
import { api, queryKeys } from '@/lib/api/endpoints';
import { ApiError } from '@/lib/api/client';
import { useSession } from '@/lib/session-context';
import { initials } from '@/lib/utils';
import { Can } from '@/components/auth/can';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/field';
import { Badge, Card, CardBody, CardHeader, CardTitle, EmptyState, PageHeader, Skeleton } from '@/components/ui/primitives';

/**
 * Teams are the grouping a manager ("team leader") is scoped to. A team lead
 * sees the contacts owned by everyone in their team. Owners/admins manage
 * teams here; a manager sees the list read-only.
 */
export function TeamsView() {
  const queryClient = useQueryClient();
  const { can, session } = useSession();
  const canManage = can(PERMISSIONS.USER_UPDATE);

  const [creating, setCreating] = useState(false);
  const [newTeamName, setNewTeamName] = useState('');
  const [renameTarget, setRenameTarget] = useState<TeamDto | null>(null);
  const [renameName, setRenameName] = useState('');
  const [pendingDelete, setPendingDelete] = useState<TeamDto | null>(null);

  const { data: teams, isPending } = useQuery({
    queryKey: queryKeys.teams,
    queryFn: api.teams.list,
  });

  const { data: members } = useQuery({
    queryKey: queryKeys.users,
    queryFn: api.users.list,
    enabled: canManage,
  });

  const create = useMutation({
    mutationFn: (name: string) => api.teams.create({ name }),
    onSuccess: async (team) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.teams });
      setCreating(false);
      setNewTeamName('');
      toast.success(`Created “${team.name}”`);
    },
    onError: (error) =>
      toast.error(error instanceof ApiError ? error.message : 'Could not create the team'),
  });

  const rename = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => api.teams.update(id, { name }),
    onSuccess: async (team) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.teams });
      setRenameTarget(null);
      toast.success(`Renamed to “${team.name}”`);
    },
    onError: (error) =>
      toast.error(error instanceof ApiError ? error.message : 'Could not rename the team'),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.teams.remove(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.teams });
      await queryClient.invalidateQueries({ queryKey: queryKeys.users });
      setPendingDelete(null);
      toast.success('Team deleted — members kept their accounts');
    },
    onError: (error) =>
      toast.error(error instanceof ApiError ? error.message : 'Could not delete the team'),
  });

  const assignLead = useMutation({
    mutationFn: ({ id, leadId }: { id: string; leadId: string | null }) =>
      api.teams.update(id, { leadId }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.teams });
      await queryClient.invalidateQueries({ queryKey: queryKeys.users });
      toast.success('Team lead updated');
    },
    onError: (error) =>
      toast.error(error instanceof ApiError ? error.message : 'Could not update the team lead'),
  });

  return (
    <>
      <PageHeader
        title="Teams"
        description="Group members so team leaders can see their team's pipeline. Managers see their own team's contacts, not the whole organization."
        actions={
          <Can permission={PERMISSIONS.USER_UPDATE}>
            <Button onClick={() => setCreating(true)}>
              <Plus className="size-4" />
              New team
            </Button>
          </Can>
        }
      />

      {isPending ? (
        <Skeleton className="h-64 w-full" />
      ) : !teams?.length ? (
        <EmptyState
          icon={<UserRoundCog className="size-8" />}
          title="No teams yet"
          description="Create a team to give a manager a scoped view of their members' contacts."
          action={
            <Can permission={PERMISSIONS.USER_UPDATE}>
              <Button onClick={() => setCreating(true)}>
                <Plus className="size-4" />
                New team
              </Button>
            </Can>
          }
        />
      ) : (
        <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
          {teams.map((team) => {
            const teamMembers = (members ?? []).filter((m) => m.teamId === team.id);
            const isMyTeam = team.lead?.id === session.user.id;
            return (
              <Card key={team.id}>
                <CardHeader className="flex items-start justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <CardTitle className="truncate">{team.name}</CardTitle>
                    {isMyTeam && <Badge tone="brand">You lead this</Badge>}
                  </div>
                  {canManage && (
                    <div className="flex shrink-0 gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`Rename ${team.name}`}
                        onClick={() => {
                          setRenameTarget(team);
                          setRenameName(team.name);
                        }}
                      >
                        Rename
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Delete ${team.name}`}
                        onClick={() => setPendingDelete(team)}
                      >
                        <Trash2 className="size-4 text-danger" />
                      </Button>
                    </div>
                  )}
                </CardHeader>

                <CardBody className="space-y-3">
                  <div className="flex items-center gap-2 text-sm">
                    <Crown className="size-4 text-brand" />
                    {team.lead ? (
                      <span className="font-medium text-ink">
                        {team.lead.fullName}
                        <span className="ml-2 text-xs font-normal text-ink-subtle">
                          Team lead
                        </span>
                      </span>
                    ) : (
                      <span className="text-ink-subtle">No team lead</span>
                    )}
                  </div>

                  <p className="text-xs text-ink-subtle">
                    {team.memberCount} member{team.memberCount === 1 ? '' : 's'}
                  </p>

                  {canManage && members && (
                    <select
                      aria-label={`Team lead for ${team.name}`}
                      className="h-9 w-full rounded-lg border border-border bg-surface px-2 text-sm"
                      value={team.lead?.id ?? ''}
                      onChange={(event) =>
                        assignLead.mutate({ id: team.id, leadId: event.target.value || null })
                      }
                    >
                      <option value="">No team lead</option>
                      {teamMembers.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.fullName}
                        </option>
                      ))}
                    </select>
                  )}

                  {teamMembers.length > 0 && (
                    <ul className="space-y-1.5">
                      {teamMembers.slice(0, 5).map((m) => (
                        <li key={m.id} className="flex items-center gap-2 text-sm text-ink-muted">
                          <span className="grid size-6 shrink-0 place-items-center rounded-full bg-surface-muted text-[10px] font-semibold text-ink-subtle">
                            {initials(m.firstName, m.lastName)}
                          </span>
                          <span className="min-w-0 truncate">{m.fullName}</span>
                          {m.id === team.lead?.id && <Badge>Lead</Badge>}
                        </li>
                      ))}
                      {teamMembers.length > 5 && (
                        <li className="text-xs text-ink-subtle">
                          +{teamMembers.length - 5} more
                        </li>
                      )}
                    </ul>
                  )}
                </CardBody>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog
        open={creating}
        onClose={() => setCreating(false)}
        size="sm"
        title="New team"
        description="A team leader (manager) sees the contacts owned by their team's members."
        footer={
          <>
            <Button variant="secondary" onClick={() => setCreating(false)}>
              Cancel
            </Button>
            <Button
              loading={create.isPending}
              disabled={newTeamName.trim().length < 2}
              onClick={() => create.mutate(newTeamName.trim())}
            >
              Create team
            </Button>
          </>
        }
      >
        <Input
          label="Team name"
          placeholder="East sales"
          value={newTeamName}
          onChange={(event) => setNewTeamName(event.target.value)}
        />
      </Dialog>

      <Dialog
        open={renameTarget !== null}
        onClose={() => setRenameTarget(null)}
        size="sm"
        title="Rename team"
        footer={
          <>
            <Button variant="secondary" onClick={() => setRenameTarget(null)}>
              Cancel
            </Button>
            <Button
              loading={rename.isPending}
              disabled={renameName.trim().length < 2}
              onClick={() => renameTarget && rename.mutate({ id: renameTarget.id, name: renameName.trim() })}
            >
              Rename
            </Button>
          </>
        }
      >
        <Input
          label="Team name"
          value={renameName}
          onChange={(event) => setRenameName(event.target.value)}
        />
      </Dialog>

      <Dialog
        open={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        size="sm"
        title="Delete team"
        description={`${pendingDelete?.name ?? ''} will be removed. Members keep their accounts and are unassigned.`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setPendingDelete(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={remove.isPending}
              onClick={() => pendingDelete && remove.mutate(pendingDelete.id)}
            >
              Delete team
            </Button>
          </>
        }
      >
        <p className="text-sm text-ink-muted">
          Any contacts stay with their owners — only the grouping is removed.
        </p>
      </Dialog>
    </>
  );
}
