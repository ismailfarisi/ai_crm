'use client';

import React, { useState, useCallback, use, useMemo } from 'react';
import { notFound, useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  useAutomation,
  useUpdateAutomationWorkflow,
  useTestRunAutomation,
} from '@/hooks/use-automations';
import { useAutomationCanvas } from '@/hooks/use-automation-canvas';
import { AutomationCanvas } from '@/components/automations/canvas/automation-canvas';
import { CanvasHeader } from '@/components/automations/canvas/canvas-header';
import { NodePaletteDrawer } from '@/components/automations/drawers/node-palette-drawer';
import { NodeInspectorDrawer } from '@/components/automations/drawers/node-inspector-drawer';
import { TestRunDrawer } from '@/components/automations/drawers/test-run-drawer';
import type { AutomationNodeType, AutomationNode } from '@saas/shared';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default function AutomationStudioPage({ params }: PageProps) {
  const { id } = use(params);
  const router = useRouter();

  const { data: workflow, isLoading, error, refresh } = useAutomation(id);
  const updateWorkflowMutation = useUpdateAutomationWorkflow();
  const testRunMutation = useTestRunAutomation();

  const [workflowName, setWorkflowName] = useState<string>('');
  const [workflowStatus, setWorkflowStatus] = useState<'DRAFT' | 'ACTIVE' | 'PAUSED'>('DRAFT');

  // Drawers visibility states
  const [isPaletteOpen, setIsPaletteOpen] = useState(false);
  const [isTestRunOpen, setIsTestRunOpen] = useState(false);

  // Sync initial workflow data
  React.useEffect(() => {
    if (workflow) {
      setWorkflowName(workflow.name);
      setWorkflowStatus(workflow.status);
    }
  }, [workflow]);

  // React Flow canvas state management
  const {
    nodes,
    edges,
    onNodesChange,
    onEdgesChange,
    onConnect,
    addNode,
    updateNodeData,
    deleteNode,
    selectedNode,
    setSelectedNode,
    isDirty,
    markClean,
    canUndo,
    canRedo,
    undo,
    redo,
    getGraphPayload,
  } = useAutomationCanvas({
    initialNodes: workflow?.nodes || [],
    initialEdges: workflow?.edges || [],
  });

  const handleSave = async () => {
    if (!workflow) return;
    try {
      const graphPayload = getGraphPayload();
      await updateWorkflowMutation.mutateAsync({
        id: workflow.id,
        input: {
          name: workflowName || workflow.name,
          status: workflowStatus,
          nodes: graphPayload.nodes,
          edges: graphPayload.edges,
        },
      });
      markClean();
      toast.success('Automation workflow saved successfully');
      refresh?.();
    } catch (err: any) {
      toast.error(err.message || 'Failed to save workflow');
    }
  };

  const handleStatusToggle = () => {
    const nextStatus = workflowStatus === 'ACTIVE' ? 'PAUSED' : 'ACTIVE';
    setWorkflowStatus(nextStatus);
  };

  const handleAddNodeFromPalette = (type: AutomationNodeType) => {
    addNode({ type });
    setIsPaletteOpen(false);
  };

  const handleExecuteTest = async (payload: Record<string, any>) => {
    if (!workflow) return null;
    try {
      const res = await testRunMutation.mutateAsync({
        id: workflow.id,
        payload,
      });
      toast.success(`Test execution started (${res.status})`);
      return res;
    } catch (err: any) {
      toast.error(err.message || 'Test run failed');
      return null;
    }
  };

  if (isLoading) {
    return (
      <div className="h-[calc(100vh-3.5rem)] flex items-center justify-center bg-stone-50 text-stone-500">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-amber-600 border-t-transparent" />
          <p className="text-xs font-semibold">Loading Automation Studio...</p>
        </div>
      </div>
    );
  }

  if (error || !workflow) {
    return (
      <div className="h-[calc(100vh-3.5rem)] flex items-center justify-center bg-stone-50 text-stone-700">
        <div className="p-8 rounded-2xl bg-white border border-stone-200 shadow-sm max-w-md text-center space-y-4">
          <h3 className="text-sm font-bold text-stone-900">Automation Not Found</h3>
          <p className="text-xs text-stone-500">The requested automation workflow does not exist or has been deleted.</p>
          <button
            onClick={() => router.push('/automations')}
            className="px-4 py-2 rounded-xl bg-amber-600 text-white text-xs font-semibold hover:bg-amber-700 cursor-pointer"
          >
            Back to Automations
          </button>
        </div>
      </div>
    );
  }

  return (
    <div data-testid="automation-studio-page" className="h-[calc(100vh-3.5rem)] flex flex-col overflow-hidden bg-stone-50">
      {/* Studio Header */}
      <CanvasHeader
        workflow={workflow}
        workflowName={workflowName || workflow.name}
        onNameChange={setWorkflowName}
        status={workflowStatus}
        onStatusToggle={handleStatusToggle}
        isDirty={isDirty}
        isSaving={updateWorkflowMutation.isPending}
        onSave={handleSave}
        onOpenTestRun={() => setIsTestRunOpen(true)}
        onOpenPalette={() => setIsPaletteOpen(true)}
        canUndo={canUndo}
        canRedo={canRedo}
        onUndo={undo}
        onRedo={redo}
      />

      {/* Main Canvas Viewport with Sliding Side Drawers */}
      <div className="relative flex-1 flex overflow-hidden">
        {/* Left Palette Drawer */}
        <NodePaletteDrawer
          isOpen={isPaletteOpen}
          onAddNode={handleAddNodeFromPalette}
          onClose={() => setIsPaletteOpen(false)}
        />

        {/* Central 2D Visual Canvas */}
        <AutomationCanvas
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onSelectNode={(n) => setSelectedNode(n?.id || null)}
          onAddNode={(type, position) => addNode({ type, position })}
        />

        {/* Right Node Inspector Drawer */}
        {selectedNode && (
          <NodeInspectorDrawer
            node={selectedNode as unknown as AutomationNode}
            allNodes={nodes as unknown as AutomationNode[]}
            onUpdate={(id, data) => updateNodeData(id, data)}
            onDelete={(id) => deleteNode(id)}
            onClose={() => setSelectedNode(null)}
          />
        )}

        {/* Test Run Drawer */}
        {isTestRunOpen && (
          <TestRunDrawer
            workflow={workflow}
            onExecuteTest={handleExecuteTest}
            onClose={() => setIsTestRunOpen(false)}
          />
        )}
      </div>
    </div>
  );
}
