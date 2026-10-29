/* One slice of the browser's API surface. Composed in ./index.ts.
 * Split out of a single 477-line module so that two feature branches adding
 * endpoints no longer edit the same two objects. */
import type {
  AutomationWorkflowDto,
  AutomationExecutionDto,
  CreateAutomationWorkflowPayload,
  UpdateAutomationWorkflowPayload,
  SignalAutomationExecutionPayload,
  AutomationExecutionPageDto,
  AutomationApprovalDto,
  ApprovalDecisionPayload,
} from '@saas/shared';
import { apiFetch } from '../client';

export interface AutomationSettingsDto {
  aiEmailToCustomers: boolean;
}

export const automationsEndpoints = {
  automations: {
    list: () => apiFetch<AutomationWorkflowDto[]>('/automations'),
    settings: () => apiFetch<AutomationSettingsDto>('/automations/settings'),
    get: (id: string) => apiFetch<AutomationWorkflowDto>(`/automations/${id}`),
    create: (payload: CreateAutomationWorkflowPayload) =>
      apiFetch<AutomationWorkflowDto>('/automations', { method: 'POST', body: payload }),
    update: (id: string, payload: UpdateAutomationWorkflowPayload) =>
      apiFetch<AutomationWorkflowDto>(`/automations/${id}`, { method: 'PATCH', body: payload }),
    delete: (id: string) => apiFetch<void>(`/automations/${id}`, { method: 'DELETE' }),
    regenerateWebhook: (id: string) =>
      apiFetch<AutomationWorkflowDto>(`/automations/${id}/webhook/regenerate`, { method: 'POST' }),
    testRun: (id: string, payload?: Record<string, any>) =>
      apiFetch<AutomationExecutionDto>(`/automations/${id}/test-run`, {
        method: 'POST',
        body: payload ?? {},
      }),
    listExecutions: (id: string, q: { cursor?: string; status?: string } = {}) =>
      apiFetch<AutomationExecutionPageDto>(`/automations/${id}/executions`, { query: q }),
    getExecution: (execId: string) =>
      apiFetch<AutomationExecutionDto>(`/automations/executions/${execId}`),
    signalExecution: (execId: string, payload: SignalAutomationExecutionPayload) =>
      apiFetch<AutomationExecutionDto>(`/automations/executions/${execId}/signal`, {
        method: 'POST',
        body: payload,
      }),
    listApprovals: () => apiFetch<AutomationApprovalDto[]>('/automation-approvals'),
    countApprovals: () => apiFetch<{ count: number }>('/automation-approvals/count'),
    decideApproval: (approvalId: string, payload: ApprovalDecisionPayload) =>
      apiFetch<AutomationApprovalDto>(`/automation-approvals/${approvalId}/decision`, {
        method: 'POST',
        body: payload,
      }),
  },
};

export const automationsKeys = {
  automations: ['automations'] as const,
  automationSettings: ['automations', 'settings'] as const,
  automation: (id: string) => ['automations', id] as const,
  automationExecutions: (id: string) => ['automations', id, 'executions'] as const,
  automationExecution: (execId: string) => ['automations', 'executions', execId] as const,
  automationApprovals: ['automations', 'approvals'] as const,
  automationApprovalCount: ['automations', 'approvals', 'count'] as const,
};
