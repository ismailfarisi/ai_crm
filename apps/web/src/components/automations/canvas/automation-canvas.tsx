'use client';

import React, { useCallback, useRef } from 'react';
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
import type { AutomationNode, AutomationNodeType } from '@saas/shared';

export interface AutomationCanvasProps {
  nodes: Node[];
  edges: Edge[];
  onNodesChange: (changes: any) => void;
  onEdgesChange: (changes: any) => void;
  onConnect: OnConnect;
  onSelectNode: (node: Node | null) => void;
  onAddNode: (type: AutomationNodeType, position?: { x: number; y: number }) => void;
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
  className,
}: AutomationCanvasProps) {
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const flowInstanceRef = useRef<ReactFlowInstance | null>(null);

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

      const bounds = reactFlowWrapper.current.getBoundingClientRect();
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
      className={`relative h-full w-full bg-stone-50/60 overflow-hidden ${className || ''}`}
    >
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
        defaultEdgeOptions={{
          animated: true,
          style: { stroke: '#d97706', strokeWidth: 2 },
        }}
      >
        <Background variant={BackgroundVariant.Dots} color="#d6d3d1" gap={18} size={1.5} />
        <Controls className="!bg-white !border-stone-200 !shadow-sm !rounded-xl overflow-hidden" />
        <MiniMap
          className="!bg-white !border-stone-200 !rounded-xl !shadow-sm overflow-hidden"
          nodeColor={(n) => (n.selected ? '#d97706' : '#a8a29e')}
          maskColor="rgba(245, 245, 244, 0.7)"
        />
      </ReactFlow>
    </div>
  );
}
