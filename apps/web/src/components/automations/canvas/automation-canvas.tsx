'use client';

import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Connection,
  Edge,
  Node,
  ReactFlowInstance,
  BackgroundVariant,
  type OnConnect,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { NODE_TYPES } from '../nodes/node-types';
import type { AutomationNodeType } from '@saas/shared';
import { CanvasActionsContext, outputKey } from './canvas-actions';
import { availableData, hasPlaceholder, namedText, type DataGroup } from '../step-wording';
import { crmEventOf } from '../crm-events';

/** Never zoom in past life size: one step alone should not fill the screen. */
const FIT_VIEW = { maxZoom: 1, padding: 0.12 } as const;

export interface AutomationCanvasProps {
  nodes: Node[];
  edges: Edge[];
  onNodesChange: (changes: any) => void;
  onEdgesChange: (changes: any) => void;
  onConnect: OnConnect;
  onSelectNode: (node: Node | null) => void;
  onAddNode: (type: AutomationNodeType, position?: { x: number; y: number }) => void;
  /** The "+" on a step: open the step chooser for that output. Without it, steps show no "+". */
  onAddAfter?: (nodeId: string, handle: string | null) => void;
  /** The automation's schedule in words, shown on a schedule step. */
  scheduleSummary?: string | null;
  className?: string;
}

export function AutomationCanvas({
  nodes,
  edges,
  onNodesChange,
  onEdgesChange,
  onConnect,
  onSelectNode,
  onAddNode,
  onAddAfter,
  scheduleSummary,
  className,
}: AutomationCanvasProps) {
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const flowInstanceRef = useRef<ReactFlowInstance | null>(null);

  // What each step's data is called. Rebuilt when steps or their settings
  // change, not on every pixel a step is dragged.
  const graphKey = JSON.stringify(nodes.map((n) => [n.id, n.type, n.data?.label, crmEventOf(n.data?.config as Record<string, unknown> | undefined)]));
  const nameData = useMemo(() => {
    const steps = (JSON.parse(graphKey) as [string, string, string | undefined, string | null][]).map(
      ([id, type, label, event]) => ({ id, type: type as AutomationNodeType, data: { label, config: { event } } }),
    );
    const known = new Map<string, DataGroup[]>(steps.map((s) => [s.id, availableData(s.id, steps, edges)]));
    return (nodeId: string, text: string) =>
      hasPlaceholder(text) ? namedText(text, known.get(nodeId) ?? []) : text;
  }, [graphKey, edges]);

  const actions = useMemo(
    () =>
      onAddAfter
        ? {
            onAddAfter,
            connectedOutputs: new Set(edges.map((e) => outputKey(e.source, e.sourceHandle))),
            scheduleSummary,
            nameData,
          }
        : null,
    [onAddAfter, edges, scheduleSummary, nameData],
  );

  // A step added with "+" may land outside the view: bring everything back in.
  const stepCount = nodes.length;
  const lastCount = useRef(stepCount);
  useEffect(() => {
    if (stepCount > lastCount.current) {
      const frame = requestAnimationFrame(() => flowInstanceRef.current?.fitView({ ...FIT_VIEW, duration: 300 }));
      lastCount.current = stepCount;
      return () => cancelAnimationFrame(frame);
    }
    lastCount.current = stepCount;
  }, [stepCount]);

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();

      const nodeType =
        event.dataTransfer.getData('application/reactflow') ||
        event.dataTransfer.getData('automation/node-type');

      if (!nodeType || !flowInstanceRef.current || !reactFlowWrapper.current) return;

      const position = flowInstanceRef.current.screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });

      onAddNode(nodeType as AutomationNodeType, position);
    },
    [onAddNode],
  );

  return (
    <div
      ref={reactFlowWrapper}
      data-testid="automation-canvas-viewport"
      onDragOver={onDragOver}
      onDrop={onDrop}
      className={`relative h-full w-full bg-surface-muted/60 overflow-hidden ${className || ''}`}
    >
      <CanvasActionsContext.Provider value={actions}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onInit={(instance) => {
          flowInstanceRef.current = instance;
        }}
        onNodeClick={(_, node) => onSelectNode(node)}
        onPaneClick={() => onSelectNode(null)}
        fitView
        fitViewOptions={FIT_VIEW}
        defaultEdgeOptions={{
          animated: true,
          style: { stroke: 'var(--color-brand)', strokeWidth: 2 },
        }}
      >
        <Background variant={BackgroundVariant.Dots} color="var(--color-border-strong)" gap={18} size={1.5} />
        <Controls className="!bg-surface !border-border !shadow-sm !rounded-xl overflow-hidden [&_button]:!bg-surface [&_button]:!text-ink [&_button]:!border-border [&_button:hover]:!bg-surface-muted" />
        <MiniMap
          className="!bg-surface !border-border !rounded-xl !shadow-sm overflow-hidden"
          nodeColor={(n) => (n.selected ? 'var(--color-brand)' : 'var(--color-border-strong)')}
          maskColor="color-mix(in oklch, var(--color-surface-muted) 70%, transparent)"
        />
      </ReactFlow>
      </CanvasActionsContext.Provider>
    </div>
  );
}
