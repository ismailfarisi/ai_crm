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
  SendChannelMessagePayload,
  QuoteDto,
  CreateQuotePayload,
  UpdateQuotePayload,
  AutomationWorkflowDto,
  AutomationExecutionDto,
  CreateAutomationWorkflowPayload,
  UpdateAutomationWorkflowPayload,
  SignalAutomationExecutionPayload,
} from '@saas/shared';
import { apiFetch } from './client';

export type InvoiceStatus = 'ISSUED' | 'PAID';

export interface Invoice {
  id: string;
  quoteId: string;
  tenantId: string;
  invoiceNumber: string;
  amount: number;
  status: InvoiceStatus;
  issuedAt: string;
}

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
    list: () => apiFetch<QuoteDto[]>('/quotes'),
    get: (id: string) => apiFetch<QuoteDto>(`/quotes/${id}`),
    getNextNumber: () => apiFetch<{ nextNumber: string }>('/quotes/next-number'),
    create: (payload: CreateQuotePayload) =>
      apiFetch<QuoteDto>('/quotes', { method: 'POST', body: payload }),
    update: (id: string, payload: UpdateQuotePayload) =>
      apiFetch<QuoteDto>(`/quotes/${id}`, { method: 'PATCH', body: payload }),
    signal: (id: string, payload: { action: 'APPROVE' | 'REJECT' | 'OVERRIDE'; payload?: unknown }) =>
      apiFetch<QuoteDto>(`/quotes/${id}/signal`, { method: 'POST', body: payload }),
  },

  invoices: {
    list: () => apiFetch<Invoice[]>('/invoices'),
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
    messages: (params: { contactId?: string; limit?: number } = {}) =>
      apiFetch<ChannelMessageDto[]>('/channels/messages', { query: params }),
    sendMessage: (input: SendChannelMessagePayload) =>
      apiFetch<ChannelMessageDto>('/channels/send', { method: 'POST', body: input }),
  },

  automations: {
    list: () => apiFetch<AutomationWorkflowDto[]>('/automations'),
    get: (id: string) => apiFetch<AutomationWorkflowDto>(`/automations/${id}`),
    create: (payload: CreateAutomationWorkflowPayload) =>
      apiFetch<AutomationWorkflowDto>('/automations', { method: 'POST', body: payload }),
    update: (id: string, payload: UpdateAutomationWorkflowPayload) =>
      apiFetch<AutomationWorkflowDto>(`/automations/${id}`, { method: 'PATCH', body: payload }),
    delete: (id: string) => apiFetch<void>(`/automations/${id}`, { method: 'DELETE' }),
    testRun: (id: string, payload?: Record<string, any>) =>
      apiFetch<AutomationExecutionDto>(`/automations/${id}/test-run`, {
        method: 'POST',
        body: payload ?? {},
      }),
    listExecutions: (id: string) =>
      apiFetch<AutomationExecutionDto[]>(`/automations/${id}/executions`),
    getExecution: (execId: string) =>
      apiFetch<AutomationExecutionDto>(`/automations/executions/${execId}`),
    signalExecution: (execId: string, payload: SignalAutomationExecutionPayload) =>
      apiFetch<AutomationExecutionDto>(`/automations/executions/${execId}/signal`, {
        method: 'POST',
        body: payload,
      }),
  },
};

export interface ChannelMessageDto {
  id: string;
  organizationId: string;
  contactId: string | null;
  contact?: ContactDto | null;
  provider: 'WHATSAPP_META' | 'TELEGRAM' | 'EMAIL_SMTP' | 'EMAIL_RESEND';
  direction: 'INBOUND' | 'OUTBOUND';
  sender: string;
  recipient: string;
  body: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  metadata?: Record<string, any>;
  status: 'pending' | 'sent' | 'delivered' | 'failed' | 'received';
  createdAt: string;
}

export interface ChannelConfigDto {
  id: string | null;
  organizationId: string;
  provider: 'WHATSAPP_META' | 'TELEGRAM' | 'EMAIL_SMTP' | 'EMAIL_RESEND';
  isEnabled: boolean;
  status: 'unconfigured' | 'configured' | 'error';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  credentials: Record<string, any> | null;
  webhookSecret: string | null;
  lastTestedAt: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface SaveChannelConfigInput {
  isEnabled?: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
  channelMessages: (params: { contactId?: string; limit?: number } = {}) =>
    ['channels', 'messages', params] as const,
  automations: ['automations'] as const,
  automation: (id: string) => ['automations', id] as const,
  automationExecutions: (id: string) => ['automations', id, 'executions'] as const,
  automationExecution: (execId: string) => ['automations', 'executions', execId] as const,
};
