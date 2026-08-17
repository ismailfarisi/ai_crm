'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type {
  AutomationWorkflowDto,
  AutomationExecutionDto,
  CreateAutomationWorkflowPayload,
  UpdateAutomationWorkflowPayload,
  SignalAutomationExecutionPayload,
  AutomationNode,
  AutomationEdge,
  AutomationNodeType,
  AutomationNodeData,
  AutomationTriggerType,
} from '@saas/shared';
import { validateWorkflowGraph } from '@saas/shared';
import { api, queryKeys } from '@/lib/api/endpoints';
import { ApiError } from '@/lib/api/client';

export type {
  AutomationWorkflowDto,
  AutomationExecutionDto,
  CreateAutomationWorkflowPayload,
  UpdateAutomationWorkflowPayload,
  SignalAutomationExecutionPayload,
  AutomationNode,
  AutomationEdge,
  AutomationNodeType,
  AutomationNodeData,
  AutomationTriggerType,
};
export { validateWorkflowGraph };

function describe(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    return error.isForbidden ? "You don't have permission to do that" : error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return fallback;
}

export function useInvalidateAutomations() {
  const queryClient = useQueryClient();
  return {
    invalidateAll: () => queryClient.invalidateQueries({ queryKey: queryKeys.automations }),
    invalidateWorkflow: (id: string) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.automations });
      queryClient.invalidateQueries({ queryKey: queryKeys.automation(id) });
    },
    invalidateExecutions: (id: string) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.automationExecutions(id) });
    },
    invalidateExecution: (execId: string) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.automationExecution(execId) });
    },
  };
}

export function useCreateAutomationWorkflow() {
  const { invalidateAll } = useInvalidateAutomations();

  return useMutation({
    mutationFn: (input: CreateAutomationWorkflowPayload) => api.automations.create(input),
    onSuccess: async (workflow) => {
      await invalidateAll();
      toast.success(`Workflow "${workflow.name}" created`);
    },
    onError: (error) => toast.error(describe(error, 'Could not create automation workflow')),
  });
}

export function useUpdateAutomationWorkflow() {
  const { invalidateWorkflow } = useInvalidateAutomations();

  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateAutomationWorkflowPayload }) =>
      api.automations.update(id, input),
    onSuccess: async (workflow) => {
      await invalidateWorkflow(workflow.id);
      toast.success(`Workflow "${workflow.name}" updated`);
    },
    onError: (error) => toast.error(describe(error, 'Could not update automation workflow')),
  });
}

export function useDeleteAutomationWorkflow() {
  const { invalidateWorkflow } = useInvalidateAutomations();

  return useMutation({
    mutationFn: (id: string) => api.automations.delete(id),
    onSuccess: async (_, id) => {
      await invalidateWorkflow(id);
      toast.success('Automation workflow deleted');
    },
    onError: (error) => toast.error(describe(error, 'Could not delete automation workflow')),
  });
}

export function useTestRunAutomation() {
  const { invalidateExecutions } = useInvalidateAutomations();

  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload?: Record<string, any> }) =>
      api.automations.testRun(id, payload),
    onSuccess: async (execution, variables) => {
      await invalidateExecutions(variables.id);
      toast.success('Test run triggered successfully');
    },
    onError: (error) => toast.error(describe(error, 'Failed to trigger test run')),
  });
}

export function useSignalAutomationExecution() {
  const { invalidateExecutions, invalidateExecution } = useInvalidateAutomations();

  return useMutation({
    mutationFn: ({
      execId,
      payload,
      workflowId,
    }: {
      execId: string;
      payload: SignalAutomationExecutionPayload;
      workflowId?: string;
    }) => api.automations.signalExecution(execId, payload),
    onSuccess: async (execution, variables) => {
      if (variables.workflowId) {
        await invalidateExecutions(variables.workflowId);
      }
      await invalidateExecution(variables.execId);
      toast.success(`Execution ${variables.payload.action === 'APPROVE' ? 'approved' : 'rejected'}`);
    },
    onError: (error) => toast.error(describe(error, 'Failed to signal execution')),
  });
}

export function useAutomationExecutions(workflowId: string | null | undefined) {
  return useQuery({
    queryKey: workflowId ? queryKeys.automationExecutions(workflowId) : ['automations', 'none', 'executions'],
    queryFn: () => (workflowId ? api.automations.listExecutions(workflowId) : Promise.resolve([])),
    enabled: Boolean(workflowId),
  });
}

export function useAutomationExecution(executionId: string | null | undefined) {
  const query = useQuery({
    queryKey: executionId ? queryKeys.automationExecution(executionId) : ['automations', 'executions', 'none'],
    queryFn: () => (executionId ? api.automations.getExecution(executionId) : Promise.resolve(null)),
    enabled: Boolean(executionId),
  });

  const signalMutation = useSignalAutomationExecution();

  const signal = async (payload: SignalAutomationExecutionPayload) => {
    if (!executionId) throw new Error('No execution ID provided');
    return signalMutation.mutateAsync({
      execId: executionId,
      payload,
      workflowId: query.data?.workflowId,
    });
  };

  return {
    execution: query.data ?? null,
    isLoading: query.isLoading,
    error: query.error,
    refresh: query.refetch,
    signal,
    isSignaling: signalMutation.isPending,
  };
}

export function useAutomations() {
  const query = useQuery({
    queryKey: queryKeys.automations,
    queryFn: () => api.automations.list(),
  });

  const createMutation = useCreateAutomationWorkflow();
  const updateMutation = useUpdateAutomationWorkflow();
  const deleteMutation = useDeleteAutomationWorkflow();

  const createWorkflow = async (payload: CreateAutomationWorkflowPayload) => {
    return createMutation.mutateAsync(payload);
  };

  const updateWorkflow = async (id: string, payload: UpdateAutomationWorkflowPayload) => {
    return updateMutation.mutateAsync({ id, input: payload });
  };

  const deleteWorkflow = async (id: string) => {
    return deleteMutation.mutateAsync(id);
  };

  return {
    workflows: query.data ?? [],
    data: query.data ?? [],
    isLoading: query.isLoading,
    error: query.error,
    refresh: query.refetch,
    refetch: query.refetch,
    createWorkflow,
    updateWorkflow,
    deleteWorkflow,
    isCreating: createMutation.isPending,
    isUpdating: updateMutation.isPending,
    isDeleting: deleteMutation.isPending,
  };
}

export function useAutomation(id: string | null | undefined) {
  const query = useQuery({
    queryKey: id ? queryKeys.automation(id) : ['automations', 'none'],
    queryFn: () => (id ? api.automations.get(id) : Promise.resolve(null)),
    enabled: Boolean(id),
  });

  const executionsQuery = useAutomationExecutions(id);
  const updateMutation = useUpdateAutomationWorkflow();
  const deleteMutation = useDeleteAutomationWorkflow();
  const testRunMutation = useTestRunAutomation();
  const signalMutation = useSignalAutomationExecution();

  const updateWorkflow = async (payload: UpdateAutomationWorkflowPayload) => {
    if (!id) throw new Error('No workflow ID provided');
    return updateMutation.mutateAsync({ id, input: payload });
  };

  const deleteWorkflow = async () => {
    if (!id) throw new Error('No workflow ID provided');
    return deleteMutation.mutateAsync(id);
  };

  const testRun = async (payload?: Record<string, any>) => {
    if (!id) throw new Error('No workflow ID provided');
    return testRunMutation.mutateAsync({ id, payload });
  };

  const signalExecution = async (execId: string, payload: SignalAutomationExecutionPayload) => {
    return signalMutation.mutateAsync({ execId, payload, workflowId: id ?? undefined });
  };

  return {
    workflow: query.data ?? null,
    data: query.data ?? null,
    isLoading: query.isLoading,
    error: query.error,
    refresh: query.refetch,
    executions: executionsQuery.data ?? [],
    executionsLoading: executionsQuery.isLoading,
    executionsError: executionsQuery.error,
    refreshExecutions: executionsQuery.refetch,
    updateWorkflow,
    deleteWorkflow,
    testRun,
    signalExecution,
    isUpdating: updateMutation.isPending,
    isDeleting: deleteMutation.isPending,
    isTesting: testRunMutation.isPending,
    isSignaling: signalMutation.isPending,
  };
}
