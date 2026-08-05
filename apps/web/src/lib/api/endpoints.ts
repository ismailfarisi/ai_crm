import type {
  AssignRolesInput,
  ChangePasswordInput,
  ContactDto,
  ContactStatsDto,
  CreateContactPayload,
  CreateRoleInput,
  CreateTeamInput,
  InviteUserInput,
  LoginInput,
  PaginatedResult,
  Permission,
  RegisterInput,
  RoleDto,
  SessionDto,
  TeamDto,
  UpdateContactPayload,
  UpdateRoleInput,
  UpdateTeamInput,
  UserDto,
} from '@saas/shared';
import { apiFetch } from './client';

export interface ContactListParams {
  page?: number;
  limit?: number;
  search?: string;
  status?: string;
  source?: string;
  ownerId?: string;
  sortBy?: string;
  sortOrder?: 'ASC' | 'DESC';
}

/** Every endpoint the browser talks to, in one typed surface. */
export const api = {
  auth: {
    login: (input: LoginInput) =>
      apiFetch<SessionDto>('/auth/login', { method: 'POST', body: input }),
    register: (input: RegisterInput) =>
      apiFetch<SessionDto>('/auth/register', { method: 'POST', body: input }),
    logout: () => apiFetch<{ success: true }>('/auth/logout', { method: 'POST' }),
    me: () => apiFetch<SessionDto>('/auth/me'),
    changePassword: (input: ChangePasswordInput) =>
      apiFetch<{ success: true }>('/auth/change-password', { method: 'POST', body: input }),
  },

  contacts: {
    list: (params: ContactListParams = {}) =>
      apiFetch<PaginatedResult<ContactDto>>('/contacts', { query: params }),
    stats: () => apiFetch<ContactStatsDto>('/contacts/stats'),
    get: (id: string) => apiFetch<ContactDto>(`/contacts/${id}`),
    create: (input: CreateContactPayload) =>
      apiFetch<ContactDto>('/contacts', { method: 'POST', body: input }),
    update: (id: string, input: UpdateContactPayload) =>
      apiFetch<ContactDto>(`/contacts/${id}`, { method: 'PATCH', body: input }),
    remove: (id: string) => apiFetch<void>(`/contacts/${id}`, { method: 'DELETE' }),
  },

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
    invite: (input: InviteUserInput) => apiFetch<UserDto>('/users', { method: 'POST', body: input }),
    assignRoles: (id: string, input: AssignRolesInput) =>
      apiFetch<UserDto>(`/users/${id}/roles`, { method: 'PATCH', body: input }),
    assignTeam: (id: string, teamId: string | null) =>
      apiFetch<UserDto>(`/users/${id}/team`, { method: 'PATCH', body: { teamId } }),
    setActive: (id: string, isActive: boolean) =>
      apiFetch<UserDto>(`/users/${id}/status`, { method: 'PATCH', body: { isActive } }),
    updateOwnProfile: (input: { firstName?: string; lastName?: string }) =>
      apiFetch<UserDto>('/users/me', { method: 'PATCH', body: input }),
  },

  teams: {
    list: () => apiFetch<TeamDto[]>('/teams'),
    create: (input: CreateTeamInput) => apiFetch<TeamDto>('/teams', { method: 'POST', body: input }),
    update: (id: string, input: UpdateTeamInput) =>
      apiFetch<TeamDto>(`/teams/${id}`, { method: 'PATCH', body: input }),
    remove: (id: string) => apiFetch<void>(`/teams/${id}`, { method: 'DELETE' }),
  },
};

export const queryKeys = {
  session: ['session'] as const,
  contacts: (params: ContactListParams = {}) => ['contacts', params] as const,
  contact: (id: string) => ['contacts', id] as const,
  contactStats: ['contacts', 'stats'] as const,
  roles: ['roles'] as const,
  role: (id: string) => ['roles', id] as const,
  permissionCatalog: ['permissions'] as const,
  users: ['users'] as const,
  teams: ['teams'] as const,
};
