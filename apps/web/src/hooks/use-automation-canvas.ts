'use client';

import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import {
  applyNodeChanges,
  applyEdgeChanges,
  addEdge,
  type Node,
  type Edge,
  type Connection,
  type NodeChange,
  type EdgeChange,
  type OnNodesChange,
  type OnEdgesChange,
  type OnConnect,
} from '@xyflow/react';
import type {
  AutomationNode,
  AutomationEdge,
  AutomationNodeType,
  AutomationNodeData,
} from '@saas/shared';
import { validateWorkflowGraph } from '@saas/shared';

export const DEFAULT_NODE_LABELS: Record<AutomationNodeType, string> = {
  webhookTrigger: 'Webhook Trigger',
  scheduleTrigger: 'Schedule Trigger',
  crmEventTrigger: 'CRM Event Trigger',
  manualTrigger: 'Manual Trigger',
  conditionNode: 'Condition Branch',
  transformNode: 'Data Transform',
  delayNode: 'Delay Execution',
  httpRequestNode: 'HTTP Request',
  aiPromptNode: 'AI Prompt / LLM',
  sendEmailNode: 'Send Email',
  crmMutateNode: 'CRM Mutation',
  approvalNode: 'Human Approval',
};

export const DEFAULT_NODE_CONFIGS: Record<AutomationNodeType, Record<string, any>> = {
  webhookTrigger: {},
  scheduleTrigger: { cron: '0 9 * * 1-5' },
  crmEventTrigger: { eventType: 'contact.created' },
  manualTrigger: {},
  conditionNode: { condition: '' },
  transformNode: { script: '' },
  delayNode: { delayMinutes: 5 },
  httpRequestNode: { method: 'GET', url: '', headers: {}, body: '' },
  aiPromptNode: { model: 'gpt-4o-mini', prompt: '', outputVariable: 'aiResult' },
  sendEmailNode: { to: '', subject: '', body: '' },
  crmMutateNode: { action: 'CREATE_CONTACT', payload: {} },
  approvalNode: { approverRole: 'admin', timeoutDuration: '3 days' },
};

export function toReactFlowNodes(nodes: AutomationNode[] = []): Node<AutomationNodeData>[] {
  return nodes.map((n) => ({
    id: n.id,
    type: n.type,
    position: { x: n.position?.x ?? 0, y: n.position?.y ?? 0 },
    data: {
      label: n.data?.label || DEFAULT_NODE_LABELS[n.type] || 'Untitled Step',
      config: n.data?.config || DEFAULT_NODE_CONFIGS[n.type] || {},
      continueOnFail: n.data?.continueOnFail,
      retryCount: n.data?.retryCount,
      timeoutDuration: n.data?.timeoutDuration,
    },
  }));
}

export function toReactFlowEdges(edges: AutomationEdge[] = []): Edge[] {
  return edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    sourceHandle: e.sourceHandle ?? undefined,
    targetHandle: e.targetHandle ?? undefined,
    animated: true,
  }));
}

export function toAutomationNodes(nodes: Node<AutomationNodeData>[]): AutomationNode[] {
  return nodes.map((n) => ({
    id: n.id,
    type: (n.type as AutomationNodeType) || 'manualTrigger',
    position: { x: Math.round(n.position.x), y: Math.round(n.position.y) },
    data: {
      label: n.data?.label || 'Untitled Step',
      config: n.data?.config || {},
      continueOnFail: n.data?.continueOnFail,
      retryCount: n.data?.retryCount,
      timeoutDuration: n.data?.timeoutDuration,
    },
  }));
}

export function toAutomationEdges(edges: Edge[]): AutomationEdge[] {
  return edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    sourceHandle: e.sourceHandle || null,
    targetHandle: e.targetHandle || null,
  }));
}

export interface HistorySnapshot {
  nodes: Node<AutomationNodeData>[];
  edges: Edge[];
}

export interface UseAutomationCanvasOptions {
  initialNodes?: AutomationNode[];
  initialEdges?: AutomationEdge[];
  onDirtyChange?: (isDirty: boolean) => void;
  maxHistorySize?: number;
}

export interface AddNodeParams {
  type: AutomationNodeType;
  position?: { x: number; y: number };
  data?: Partial<AutomationNodeData>;
  id?: string;
}

function serializeGraph(nodes: Node<AutomationNodeData>[], edges: Edge[]): string {
  const cleanNodes = toAutomationNodes(nodes);
  const cleanEdges = toAutomationEdges(edges);
  return JSON.stringify({ nodes: cleanNodes, edges: cleanEdges });
}

export function useAutomationCanvas(options: UseAutomationCanvasOptions = {}) {
  const { initialNodes = [], initialEdges = [], onDirtyChange, maxHistorySize = 50 } = options;

  const [nodes, setNodes] = useState<Node<AutomationNodeData>[]>(() => toReactFlowNodes(initialNodes));
  const [edges, setEdges] = useState<Edge[]>(() => toReactFlowEdges(initialEdges));

  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);

  const [past, setPast] = useState<HistorySnapshot[]>([]);
  const [future, setFuture] = useState<HistorySnapshot[]>([]);

  const [cleanSnapshot, setCleanSnapshot] = useState<string>(() =>
    serializeGraph(toReactFlowNodes(initialNodes), toReactFlowEdges(initialEdges))
  );

  const currentSnapshot = useMemo(() => serializeGraph(nodes, edges), [nodes, edges]);
  const isDirty = useMemo(() => currentSnapshot !== cleanSnapshot, [currentSnapshot, cleanSnapshot]);

  useEffect(() => {
    onDirtyChange?.(isDirty);
  }, [isDirty, onDirtyChange]);

  const pushSnapshot = useCallback(
    (newPastSnapshot: HistorySnapshot) => {
      setPast((prev) => {
        const next = [...prev, newPastSnapshot];
        if (next.length > maxHistorySize) {
          return next.slice(next.length - maxHistorySize);
        }
        return next;
      });
      setFuture([]);
    },
    [maxHistorySize]
  );

  const onNodesChange: OnNodesChange<Node<AutomationNodeData>> = useCallback(
    (changes: NodeChange<Node<AutomationNodeData>>[]) => {
      setNodes((currentNodes) => {
        const updated = applyNodeChanges(changes, currentNodes);
        return updated;
      });
    },
    []
  );

  const onEdgesChange: OnEdgesChange<Edge> = useCallback((changes: EdgeChange<Edge>[]) => {
    setEdges((currentEdges) => {
      const updated = applyEdgeChanges(changes, currentEdges);
      return updated;
    });
  }, []);

  const onConnect: OnConnect = useCallback(
    (connection: Connection) => {
      pushSnapshot({ nodes, edges });
      setEdges((eds) => addEdge({ ...connection, animated: true }, eds));
    },
    [nodes, edges, pushSnapshot]
  );

  const addNode = useCallback(
    (params: AddNodeParams): Node<AutomationNodeData> => {
      pushSnapshot({ nodes, edges });
      const nodeId = params.id || `node_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      const nodeType = params.type;
      const defaultLabel = DEFAULT_NODE_LABELS[nodeType] || 'Step';
      const defaultConfig = DEFAULT_NODE_CONFIGS[nodeType] || {};

      const newNode: Node<AutomationNodeData> = {
        id: nodeId,
        type: nodeType,
        position: params.position || {
          x: 250,
          y: (nodes.length + 1) * 120,
        },
        data: {
          label: params.data?.label || defaultLabel,
          config: {
            ...defaultConfig,
            ...(params.data?.config || {}),
          },
          continueOnFail: params.data?.continueOnFail ?? false,
          retryCount: params.data?.retryCount ?? 0,
          timeoutDuration: params.data?.timeoutDuration,
        },
      };

      setNodes((prev) => [...prev, newNode]);
      setSelectedNodeId(nodeId);
      setSelectedEdgeId(null);
      return newNode;
    },
    [nodes, edges, pushSnapshot]
  );

  const updateNodeData = useCallback(
    (nodeId: string, partialData: Partial<AutomationNodeData>) => {
      pushSnapshot({ nodes, edges });
      setNodes((prevNodes) =>
        prevNodes.map((n) => {
          if (n.id !== nodeId) return n;
          return {
            ...n,
            data: {
              ...n.data,
              ...partialData,
              config: {
                ...(n.data?.config || {}),
                ...(partialData.config || {}),
              },
            },
          };
        })
      );
    },
    [nodes, edges, pushSnapshot]
  );

  const updateNode = useCallback(
    (nodeId: string, updates: Partial<Node<AutomationNodeData>>) => {
      pushSnapshot({ nodes, edges });
      setNodes((prevNodes) =>
        prevNodes.map((n) => {
          if (n.id !== nodeId) return n;
          return {
            ...n,
            ...updates,
            data: {
              ...n.data,
              ...(updates.data || {}),
            },
          };
        })
      );
    },
    [nodes, edges, pushSnapshot]
  );

  const deleteNode = useCallback(
    (nodeId: string) => {
      pushSnapshot({ nodes, edges });
      setNodes((prevNodes) => prevNodes.filter((n) => n.id !== nodeId));
      setEdges((prevEdges) => prevEdges.filter((e) => e.source !== nodeId && e.target !== nodeId));
      if (selectedNodeId === nodeId) {
        setSelectedNodeId(null);
      }
    },
    [nodes, edges, selectedNodeId, pushSnapshot]
  );

  const deleteEdge = useCallback(
    (edgeId: string) => {
      pushSnapshot({ nodes, edges });
      setEdges((prevEdges) => prevEdges.filter((e) => e.id !== edgeId));
      if (selectedEdgeId === edgeId) {
        setSelectedEdgeId(null);
      }
    },
    [nodes, edges, selectedEdgeId, pushSnapshot]
  );

  const selectedNode = useMemo(() => {
    if (!selectedNodeId) return null;
    return nodes.find((n) => n.id === selectedNodeId) ?? null;
  }, [nodes, selectedNodeId]);

  const selectedEdge = useMemo(() => {
    if (!selectedEdgeId) return null;
    return edges.find((e) => e.id === selectedEdgeId) ?? null;
  }, [edges, selectedEdgeId]);

  const setSelectedNode = useCallback((node: Node<AutomationNodeData> | string | null) => {
    if (!node) {
      setSelectedNodeId(null);
    } else if (typeof node === 'string') {
      setSelectedNodeId(node);
      setSelectedEdgeId(null);
    } else {
      setSelectedNodeId(node.id);
      setSelectedEdgeId(null);
    }
  }, []);

  const setSelectedEdge = useCallback((edge: Edge | string | null) => {
    if (!edge) {
      setSelectedEdgeId(null);
    } else if (typeof edge === 'string') {
      setSelectedEdgeId(edge);
      setSelectedNodeId(null);
    } else {
      setSelectedEdgeId(edge.id);
      setSelectedNodeId(null);
    }
  }, []);

  const onSelectionChange = useCallback((params: { nodes: Node[]; edges: Edge[] }) => {
    if (params.nodes.length > 0) {
      setSelectedNodeId(params.nodes[0].id);
      setSelectedEdgeId(null);
    } else if (params.edges.length > 0) {
      setSelectedEdgeId(params.edges[0].id);
      setSelectedNodeId(null);
    } else {
      setSelectedNodeId(null);
      setSelectedEdgeId(null);
    }
  }, []);

  const onNodeClick = useCallback((_: React.MouseEvent, node: Node<AutomationNodeData>) => {
    setSelectedNodeId(node.id);
    setSelectedEdgeId(null);
  }, []);

  const onEdgeClick = useCallback((_: React.MouseEvent, edge: Edge) => {
    setSelectedEdgeId(edge.id);
    setSelectedNodeId(null);
  }, []);

  const onPaneClick = useCallback(() => {
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
  }, []);

  const undo = useCallback(() => {
    if (past.length === 0) return;
    const previous = past[past.length - 1];
    const newPast = past.slice(0, past.length - 1);

    setFuture((prev) => [{ nodes, edges }, ...prev]);
    setPast(newPast);
    setNodes(previous.nodes);
    setEdges(previous.edges);
  }, [past, nodes, edges]);

  const redo = useCallback(() => {
    if (future.length === 0) return;
    const next = future[0];
    const newFuture = future.slice(1);

    setPast((prev) => [...prev, { nodes, edges }]);
    setFuture(newFuture);
    setNodes(next.nodes);
    setEdges(next.edges);
  }, [future, nodes, edges]);

  const markClean = useCallback(() => {
    setCleanSnapshot(serializeGraph(nodes, edges));
  }, [nodes, edges]);

  const resetCanvas = useCallback(
    (newNodes?: AutomationNode[], newEdges?: AutomationEdge[]) => {
      const rfNodes = toReactFlowNodes(newNodes ?? initialNodes);
      const rfEdges = toReactFlowEdges(newEdges ?? initialEdges);
      setNodes(rfNodes);
      setEdges(rfEdges);
      setPast([]);
      setFuture([]);
      setSelectedNodeId(null);
      setSelectedEdgeId(null);
      setCleanSnapshot(serializeGraph(rfNodes, rfEdges));
    },
    [initialNodes, initialEdges]
  );

  const getGraphPayload = useCallback(() => {
    return {
      nodes: toAutomationNodes(nodes),
      edges: toAutomationEdges(edges),
    };
  }, [nodes, edges]);

  const validation = useMemo(() => {
    const payload = {
      nodes: toAutomationNodes(nodes),
      edges: toAutomationEdges(edges),
    };
    const res = validateWorkflowGraph(payload.nodes, payload.edges);
    return {
      isValid: res.isValid,
      validationError: res.error ?? null,
      triggerNodeId: res.triggerNodeId ?? null,
    };
  }, [nodes, edges]);

  return {
    nodes,
    edges,
    setNodes,
    setEdges,
    onNodesChange,
    onEdgesChange,
    onConnect,
    addNode,
    updateNodeData,
    updateNode,
    deleteNode,
    deleteEdge,
    selectedNode,
    selectedEdge,
    selectedNodeId,
    selectedEdgeId,
    setSelectedNode,
    setSelectedEdge,
    onSelectionChange,
    onNodeClick,
    onEdgeClick,
    onPaneClick,
    isDirty,
    canUndo: past.length > 0,
    canRedo: future.length > 0,
    undo,
    redo,
    markClean,
    resetCanvas,
    getGraphPayload,
    isValid: validation.isValid,
    validationError: validation.validationError,
    triggerNodeId: validation.triggerNodeId,
  };
}
