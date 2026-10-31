'use client';

import React, { useEffect, useState, use } from 'react';
import { notFound, useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  useAutomation,
  useUpdateAutomationWorkflow,
  useTestRunAutomation,
  useAutomationSettings,
  useRegenerateAutomationWebhook,
} from '@/hooks/use-automations';
import { useAutomationCanvas, toAutomationEdges } from '@/hooks/use-automation-canvas';
import { AutomationCanvas } from '@/components/automations/canvas/automation-canvas';
import { CanvasHeader } from '@/components/automations/canvas/canvas-header';
import { NodePaletteDrawer } from '@/components/automations/drawers/node-palette-drawer';
import { NodeInspectorDrawer } from '@/components/automations/drawers/node-inspector-drawer';
import { TestRunDrawer } from '@/components/automations/drawers/test-run-drawer';
import { RunsDrawer } from '@/components/automations/runs/runs-drawer';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { crmEventOf, normalizeTriggerNodes, runsWhenPhrase } from '@/components/automations/crm-events';
import { useSession } from '@/lib/session-context';
import { AUTOMATION_PERMISSIONS } from '@saas/shared';
import type { AutomationNodeType, AutomationNode, AutomationWorkflowDto } from '@saas/shared';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default function AutomationStudioPage({ params }: PageProps) {
  const { id } = use(params);
  const router = useRouter();

  const { data: workflow, isLoading, error, refresh } = useAutomation(id);

  if (isLoading) {
    return (
      <div className="h-[calc(100vh-3.5rem)] flex items-center justify-center bg-surface-muted text-ink-muted">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-brand border-t-transparent" />
          <p className="text-xs font-semibold">Loading Automation Studio...</p>
        </div>
      </div>
    );
  }

  if (error || !workflow) {
    return (
      <div className="h-[calc(100vh-3.5rem)] flex items-center justify-center bg-surface-muted text-ink">
        <div className="p-8 rounded-2xl bg-surface border border-border shadow-sm max-w-md text-center space-y-4">
          <h3 className="text-sm font-semibold text-ink">Automation Not Found</h3>
          <p className="text-xs text-ink-muted">The requested automation workflow does not exist or has been deleted.</p>
          <button
            onClick={() => router.push('/automations')}
            className="px-4 py-2 rounded-xl bg-brand text-on-brand text-xs font-semibold hover:bg-brand-hover cursor-pointer"
          >
            Back to Automations
          </button>
        </div>
      </div>
    );
  }

  // The canvas seeds its state from the saved graph when it mounts, so it must
  // not mount until the workflow has loaded: mounted early it starts empty, and
  // saving that empty canvas would overwrite the stored graph.
  return <AutomationStudio key={workflow.id} workflow={workflow} refresh={refresh} />;
}

// The server keeps the secret it already has; never echo it back.
// `regenerateSignature` is transient: it travels beside triggerConfig, never inside it.
function triggerPatch(config: Record<string, any>) {
  const { signatureSecret: _secret, regenerateSignature, ...rest } = config;
  return { triggerConfig: rest, ...(regenerateSignature ? { regenerateSignature: true } : {}) };
}

interface AutomationStudioProps {
  workflow: AutomationWorkflowDto;
  refresh?: () => unknown;
}

function AutomationStudio({ workflow, refresh }: AutomationStudioProps) {
  const router = useRouter();
  const updateWorkflowMutation = useUpdateAutomationWorkflow();
  const testRunMutation = useTestRunAutomation();
  const regenerateWebhook = useRegenerateAutomationWebhook();
  const { can } = useSession();
  const canEditTrigger = can(AUTOMATION_PERMISSIONS.AUTOMATION_UPDATE);
  const { data: settings } = useAutomationSettings();

  const [workflowName, setWorkflowName] = useState<string>(workflow.name);
  const [savedName, setSavedName] = useState<string>(workflow.name);
  // The saved status. It changes only through the confirmed Activate /
  // Deactivate action, which saves at once: never a pending local toggle
  // that looks done but isn't.
  const [workflowStatus, setWorkflowStatus] = useState<'DRAFT' | 'ACTIVE' | 'PAUSED'>(workflow.status);
  const [statusConfirmOpen, setStatusConfirmOpen] = useState(false);
  const [leaveConfirmOpen, setLeaveConfirmOpen] = useState(false);

  // Workflow-level trigger settings edited since the last save. Null means untouched, and
  // an untouched trigger is never sent: the API treats any triggerConfig on an ACTIVE
  // automation as a graph change and makes the saver the owner.
  const [editedTriggerConfig, setEditedTriggerConfig] = useState<Record<string, any> | null>(null);
  const [triggerInvalid, setTriggerInvalid] = useState(false);
  const triggerConfig = editedTriggerConfig ?? workflow.triggerConfig ?? {};

  // Drawers visibility states
  const [isPaletteOpen, setIsPaletteOpen] = useState(false);
  const [isTestRunOpen, setIsTestRunOpen] = useState(false);
  const [isRunsOpen, setIsRunsOpen] = useState(false);

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
    // Older trigger nodes carry their event as `eventType`; read it as `event`.
    initialNodes: normalizeTriggerNodes(workflow.nodes || []),
    initialEdges: workflow.edges || [],
  });

  const name = workflowName || workflow.name;
  const hasUnsavedChanges = isDirty || editedTriggerConfig !== null || name !== savedName;

  // Leaving the tab with unsaved changes asks first, as Back does.
  useEffect(() => {
    if (!hasUnsavedChanges) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [hasUnsavedChanges]);

  const editsPayload = () => {
    const graphPayload = getGraphPayload();
    return {
      name,
      nodes: normalizeTriggerNodes(graphPayload.nodes),
      edges: graphPayload.edges,
      ...(editedTriggerConfig ? triggerPatch(editedTriggerConfig) : {}),
    };
  };

  const afterEditsSaved = () => {
    markClean();
    setEditedTriggerConfig(null);
    setTriggerInvalid(false);
    setSavedName(name);
    refresh?.();
  };

  // Save keeps the status as it is; only Activate / Deactivate changes it.
  const handleSave = async () => {
    try {
      await updateWorkflowMutation.mutateAsync({ id: workflow.id, input: editsPayload() });
      afterEditsSaved();
    } catch {
      // The mutation's own toast says what went wrong.
    }
  };

  const activating = workflowStatus !== 'ACTIVE';
  const triggerNode = nodes.find((n) => n.type === 'crmEventTrigger');
  const triggerEvent = crmEventOf((triggerNode?.data as { config?: Record<string, unknown> } | undefined)?.config);
  const missingEvent = workflow.triggerType === 'CRM_EVENT' && !triggerEvent;

  const handleStatusChange = async () => {
    if (activating && missingEvent) {
      throw new Error('Choose the CRM event that starts this automation first: open the trigger and pick one.');
    }
    const nextStatus = activating ? 'ACTIVE' : 'PAUSED';
    const saved = await updateWorkflowMutation.mutateAsync({
      id: workflow.id,
      // Unsaved edits go with it, so what runs is what is on the canvas.
      input: hasUnsavedChanges ? { ...editsPayload(), status: nextStatus } : { status: nextStatus },
    });
    if (hasUnsavedChanges) afterEditsSaved();
    else refresh?.();
    setWorkflowStatus(saved?.status ?? nextStatus);
  };

  const statusDescription = activating
    ? `It runs ${runsWhenPhrase(workflow.triggerType, triggerEvent)}. Its steps run with your permissions.`
    : 'It stops running until someone activates it again.';

  const handleAddNodeFromPalette = (type: AutomationNodeType) => {
    addNode({ type });
    setIsPaletteOpen(false);
  };

  const handleExecuteTest = async (payload: Record<string, any>) => {
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

  return (
    <div data-testid="automation-studio-page" className="h-[calc(100vh-3.5rem)] flex flex-col overflow-hidden bg-surface-muted">
      {/* Studio Header */}
      <CanvasHeader
        workflow={workflow}
        workflowName={workflowName || workflow.name}
        onNameChange={setWorkflowName}
        status={workflowStatus}
        onStatusToggle={() => setStatusConfirmOpen(true)}
        statusBlockedReason={triggerInvalid ? 'Fix the schedule before activating' : null}
        onBackClick={(event) => {
          if (!hasUnsavedChanges) return;
          event.preventDefault();
          setLeaveConfirmOpen(true);
        }}
        isDirty={hasUnsavedChanges}
        isSaving={updateWorkflowMutation.isPending}
        saveBlockedReason={triggerInvalid ? 'Fix the schedule before saving' : null}
        onSave={handleSave}
        onOpenTestRun={() => {
          setIsRunsOpen(false);
          setIsTestRunOpen(true);
        }}
        onOpenRuns={() => {
          setIsTestRunOpen(false);
          setIsRunsOpen(true);
        }}
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
            edges={toAutomationEdges(edges)}
            aiEmailToCustomers={settings?.aiEmailToCustomers}
            workflow={workflow}
            triggerConfig={triggerConfig}
            canEditTrigger={canEditTrigger}
            onTriggerConfigChange={setEditedTriggerConfig}
            onTriggerValidityChange={(valid) => setTriggerInvalid(!valid)}
            onRegenerateWebhook={() => regenerateWebhook.mutateAsync(workflow.id)}
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
            onGetExecution={testRunMutation.getExecution}
            onClose={() => setIsTestRunOpen(false)}
          />
        )}

        {/* Runs Drawer */}
        {isRunsOpen && <RunsDrawer workflowId={workflow.id} onClose={() => setIsRunsOpen(false)} />}
      </div>

      <ConfirmDialog
        open={statusConfirmOpen}
        onClose={() => setStatusConfirmOpen(false)}
        onConfirm={handleStatusChange}
        title={`${activating ? 'Activate' : 'Deactivate'} “${name}”?`}
        description={
          hasUnsavedChanges ? `${statusDescription} Your unsaved changes are saved with it.` : statusDescription
        }
        confirmLabel={activating ? 'Activate automation' : 'Deactivate automation'}
        tone={activating ? 'primary' : 'danger'}
      />

      <ConfirmDialog
        open={leaveConfirmOpen}
        onClose={() => setLeaveConfirmOpen(false)}
        onConfirm={() => router.push('/automations')}
        title="Leave without saving?"
        description={`Your changes to “${name}” since the last save will be lost.`}
        confirmLabel="Leave without saving"
        tone="danger"
      />
    </div>
  );
}
