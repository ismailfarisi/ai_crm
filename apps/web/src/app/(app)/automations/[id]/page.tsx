'use client';

import React, { useEffect, useRef, useState, use } from 'react';
import { notFound, useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  useAutomation,
  useUpdateAutomationWorkflow,
  useTestRunAutomation,
  useAutomationSettings,
  useAutomationAgentOptions,
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
import { normalizeDelayNodes } from '@/components/automations/duration';
import { isTriggerType, plainStepName } from '@/components/automations/step-wording';
import { AgentOptionsContext, agentStepsProblem } from '@/components/automations/agent-step/agent-options';
import { useSession } from '@/lib/session-context';
import { AUTOMATION_PERMISSIONS, automationScheduleSchema, describeSchedule } from '@saas/shared';
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
          <p className="text-xs font-semibold">Opening your automation…</p>
        </div>
      </div>
    );
  }

  if (error || !workflow) {
    return (
      <div className="h-[calc(100vh-3.5rem)] flex items-center justify-center bg-surface-muted text-ink">
        <div className="p-8 rounded-2xl bg-surface border border-border shadow-sm max-w-md text-center space-y-4">
          <h3 className="text-sm font-semibold text-ink">Automation not found</h3>
          <p className="text-xs text-ink-muted">This automation doesn’t exist any more, or you don’t have access to it.</p>
          <button
            onClick={() => router.push('/automations')}
            className="px-4 py-2 rounded-xl bg-brand text-on-brand text-xs font-semibold hover:bg-brand-hover cursor-pointer"
          >
            Back to automations
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
  const { data: agentOptions } = useAutomationAgentOptions();

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
  // Set when the chooser was opened from a step's "+": the new step follows that output.
  const [addAfter, setAddAfter] = useState<{ nodeId: string; handle: string | null } | null>(null);
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
    // Older Wait steps carry `delayMinutes`, which the engine never read.
    initialNodes: normalizeDelayNodes(normalizeTriggerNodes(workflow.nodes || [])),
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
    // Keep a trigger edit made while this save was on its way.
    setEditedTriggerConfig((current) => (current === editedTriggerConfig ? null : current));
    setTriggerInvalid(false);
    setSavedName(name);
    refresh?.();
  };

  // Save keeps the status as it is; only Activate / Deactivate changes it.
  const handleSave = async (quiet = false): Promise<boolean> => {
    try {
      await updateWorkflowMutation.mutateAsync({ id: workflow.id, input: editsPayload(), quiet });
      afterEditsSaved();
      return true;
    } catch {
      // The mutation's own toast says what went wrong.
      return false;
    }
  };

  // While the automation is off, changes save themselves a moment after the
  // last edit. A live automation is never autosaved: saving it changes what
  // runs and makes the saver its owner, so that stays a deliberate click.
  const autosave = workflowStatus !== 'ACTIVE' && canEditTrigger;
  const isSaving = updateWorkflowMutation.isPending;
  const editsKey = hasUnsavedChanges ? JSON.stringify(editsPayload()) : null;
  // The edits a failed autosave was for: don't retry (and toast) until they change.
  const failedEditsRef = useRef<string | null>(null);
  const saveRef = useRef(handleSave);
  useEffect(() => {
    saveRef.current = handleSave;
  });
  useEffect(() => {
    if (!autosave || !editsKey || isSaving || triggerInvalid) return;
    if (failedEditsRef.current === editsKey) return;
    const timer = setTimeout(async () => {
      const saved = await saveRef.current(true);
      failedEditsRef.current = saved ? null : editsKey;
    }, 1500);
    return () => clearTimeout(timer);
  }, [autosave, editsKey, isSaving, triggerInvalid]);

  const activating = workflowStatus !== 'ACTIVE';
  const triggerNode = nodes.find((n) => n.type === 'crmEventTrigger');
  const triggerEvent = crmEventOf((triggerNode?.data as { config?: Record<string, unknown> } | undefined)?.config);
  const missingEvent = workflow.triggerType === 'CRM_EVENT' && !triggerEvent;
  // An AI agent step that can't run: no task, or its agent is gone or off.
  const agentStepProblem = agentStepsProblem(nodes as unknown as AutomationNode[], agentOptions);

  const handleStatusChange = async () => {
    if (activating && missingEvent) {
      throw new Error('Choose what starts this automation first: click the first step and pick an event.');
    }
    if (activating && agentStepProblem) throw new Error(agentStepProblem);
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
    : 'It stops running until someone turns it on again.';

  const hasTrigger = nodes.some((n) => isTriggerType(n.type));
  const schedule = automationScheduleSchema.safeParse(triggerConfig.schedule);
  const scheduleSummary = schedule.success ? describeSchedule(schedule.data) : null;
  const afterStep = addAfter ? nodes.find((n) => n.id === addAfter.nodeId) : undefined;

  const openChooser = (after: { nodeId: string; handle: string | null } | null) => {
    setAddAfter(after);
    setIsTestRunOpen(false);
    setIsRunsOpen(false);
    setIsPaletteOpen(true);
  };

  // "Add a step" in the header continues from the last step added that still
  // leads nowhere, so the new step arrives connected instead of loose.
  const lastOpenStep = () => {
    const sources = new Set(edges.map((e) => e.source));
    const open = [...nodes].reverse().find((n) => !sources.has(n.id) && !['conditionNode', 'approvalNode'].includes(n.type ?? ''));
    return open ? { nodeId: open.id, handle: null } : null;
  };

  const handleAddNodeFromPalette = (type: AutomationNodeType) => {
    addNode(afterStep && addAfter ? { type, after: addAfter } : { type });
    setIsPaletteOpen(false);
    setAddAfter(null);
  };

  const handleExecuteTest = async (payload: Record<string, any>) => {
    // A test runs the saved automation, so save what is on the canvas first.
    if (hasUnsavedChanges) {
      if (workflowStatus === 'ACTIVE') {
        toast.info('This test uses the last saved version. Save your changes to test them.');
      } else if (!triggerInvalid && !(await handleSave(true))) {
        return null;
      }
    }
    try {
      const res = await testRunMutation.mutateAsync({
        id: workflow.id,
        payload,
      });
      toast.success('Test started');
      return res;
    } catch (err: any) {
      toast.error(err.message || 'The test could not start');
      return null;
    }
  };

  return (
    <AgentOptionsContext.Provider value={agentOptions}>
    <div data-testid="automation-studio-page" className="h-[calc(100vh-6.5rem)] lg:h-[calc(100vh-7.5rem)] min-h-[28rem] flex flex-col overflow-hidden bg-surface-muted">
      {/* Studio Header */}
      <CanvasHeader
        workflow={workflow}
        workflowName={workflowName || workflow.name}
        onNameChange={setWorkflowName}
        status={workflowStatus}
        onStatusToggle={() => setStatusConfirmOpen(true)}
        statusBlockedReason={triggerInvalid ? 'Fix the schedule before turning this on' : agentStepProblem}
        onBackClick={(event) => {
          if (!hasUnsavedChanges) return;
          event.preventDefault();
          setLeaveConfirmOpen(true);
        }}
        isDirty={hasUnsavedChanges}
        isSaving={isSaving}
        autosave={autosave}
        saveBlockedReason={
          triggerInvalid
            ? 'Fix the schedule before saving'
            : // A draft may be saved unfinished; one that is on may not.
              workflowStatus === 'ACTIVE'
              ? agentStepProblem
              : null
        }
        onSave={() => handleSave()}
        // One side panel at a time, so the canvas keeps its room.
        onOpenTestRun={() => {
          setIsRunsOpen(false);
          setIsPaletteOpen(false);
          setSelectedNode(null);
          setIsTestRunOpen(true);
        }}
        onOpenRuns={() => {
          setIsTestRunOpen(false);
          setIsPaletteOpen(false);
          setSelectedNode(null);
          setIsRunsOpen(true);
        }}
        onOpenPalette={() => openChooser(lastOpenStep())}
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
          onClose={() => {
            setIsPaletteOpen(false);
            setAddAfter(null);
          }}
          hasTrigger={hasTrigger}
          afterStepName={afterStep ? plainStepName(afterStep.type, (afterStep.data as { label?: string }).label) : null}
        />

        {/* Central 2D Visual Canvas */}
        <AutomationCanvas
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onSelectNode={(n) => {
            setSelectedNode(n?.id || null);
            if (n) {
              setIsTestRunOpen(false);
              setIsRunsOpen(false);
            }
          }}
          onAddNode={(type, position) => {
            // A second way to start makes no sense; the chooser doesn't offer one either.
            if (hasTrigger && isTriggerType(type)) return;
            addNode({ type, position });
          }}
          onAddAfter={(nodeId, handle) => openChooser({ nodeId, handle })}
          scheduleSummary={scheduleSummary}
        />

        {nodes.length === 0 && !isPaletteOpen && (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
            <button
              type="button"
              data-testid="empty-canvas-start-btn"
              onClick={() => openChooser(null)}
              className="pointer-events-auto rounded-2xl border border-dashed border-border-strong bg-surface px-6 py-5 text-center shadow-sm hover:border-brand cursor-pointer"
            >
              <span className="block text-sm font-semibold text-ink">Choose what starts this automation</span>
              <span className="mt-1 block text-xs text-ink-muted">For example: when a customer accepts a quote</span>
            </button>
          </div>
        )}

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
            triggerEvent={triggerEvent}
            nodes={nodes as unknown as AutomationNode[]}
            hasUnsavedChanges={hasUnsavedChanges && workflowStatus === 'ACTIVE'}
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
        title={`Turn ${activating ? 'on' : 'off'} “${name}”?`}
        description={
          hasUnsavedChanges ? `${statusDescription} Your unsaved changes are saved with it.` : statusDescription
        }
        confirmLabel={activating ? 'Turn it on' : 'Turn it off'}
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
    </AgentOptionsContext.Provider>
  );
}
