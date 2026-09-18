/* One slice of the browser's API surface. Composed in ./index.ts.
 * Split out of a single 477-line module so that two feature branches adding
 * endpoints no longer edit the same two objects. */
import type {
  AssignRolesInput,
  CreateRoleInput,
  CreateTeamInput,
  InvitationDto,
  ResentInvitationDto,
  InviteUserInput,
  Permission,
  RoleDto,
  TeamDto,
  UpdateRoleInput,
  UpdateTeamInput,
  UserDto,
} from '@saas/shared';
import { apiFetch } from '../client';

export const rbacEndpoints = {
  roles: {
    list: () => apiFetch<RoleDto[]>('/roles'),
    get: (id: string) => apiFetch<RoleDto>(`/roles/${id}`),
    create: (input: CreateRoleInput) => apiFetch<RoleDto>('/roles', { method: 'POST', body: input }),
    update: (id: string, input: UpdateRoleInput) =>
      apiFetch<RoleDto>(`/roles/${id}`, { method: 'PATCH', body: input }),
    remove: (id: string) => apiFetch<void>(`/roles/${id}`, { method: 'DELETE' }),
    permissions: () =>
      apiFetch<{
        permissions: { key: Permission; description: string }[];
        groups: { key: string; label: string; permissions: Permission[] }[];
      }>('/permissions'),
  },
  users: {
    list: () => apiFetch<UserDto[]>('/users'),
    assignRoles: (id: string, input: AssignRolesInput) =>
      apiFetch<UserDto>(`/users/${id}/roles`, { method: 'PATCH', body: input }),
    assignTeam: (id: string, teamId: string | null) =>
      apiFetch<UserDto>(`/users/${id}/team`, { method: 'PATCH', body: { teamId } }),
    setActive: (id: string, isActive: boolean) =>
      apiFetch<UserDto>(`/users/${id}/status`, { method: 'PATCH', body: { isActive } }),
    updateOwnProfile: (input: { firstName?: string; lastName?: string }) =>
      apiFetch<UserDto>('/users/me', { method: 'PATCH', body: input }),
  },
  invitations: {
    list: () => apiFetch<InvitationDto[]>('/invitations'),
    invite: (input: InviteUserInput) =>
      apiFetch<InvitationDto>('/invitations', { method: 'POST', body: input }),
    resend: (id: string) =>
      apiFetch<ResentInvitationDto>(`/invitations/${id}/resend`, { method: 'POST' }),
    cancel: (id: string) =>
      apiFetch<{ success: true }>(`/invitations/${id}`, { method: 'DELETE' }),
  },
  teams: {
    list: () => apiFetch<TeamDto[]>('/teams'),
    create: (input: CreateTeamInput) => apiFetch<TeamDto>('/teams', { method: 'POST', body: input }),
    update: (id: string, input: UpdateTeamInput) =>
      apiFetch<TeamDto>(`/teams/${id}`, { method: 'PATCH', body: input }),
    remove: (id: string) => apiFetch<void>(`/teams/${id}`, { method: 'DELETE' }),
  },
};

export const rbacKeys = {
  roles: ['roles'] as const,  role: (id: string) => ['roles', id] as const,  permissionCatalog: ['permissions'] as const,  users: ['users'] as const,  teams: ['teams'] as const,  invitations: ['invitations'] as const,};
