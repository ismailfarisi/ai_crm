import type {
  AcceptInviteInput,
  AssignRolesInput,
  ChangePasswordInput,
  ChannelLinkCodeDto,
  StaffChannelIdentityDto,
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
  InvoiceDto,
  InvoicePaymentDto,
  RecordInvoicePaymentPayload,
  VoidInvoicePayload,
  AutomationWorkflowDto,
  AutomationExecutionDto,
  CreateAutomationWorkflowPayload,
  UpdateAutomationWorkflowPayload,
  SignalAutomationExecutionPayload,
  FinanceAccountDto,
  ExpenseClaimDto,
  CategoryBudgetDto,
  RecurringExpenseDto,
  JournalEntryDto,
  TreasuryOverviewDto,
  CreateFinanceAccountPayload,
  TransferFundsPayload,
  TransferFundsResult,
  CreateCategoryBudgetPayload,
  CreateRecurringExpensePayload,
  CreateExpenseClaimPayload,
  UpdateExpenseClaimPayload,
  ScanReceiptPayload,
  ScannedReceiptResult,
  SignalExpenseClaimPayload,
  ExpenseListParams,
  AiBudgetDto,
  AiBudgetStatusDto,
  UpsertAiBudgetPayload,
  AiUsageLogDto,
  AiAgentDto,
  CreateAiAgentPayload,
  UpdateAiAgentPayload,
} from '@saas/shared';
import { apiFetch, apiFetchBlob } from './client';
import { API_PUBLIC_URL } from './config';

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
    list: () => apiFetch<InvoiceDto[]>('/invoices'),
    get: (id: string) => apiFetch<InvoiceDto>(`/invoices/${id}`),
    recordPayment: (id: string, payload: RecordInvoicePaymentPayload) =>
      apiFetch<InvoiceDto>(`/invoices/${id}/payments`, {
        method: 'POST',
        body: payload,
      }),
    payments: (id: string) => apiFetch<InvoicePaymentDto[]>(`/invoices/${id}/payments`),
    void: (id: string, payload: VoidInvoicePayload) =>
      apiFetch<InvoiceDto>(`/invoices/${id}/void`, { method: 'POST', body: payload }),
    send: (id: string) =>
      apiFetch<InvoiceDto>(`/invoices/${id}/send`, { method: 'POST' }),
    downloadPdf: (id: string) => apiFetchBlob(`/invoices/${id}/pdf`),
    /** Absolute URL, for reference only — never navigate to it directly (cookie auth). */
    pdfUrl: (id: string) => `${API_PUBLIC_URL}/invoices/${id}/pdf`,
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
    identities: {
      list: () => apiFetch<StaffChannelIdentityDto[]>('/channels/identities'),
      createLinkCode: () =>
        apiFetch<ChannelLinkCodeDto>('/channels/identities/link-code', { method: 'POST' }),
      revoke: (id: string) =>
        apiFetch<{ success: true }>(`/channels/identities/${id}`, { method: 'DELETE' }),
    },
  },

  aiAgents: {
    list: () => apiFetch<AiAgentDto[]>('/channels/ai-agents'),
    get: (id: string) => apiFetch<AiAgentDto>(`/channels/ai-agents/${id}`),
    create: (input: CreateAiAgentPayload) =>
      apiFetch<AiAgentDto>('/channels/ai-agents', { method: 'POST', body: input }),
    update: (id: string, input: UpdateAiAgentPayload) =>
      apiFetch<AiAgentDto>(`/channels/ai-agents/${id}`, { method: 'PATCH', body: input }),
    remove: (id: string) =>
      apiFetch<{ success: true }>(`/channels/ai-agents/${id}`, { method: 'DELETE' }),
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

  finance: {
    getOverview: () => apiFetch<TreasuryOverviewDto>('/finance/overview'),
    listAccounts: () => apiFetch<FinanceAccountDto[]>('/finance/accounts'),
    createAccount: (payload: CreateFinanceAccountPayload) =>
      apiFetch<FinanceAccountDto>('/finance/accounts', { method: 'POST', body: payload }),
    transferFunds: (payload: TransferFundsPayload) =>
      apiFetch<TransferFundsResult>('/finance/accounts/transfer', { method: 'POST', body: payload }),
    listBudgets: () => apiFetch<CategoryBudgetDto[]>('/finance/budgets'),
    createBudget: (payload: CreateCategoryBudgetPayload) =>
      apiFetch<CategoryBudgetDto>('/finance/budgets', { method: 'POST', body: payload }),
    listSubscriptions: () => apiFetch<RecurringExpenseDto[]>('/finance/subscriptions'),
    createSubscription: (payload: CreateRecurringExpensePayload) =>
      apiFetch<RecurringExpenseDto>('/finance/subscriptions', { method: 'POST', body: payload }),
    listJournalEntries: () => apiFetch<JournalEntryDto[]>('/finance/journal-entries'),
  },

  expenses: {
    list: (params: ExpenseListParams = {}) =>
      apiFetch<ExpenseClaimDto[]>('/finance/expenses', { query: params }),
    get: (id: string) => apiFetch<ExpenseClaimDto>(`/finance/expenses/${id}`),
    create: (payload: CreateExpenseClaimPayload) =>
      apiFetch<ExpenseClaimDto>('/finance/expenses', { method: 'POST', body: payload }),
    update: (id: string, payload: UpdateExpenseClaimPayload) =>
      apiFetch<ExpenseClaimDto>(`/finance/expenses/${id}`, { method: 'PATCH', body: payload }),
    scanReceipt: (payload: ScanReceiptPayload) =>
      apiFetch<ScannedReceiptResult>('/finance/expenses/scan-receipt', {
        method: 'POST',
        body: payload,
      }),
    signal: (id: string, payload: SignalExpenseClaimPayload) =>
      apiFetch<ExpenseClaimDto>(`/finance/expenses/${id}/signal`, {
        method: 'POST',
        body: payload,
      }),
  },

  ai: {
    getBudget: () => apiFetch<AiBudgetStatusDto>('/ai/budget'),
    upsertBudget: (payload: UpsertAiBudgetPayload) =>
      apiFetch<AiBudgetDto>('/ai/budget', { method: 'PATCH', body: payload }),
    listUsage: () => apiFetch<AiUsageLogDto[]>('/ai/usage'),
    listConfigs: () => apiFetch<AiConfigDto[]>('/ai/configs'),
    saveConfig: (provider: string, input: SaveAiConfigInput) =>
      apiFetch<AiConfigDto>(`/ai/configs/${provider}`, {
        method: 'POST',
        body: input,
      }),
    testConfig: (provider: string) =>
      apiFetch<TestAiConfigResult>(`/ai/configs/${provider}/test`, {
        method: 'POST',
      }),
    setDefaultConfig: (provider: string) =>
      apiFetch<AiConfigDto>(`/ai/configs/${provider}/default`, {
        method: 'POST',
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
  /** Inbound webhook URL for this provider, as the API server sees it — build this server-side, never on the client. */
  webhookUrl: string;
  /** Present only right after a save that auto-registers the webhook with the provider (currently Telegram). */
  webhookRegistration?: { success: boolean; message: string };
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

export interface AiConfigDto {
  id: string | null;
  organizationId: string;
  provider: 'OPENAI' | 'ANTHROPIC' | 'OPENROUTER';
  isEnabled: boolean;
  isDefault: boolean;
  status: 'unconfigured' | 'configured' | 'error';
  credentials: { apiKey?: string; model?: string } | null;
  lastTestedAt: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface SaveAiConfigInput {
  isEnabled?: boolean;
  credentials?: { apiKey?: string; model?: string };
}

export interface TestAiConfigResult {
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
  invoice: (id: string) => ['invoices', id] as const,
  invoicePayments: (id: string) => ['invoices', id, 'payments'] as const,
  channels: ['channels', 'configs'] as const,
  aiConfigs: ['ai', 'configs'] as const,
  channelIdentities: ['channels', 'identities'] as const,
  channelMessages: (params: { contactId?: string; limit?: number } = {}) =>
    ['channels', 'messages', params] as const,
  automations: ['automations'] as const,
  automation: (id: string) => ['automations', id] as const,
  automationExecutions: (id: string) => ['automations', id, 'executions'] as const,
  automationExecution: (execId: string) => ['automations', 'executions', execId] as const,
  // Finance & Treasury
  financeOverview: ['finance', 'overview'] as const,
  financeAccounts: ['finance', 'accounts'] as const,
  financeBudgets: ['finance', 'budgets'] as const,
  financeSubscriptions: ['finance', 'subscriptions'] as const,
  financeJournalEntries: ['finance', 'journal-entries'] as const,
  // Expenses
  expenses: (params: ExpenseListParams = {}) => ['finance', 'expenses', params] as const,
  expense: (id: string) => ['finance', 'expenses', id] as const,
  // AI
  aiBudget: ['ai', 'budget'] as const,
  aiUsage: ['ai', 'usage'] as const,
  aiAgents: ['ai', 'agents'] as const,
};

