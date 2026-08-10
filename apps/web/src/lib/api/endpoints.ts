import type {
  AcceptInviteInput,
  AssignRolesInput,
  ChangePasswordInput,
  ContactDto,
  ContactStatsDto,
  CreateContactPayload,
  CreateCustomerPayload,
  CreateRoleInput,
  CreateTeamInput,
  CustomerDto,
  InvitationDto,
  InviteUserInput,
  LoginInput,
  PaginatedResult,
  Permission,
  RegisterInput,
  RoleDto,
  SessionDto,
  TeamDto,
  UpdateContactPayload,
  UpdateCustomerPayload,
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

export interface CustomerListParams {
  page?: number;
  limit?: number;
  search?: string;
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
    acceptInvite: (input: AcceptInviteInput) =>
      apiFetch<SessionDto>('/auth/accept-invite', { method: 'POST', body: input }),
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

  customers: {
    list: (params: CustomerListParams = {}) =>
      apiFetch<PaginatedResult<CustomerDto>>('/customers', { query: params }),
    get: (id: string) => apiFetch<CustomerDto>(`/customers/${id}`),
    create: (input: CreateCustomerPayload) =>
      apiFetch<CustomerDto>('/customers', { method: 'POST', body: input }),
    update: (id: string, input: UpdateCustomerPayload) =>
      apiFetch<CustomerDto>(`/customers/${id}`, { method: 'PATCH', body: input }),
    remove: (id: string) => apiFetch<void>(`/customers/${id}`, { method: 'DELETE' }),
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
      apiFetch<InvitationDto>(`/invitations/${id}/resend`, { method: 'POST' }),
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

  quotes: {
    list: () => apiFetch<any[]>('/quotes'),
    get: (id: string) => apiFetch<any>(`/quotes/${id}`),
    create: (payload: { createdBy: 'AI' | 'HUMAN'; title: string; prompt?: string; items?: any[]; totalAmount?: number }) =>
      apiFetch<any>('/quotes', { method: 'POST', body: payload }),
    signal: (id: string, payload: { action: 'APPROVE' | 'REJECT' | 'OVERRIDE'; payload?: any }) =>
      apiFetch<any>(`/quotes/${id}/signal`, { method: 'POST', body: payload }),
  },

  invoices: {
    list: () => apiFetch<any[]>('/invoices'),
  },

  channels: {
    list: () => apiFetch<ChannelConfigDto[]>('/channels/configs'),
    saveConfig: (provider: string, input: SaveChannelConfigInput) =>
      apiFetch<ChannelConfigDto>(`/channels/configs/${provider}`, {
        method: 'POST',
        body: input,
      }),
    testConfig: (provider: string) =>
      apiFetch<TestChannelConfigResult>(`/channels/configs/${provider}/test`, {
        method: 'POST',
      }),
  },
};

export interface ChannelConfigDto {
  id: string | null;
  organizationId: string;
  provider: 'WHATSAPP_META' | 'TELEGRAM' | 'EMAIL_SMTP' | 'EMAIL_RESEND';
  isEnabled: boolean;
  status: 'unconfigured' | 'configured' | 'error';
  credentials: Record<string, any> | null;
  webhookSecret: string | null;
  lastTestedAt: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface SaveChannelConfigInput {
  isEnabled?: boolean;
  credentials?: Record<string, any>;
}

export interface TestChannelConfigResult {
  success: boolean;
  message: string;
  status: 'unconfigured' | 'configured' | 'error';
}

export const queryKeys = {
  session: ['session'] as const,
  contacts: (params: ContactListParams = {}) => ['contacts', params] as const,
  contact: (id: string) => ['contacts', id] as const,
  contactStats: ['contacts', 'stats'] as const,
  customers: (params: CustomerListParams = {}) => ['customers', params] as const,
  customer: (id: string) => ['customers', id] as const,
  roles: ['roles'] as const,
  role: (id: string) => ['roles', id] as const,
  permissionCatalog: ['permissions'] as const,
  users: ['users'] as const,
  teams: ['teams'] as const,
  invitations: ['invitations'] as const,
  quotes: ['quotes'] as const,
  quote: (id: string) => ['quotes', id] as const,
  invoices: ['invoices'] as const,
  channels: ['channels', 'configs'] as const,
};
