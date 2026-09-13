/* One slice of the browser's API surface. Composed in ./index.ts.
 * Split out of a single 477-line module so that two feature branches adding
 * endpoints no longer edit the same two objects. */
import type {
  AutomationWorkflowDto,
  AutomationExecutionDto,
  CreateAutomationWorkflowPayload,
  UpdateAutomationWorkflowPayload,
  SignalAutomationExecutionPayload,
} from '@saas/shared';
import { apiFetch } from '../client';

export const automationsEndpoints = {
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

export const automationsKeys = {
  automations: ['automations'] as const,  automation: (id: string) => ['automations', id] as const,  automationExecutions: (id: string) => ['automations', id, 'executions'] as const,  automationExecution: (execId: string) => ['automations', 'executions', execId] as const,};
