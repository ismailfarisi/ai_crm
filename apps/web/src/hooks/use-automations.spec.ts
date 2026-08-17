import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { api } from '@/lib/api/endpoints';
import {
  useAutomations,
  useAutomation,
  useAutomationExecution,
} from './use-automations';
import { useAutomationCanvas } from './use-automation-canvas';
import type {
  AutomationWorkflowDto,
  AutomationExecutionDto,
  AutomationNode,
  AutomationEdge,
} from '@saas/shared';

// Mock api methods
vi.mock('@/lib/api/endpoints', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/api/endpoints')>();
  return {
    ...original,
    api: {
      ...original.api,
      automations: {
        list: vi.fn(),
        get: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
        testRun: vi.fn(),
        listExecutions: vi.fn(),
        getExecution: vi.fn(),
        signalExecution: vi.fn(),
      },
    },
  };
});

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
      },
      mutations: {
        retry: false,
      },
    },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

const mockWorkflow: AutomationWorkflowDto = {
  id: 'wf-123',
  tenantId: 'tenant-abc',
  name: 'Lead Enrichment Workflow',
  description: 'Enriches lead upon creation',
  status: 'ACTIVE',
  triggerType: 'CRM_EVENT',
  triggerConfig: { eventType: 'contact.created' },
  nodes: [
    {
      id: 'node-trigger',
      type: 'crmEventTrigger',
      position: { x: 100, y: 100 },
      data: { label: 'CRM Event Trigger', config: { eventType: 'contact.created' } },
    },
    {
      id: 'node-enrich',
      type: 'aiPromptNode',
      position: { x: 100, y: 250 },
      data: { label: 'Enrich Lead', config: { model: 'gpt-4o-mini', prompt: 'Enrich data' } },
    },
  ],
  edges: [
    {
      id: 'edge-1',
      source: 'node-trigger',
      target: 'node-enrich',
    },
  ],
  version: 1,
  createdAt: '2026-08-17T12:00:00Z',
  updatedAt: '2026-08-17T12:00:00Z',
};

const mockExecution: AutomationExecutionDto = {
  id: 'exec-456',
  tenantId: 'tenant-abc',
  workflowId: 'wf-123',
  temporalWorkflowId: 'temporal-wf-123-exec-456',
  status: 'RUNNING',
  triggerPayload: { contactId: 'cnt-1' },
  nodeResults: {},
  startedAt: '2026-08-17T12:05:00Z',
};

describe('API Client Endpoints for Automations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('provides all required automations API endpoints', () => {
    expect(typeof api.automations.list).toBe('function');
    expect(typeof api.automations.get).toBe('function');
    expect(typeof api.automations.create).toBe('function');
    expect(typeof api.automations.update).toBe('function');
    expect(typeof api.automations.delete).toBe('function');
    expect(typeof api.automations.testRun).toBe('function');
    expect(typeof api.automations.listExecutions).toBe('function');
    expect(typeof api.automations.getExecution).toBe('function');
    expect(typeof api.automations.signalExecution).toBe('function');
  });
});

describe('useAutomations Hook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.automations.list).mockResolvedValue([mockWorkflow]);
    vi.mocked(api.automations.get).mockResolvedValue(mockWorkflow);
    vi.mocked(api.automations.create).mockResolvedValue(mockWorkflow);
    vi.mocked(api.automations.update).mockResolvedValue(mockWorkflow);
    vi.mocked(api.automations.delete).mockResolvedValue(undefined);
    vi.mocked(api.automations.testRun).mockResolvedValue(mockExecution);
    vi.mocked(api.automations.listExecutions).mockResolvedValue([mockExecution]);
    vi.mocked(api.automations.getExecution).mockResolvedValue(mockExecution);
    vi.mocked(api.automations.signalExecution).mockResolvedValue(mockExecution);
  });

  it('fetches workflows successfully', async () => {
    const { result } = renderHook(() => useAutomations(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.workflows).toEqual([mockWorkflow]);
    expect(api.automations.list).toHaveBeenCalledTimes(1);
  });

  it('creates workflow via createWorkflow mutation', async () => {
    const { result } = renderHook(() => useAutomations(), {
      wrapper: createWrapper(),
    });

    let created: AutomationWorkflowDto | undefined;
    await act(async () => {
      created = await result.current.createWorkflow({
        name: 'Lead Enrichment Workflow',
        triggerType: 'CRM_EVENT',
        triggerConfig: { eventType: 'contact.created' },
      });
    });

    expect(created).toEqual(mockWorkflow);
    expect(api.automations.create).toHaveBeenCalledWith({
      name: 'Lead Enrichment Workflow',
      triggerType: 'CRM_EVENT',
      triggerConfig: { eventType: 'contact.created' },
    });
  });

  it('deletes workflow via deleteWorkflow mutation', async () => {
    const { result } = renderHook(() => useAutomations(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.deleteWorkflow('wf-123');
    });

    expect(api.automations.delete).toHaveBeenCalledWith('wf-123');
  });
});

describe('useAutomation Hook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.automations.list).mockResolvedValue([mockWorkflow]);
    vi.mocked(api.automations.get).mockResolvedValue(mockWorkflow);
    vi.mocked(api.automations.create).mockResolvedValue(mockWorkflow);
    vi.mocked(api.automations.update).mockResolvedValue(mockWorkflow);
    vi.mocked(api.automations.delete).mockResolvedValue(undefined);
    vi.mocked(api.automations.testRun).mockResolvedValue(mockExecution);
    vi.mocked(api.automations.listExecutions).mockResolvedValue([mockExecution]);
    vi.mocked(api.automations.getExecution).mockResolvedValue(mockExecution);
    vi.mocked(api.automations.signalExecution).mockResolvedValue(mockExecution);
  });

  it('fetches single workflow and executions', async () => {
    const { result } = renderHook(() => useAutomation('wf-123'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.workflow).toEqual(mockWorkflow);
    expect(result.current.executions).toEqual([mockExecution]);
    expect(api.automations.get).toHaveBeenCalledWith('wf-123');
    expect(api.automations.listExecutions).toHaveBeenCalledWith('wf-123');
  });

  it('updates workflow and triggers test run', async () => {
    vi.mocked(api.automations.update).mockResolvedValueOnce({ ...mockWorkflow, name: 'Updated Name' });

    const { result } = renderHook(() => useAutomation('wf-123'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.updateWorkflow({ name: 'Updated Name' });
    });
    expect(api.automations.update).toHaveBeenCalledWith('wf-123', { name: 'Updated Name' });

    await act(async () => {
      await result.current.testRun({ sample: true });
    });
    expect(api.automations.testRun).toHaveBeenCalledWith('wf-123', { sample: true });
  });

  it('signals execution from workflow hook', async () => {
    vi.mocked(api.automations.signalExecution).mockResolvedValueOnce({
      ...mockExecution,
      status: 'COMPLETED',
    });

    const { result } = renderHook(() => useAutomation('wf-123'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.signalExecution('exec-456', {
        action: 'APPROVE',
        nodeId: 'node-approval',
        comment: 'Looks good',
      });
    });

    expect(api.automations.signalExecution).toHaveBeenCalledWith('exec-456', {
      action: 'APPROVE',
      nodeId: 'node-approval',
      comment: 'Looks good',
    });
  });
});

describe('useAutomationExecution Hook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.automations.getExecution).mockResolvedValue(mockExecution);
    vi.mocked(api.automations.signalExecution).mockResolvedValue({
      ...mockExecution,
      status: 'COMPLETED',
    });
  });

  it('fetches execution details and allows signaling', async () => {
    const { result } = renderHook(() => useAutomationExecution('exec-456'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.execution).toEqual(mockExecution);

    await act(async () => {
      await result.current.signal({
        action: 'APPROVE',
        nodeId: 'node-approval',
      });
    });

    expect(api.automations.signalExecution).toHaveBeenCalledWith('exec-456', {
      action: 'APPROVE',
      nodeId: 'node-approval',
    });
  });
});

describe('useAutomationCanvas Hook', () => {
  const initialNodes: AutomationNode[] = [
    {
      id: 'node-1',
      type: 'webhookTrigger',
      position: { x: 100, y: 100 },
      data: { label: 'Webhook', config: {} },
    },
    {
      id: 'node-2',
      type: 'sendEmailNode',
      position: { x: 100, y: 300 },
      data: { label: 'Send Email', config: { to: 'user@example.com' } },
    },
  ];

  const initialEdges: AutomationEdge[] = [
    {
      id: 'edge-1-2',
      source: 'node-1',
      target: 'node-2',
    },
  ];

  it('initializes nodes and edges cleanly', () => {
    const { result } = renderHook(() =>
      useAutomationCanvas({
        initialNodes,
        initialEdges,
      })
    );

    expect(result.current.nodes).toHaveLength(2);
    expect(result.current.edges).toHaveLength(1);
    expect(result.current.isDirty).toBe(false);
    expect(result.current.isValid).toBe(true);
    expect(result.current.triggerNodeId).toBe('node-1');
  });

  it('adds node and tracks dirty state and undo history', () => {
    const onDirtyChange = vi.fn();
    const { result } = renderHook(() =>
      useAutomationCanvas({
        initialNodes,
        initialEdges,
        onDirtyChange,
      })
    );

    expect(result.current.canUndo).toBe(false);

    act(() => {
      result.current.addNode({
        type: 'conditionNode',
        position: { x: 200, y: 400 },
        data: { label: 'Check Status' },
      });
    });

    expect(result.current.nodes).toHaveLength(3);
    expect(result.current.isDirty).toBe(true);
    expect(result.current.canUndo).toBe(true);
    expect(result.current.selectedNode?.data.label).toBe('Check Status');

    // Test Undo
    act(() => {
      result.current.undo();
    });

    expect(result.current.nodes).toHaveLength(2);
    expect(result.current.canRedo).toBe(true);

    // Test Redo
    act(() => {
      result.current.redo();
    });

    expect(result.current.nodes).toHaveLength(3);
  });

  it('updates node data correctly', () => {
    const { result } = renderHook(() =>
      useAutomationCanvas({
        initialNodes,
        initialEdges,
      })
    );

    act(() => {
      result.current.updateNodeData('node-2', {
        label: 'Send Welcome Email',
        config: { subject: 'Welcome!' },
      });
    });

    const updated = result.current.nodes.find((n) => n.id === 'node-2');
    expect(updated?.data.label).toBe('Send Welcome Email');
    expect(updated?.data.config).toEqual({
      to: 'user@example.com',
      subject: 'Welcome!',
    });
    expect(result.current.isDirty).toBe(true);
  });

  it('deletes node and cascades connected edges', () => {
    const { result } = renderHook(() =>
      useAutomationCanvas({
        initialNodes,
        initialEdges,
      })
    );

    expect(result.current.edges).toHaveLength(1);

    act(() => {
      result.current.deleteNode('node-1');
    });

    expect(result.current.nodes).toHaveLength(1);
    expect(result.current.edges).toHaveLength(0);
    expect(result.current.isDirty).toBe(true);
  });

  it('connects nodes via onConnect', () => {
    const { result } = renderHook(() =>
      useAutomationCanvas({
        initialNodes,
        initialEdges: [],
      })
    );

    expect(result.current.edges).toHaveLength(0);

    act(() => {
      result.current.onConnect({
        source: 'node-1',
        target: 'node-2',
        sourceHandle: null,
        targetHandle: null,
      });
    });

    expect(result.current.edges).toHaveLength(1);
    expect(result.current.edges[0].source).toBe('node-1');
    expect(result.current.edges[0].target).toBe('node-2');
  });

  it('marks clean and resets canvas', () => {
    const { result } = renderHook(() =>
      useAutomationCanvas({
        initialNodes,
        initialEdges,
      })
    );

    act(() => {
      result.current.addNode({ type: 'delayNode' });
    });
    expect(result.current.isDirty).toBe(true);

    act(() => {
      result.current.markClean();
    });
    expect(result.current.isDirty).toBe(false);

    act(() => {
      result.current.resetCanvas([], []);
    });
    expect(result.current.nodes).toHaveLength(0);
    expect(result.current.edges).toHaveLength(0);
    expect(result.current.isDirty).toBe(false);
    expect(result.current.isValid).toBe(false); // No trigger node
  });

  it('serializes graph accurately via getGraphPayload', () => {
    const { result } = renderHook(() =>
      useAutomationCanvas({
        initialNodes,
        initialEdges,
      })
    );

    const payload = result.current.getGraphPayload();
    expect(payload.nodes).toHaveLength(2);
    expect(payload.edges).toHaveLength(1);
    expect(payload.nodes[0].type).toBe('webhookTrigger');
    expect(payload.edges[0].source).toBe('node-1');
  });
});
