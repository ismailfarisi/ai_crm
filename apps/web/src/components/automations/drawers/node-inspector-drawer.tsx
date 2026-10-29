'use client';

import React, { useState } from 'react';
import {
  X,
  Trash2,
  Sparkles,
  Globe,
  Mail,
  ShieldAlert,
  Split,
  Timer,
  Database,
  Code,
  Webhook,
  Calendar,
  Layers,
  HelpCircle,
  Clock,
  Play,
  RotateCcw,
  CheckCircle2,
} from 'lucide-react';
import clsx from 'clsx';
import { usesAiOutput } from '@saas/shared';
import type {
  AutomationEdge,
  AutomationNode,
  AutomationTriggerType,
  AutomationWorkflowDto,
  ScheduleTriggerConfig,
  WebhookTriggerConfig,
} from '@saas/shared';
import { WebhookTriggerFields } from './webhook-trigger-fields';
import { ScheduleTriggerFields } from './schedule-trigger-fields';
import { ExpressionHelper } from './expression-helper';
import { CrmStepFields } from './crm-step-fields';

const CRM_EVENTS = [
  { value: 'contact.created', label: 'Contact created' },
  { value: 'contact.updated', label: 'Contact updated' },
  { value: 'quote.created', label: 'Quote created' },
  { value: 'quote.updated', label: 'Quote updated' },
  { value: 'quote.accepted', label: 'Customer accepted a quote' },
  { value: 'invoice.issued', label: 'Invoice issued' },
  { value: 'invoice.overdue', label: 'Invoice overdue' },
];

/** The trigger node that belongs to each automation trigger type. */
const TRIGGER_NODE_TYPE: Record<AutomationTriggerType, string> = {
  WEBHOOK: 'webhookTrigger',
  SCHEDULE: 'scheduleTrigger',
  CRM_EVENT: 'crmEventTrigger',
  MANUAL: 'manualTrigger',
};

/**
 * Which trigger editor a node gets. The automation's trigger type decides
 * (its trigger settings are workflow-level); a trigger node of another type
 * gets a note instead. Without the workflow, the node's own type decides.
 */
function triggerEditorFor(
  nodeType: string,
  workflowTriggerType: AutomationTriggerType | undefined,
): AutomationTriggerType | 'mismatch' | null {
  const own = (Object.keys(TRIGGER_NODE_TYPE) as AutomationTriggerType[]).find(
    (t) => TRIGGER_NODE_TYPE[t] === nodeType,
  );
  if (!own) return null;
  if (!workflowTriggerType) return own;
  return own === workflowTriggerType ? workflowTriggerType : 'mismatch';
}

export interface NodeInspectorDrawerProps {
  node: AutomationNode | null;
  allNodes?: AutomationNode[];
  edges?: AutomationEdge[];
  /** Org setting; undefined while it loads. */
  aiEmailToCustomers?: boolean;
  onUpdate: (nodeId: string, data: Partial<AutomationNode['data']>) => void;
  onDelete?: (nodeId: string) => void;
  onClose: () => void;
  samplePayload?: Record<string, any>;
  className?: string;
  /** Workflow-level trigger settings; the trigger editors write here, not to node config. */
  workflow?: Pick<AutomationWorkflowDto, 'status' | 'webhookSlug'> &
    Partial<Pick<AutomationWorkflowDto, 'triggerType'>>;
  triggerConfig?: WebhookTriggerConfig & ScheduleTriggerConfig;
  canEditTrigger?: boolean;
  onTriggerConfigChange?: (config: Record<string, any>) => void;
  onRegenerateWebhook?: () => void | Promise<unknown>;
  onTriggerValidityChange?: (valid: boolean) => void;
}

export function NodeInspectorDrawer({
  node,
  allNodes = [],
  edges = [],
  aiEmailToCustomers,
  onUpdate,
  onDelete,
  onClose,
  samplePayload,
  className,
  workflow,
  triggerConfig,
  canEditTrigger,
  onTriggerConfigChange,
  onRegenerateWebhook,
  onTriggerValidityChange,
}: NodeInspectorDrawerProps) {
  const [showHelper, setShowHelper] = useState(false);
  const [activeTab, setActiveTab] = useState<'params' | 'settings'>('params');

  if (!node) return null;

  const config = node.data?.config || {};
  const triggerEditor = triggerEditorFor(node.type, workflow?.triggerType);

  const aiHint =
    node.type === 'sendEmailNode' &&
    aiEmailToCustomers !== undefined &&
    usesAiOutput(node, allNodes, edges)
      ? aiEmailToCustomers
        ? 'Uses AI-written text — can be sent to customers'
        : 'Uses AI-written text — only people with a login here can receive it'
      : null;

  const handleConfigChange = (key: string, value: any) => {
    onUpdate(node.id, {
      config: {
        ...config,
        [key]: value,
      },
    });
  };

  const handleVariableInsert = (variableCode: string) => {
    // If prompt or url or condition is focused, user can insert variable
    if (node.type === 'aiPromptNode') {
      const current = config.prompt || '';
      handleConfigChange('prompt', `${current} ${variableCode}`.trim());
    } else if (node.type === 'httpRequestNode') {
      const current = config.url || '';
      handleConfigChange('url', `${current}${variableCode}`);
    } else if (node.type === 'conditionNode') {
      const current = config.condition || '';
      handleConfigChange('condition', `${current} ${variableCode}`.trim());
    } else if (node.type === 'approvalNode') {
      const current = config.message || '';
      handleConfigChange('message', `${current} ${variableCode}`.trim());
    } else if (node.type === 'sendEmailNode') {
      const current = config.body || '';
      handleConfigChange('body', `${current} ${variableCode}`.trim());
    }
  };

  return (
    <aside
      data-testid="node-inspector-drawer"
      className={clsx(
        'w-96 border-l border-border bg-surface shadow-xl flex flex-col h-full z-40 transition-all duration-200 select-text',
        className,
      )}
    >
      {/* Drawer Header */}
      <div className="flex items-center justify-between p-4 border-b border-border/40 bg-surface-muted/50">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-soft text-ink">
            {node.type.includes('Trigger') ? (
              <Webhook className="h-4 w-4" />
            ) : node.type === 'conditionNode' ? (
              <Split className="h-4 w-4" />
            ) : node.type === 'approvalNode' ? (
              <ShieldAlert className="h-4 w-4" />
            ) : node.type === 'aiPromptNode' ? (
              <Sparkles className="h-4 w-4" />
            ) : (
              <Layers className="h-4 w-4" />
            )}
          </div>
          <div className="min-w-0">
            <span className="text-[10px] font-bold uppercase tracking-wider text-ink block truncate">
              {node.type}
            </span>
            <h3 className="text-xs font-semibold text-ink truncate">
              {node.data?.label || 'Node Configuration'}
            </h3>
          </div>
        </div>

        <div className="flex items-center gap-1">
          {onDelete && (
            <button
              type="button"
              data-testid="delete-node-btn"
              onClick={() => onDelete(node.id)}
              className="p-1.5 rounded-lg text-ink-subtle hover:text-danger hover:bg-danger-soft transition-colors cursor-pointer"
              title="Delete Node"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
          <button
            type="button"
            data-testid="close-inspector-btn"
            onClick={onClose}
            className="p-1.5 rounded-lg text-ink-subtle hover:text-ink hover:bg-surface-muted transition-colors cursor-pointer"
            title="Close Drawer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="flex items-center border-b border-border px-4 pt-1 bg-surface">
        <button
          type="button"
          data-testid="inspector-tab-params"
          onClick={() => setActiveTab('params')}
          className={clsx(
            'px-3 py-2 text-xs font-semibold border-b-2 transition-colors cursor-pointer',
            activeTab === 'params'
              ? 'border-brand text-ink'
              : 'border-transparent text-ink-muted hover:text-ink',
          )}
        >
          Parameters
        </button>
        <button
          type="button"
          data-testid="inspector-tab-settings"
          onClick={() => setActiveTab('settings')}
          className={clsx(
            'px-3 py-2 text-xs font-semibold border-b-2 transition-colors cursor-pointer',
            activeTab === 'settings'
              ? 'border-brand text-ink'
              : 'border-transparent text-ink-muted hover:text-ink',
          )}
        >
          Node Settings
        </button>
      </div>

      {/* Main Content Body */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {activeTab === 'params' ? (
          <>
            {/* Common Label Field */}
            <div className="space-y-1">
              <label className="text-xs font-medium text-ink">Display Label</label>
              <input
                type="text"
                data-testid="node-label-input"
                value={node.data?.label || ''}
                onChange={(e) => onUpdate(node.id, { label: e.target.value })}
                placeholder="e.g. Generate AI Quotation"
                className="w-full rounded-lg border border-border px-3 py-2 text-xs text-ink focus:border-brand focus:outline-none"
              />
            </div>

            {/* HTTP Request Node Config */}
            {node.type === 'httpRequestNode' && (
              <div className="space-y-3 pt-2 border-t border-border/40">
                <div className="grid grid-cols-3 gap-2">
                  <div className="col-span-1 space-y-1">
                    <label className="text-[11px] font-medium text-ink">Method</label>
                    <select
                      data-testid="http-method-select"
                      value={config.method || 'GET'}
                      onChange={(e) => handleConfigChange('method', e.target.value)}
                      className="w-full rounded-lg border border-border px-2 py-1.5 text-xs text-ink font-semibold bg-surface-muted"
                    >
                      <option value="GET">GET</option>
                      <option value="POST">POST</option>
                      <option value="PUT">PUT</option>
                      <option value="PATCH">PATCH</option>
                      <option value="DELETE">DELETE</option>
                    </select>
                  </div>
                  <div className="col-span-2 space-y-1">
                    <label className="text-[11px] font-medium text-ink">URL Endpoint</label>
                    <input
                      type="text"
                      data-testid="http-url-input"
                      value={config.url || ''}
                      onChange={(e) => handleConfigChange('url', e.target.value)}
                      placeholder="https://api.example.com/v1/resource"
                      className="w-full rounded-lg border border-border px-3 py-1.5 text-xs font-mono text-ink focus:border-brand focus:outline-none"
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-[11px] font-medium text-ink">JSON Body Payload</label>
                  <textarea
                    rows={3}
                    data-testid="http-body-input"
                    value={typeof config.body === 'object' ? JSON.stringify(config.body, null, 2) : config.body || ''}
                    onChange={(e) => {
                      try {
                        const parsed = JSON.parse(e.target.value);
                        handleConfigChange('body', parsed);
                      } catch {
                        handleConfigChange('body', e.target.value);
                      }
                    }}
                    placeholder='{"key": "{{ $json.id }}"}'
                    className="w-full rounded-lg border border-border p-2 text-xs font-mono text-ink focus:border-brand focus:outline-none resize-none"
                  />
                </div>
              </div>
            )}

            {/* AI Prompt Node Config */}
            {node.type === 'aiPromptNode' && (
              <div className="space-y-3 pt-2 border-t border-border/40">
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <label className="text-[11px] font-medium text-ink flex items-center gap-1">
                      <Sparkles className="h-3 w-3 text-brand" />
                      LLM Prompt Template
                    </label>
                    <button
                      type="button"
                      data-testid="toggle-expression-helper-btn"
                      onClick={() => setShowHelper(!showHelper)}
                      className="text-[10px] text-ink font-semibold hover:underline cursor-pointer"
                    >
                      {showHelper ? 'Hide Variables' : 'Show Variables'}
                    </button>
                  </div>
                  <textarea
                    rows={6}
                    data-testid="ai-prompt-input"
                    value={config.prompt || ''}
                    onChange={(e) => handleConfigChange('prompt', e.target.value)}
                    placeholder="Analyze quote {{ $trigger.payload.quoteNumber }} for customer {{ $json.name }} and generate line items..."
                    className="w-full rounded-lg border border-border p-2.5 text-xs font-mono text-ink focus:border-brand focus:outline-none resize-none leading-relaxed"
                  />
                </div>
              </div>
            )}

            {/* Approval Node Config */}
            {node.type === 'approvalNode' && (
              <div className="space-y-3 pt-2 border-t border-border/40">
                <div className="p-3 rounded-xl bg-brand-soft/80 border border-brand/30 text-xs text-ink space-y-1">
                  <div className="flex items-center gap-1.5 font-semibold">
                    <ShieldAlert className="h-3.5 w-3.5 text-ink" />
                    Human-in-the-Loop Approval Gate
                  </div>
                  <p className="text-[11px] text-ink/90 leading-relaxed">
                    Workflow pauses awaiting a decision from anyone who can approve automations. Exposes 3 outbound branch handles:
                    <span className="font-semibold text-success"> Approved</span>,
                    <span className="font-semibold text-danger"> Rejected</span>, and
                    <span className="font-semibold text-ink"> Timeout</span>.
                  </p>
                </div>

                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <label className="text-[11px] font-medium text-ink">Message for the approver</label>
                    <button
                      type="button"
                      onClick={() => setShowHelper(!showHelper)}
                      className="text-[10px] text-ink font-semibold hover:underline cursor-pointer"
                    >
                      {showHelper ? 'Hide Variables' : 'Show Variables'}
                    </button>
                  </div>
                  <textarea
                    rows={3}
                    data-testid="approval-message-input"
                    value={config.message || ''}
                    onChange={(e) => handleConfigChange('message', e.target.value)}
                    className="w-full rounded-lg border border-border p-2 text-xs text-ink focus:border-brand focus:outline-none resize-none"
                  />
                  <p className="text-[10px] text-ink-subtle">
                    Shown in the Approvals inbox. You can use {'{{ }}'} expressions, e.g. {'{{ $trigger.payload.name }}'}.
                  </p>
                </div>

                <div className="space-y-1">
                  <label className="text-[11px] font-medium text-ink flex items-center gap-1">
                    <Clock className="h-3 w-3 text-ink-muted" />
                    Timeout / SLA Escalation Duration
                  </label>
                  <input
                    type="text"
                    data-testid="approval-timeout-input"
                    value={node.data?.timeoutDuration || '3 days'}
                    onChange={(e) => onUpdate(node.id, { timeoutDuration: e.target.value })}
                    placeholder="e.g. 24 hours, 3 days, 1 week"
                    className="w-full rounded-lg border border-border px-3 py-2 text-xs font-mono text-ink focus:border-brand focus:outline-none"
                  />
                  <p className="text-[10px] text-ink-subtle">
                    If no action is taken within this duration, flow routes along the Timeout branch.
                  </p>
                </div>
              </div>
            )}

            {/* Condition Node Config */}
            {node.type === 'conditionNode' && (
              <div className="space-y-3 pt-2 border-t border-border/40">
                <div className="space-y-1">
                  <label className="text-[11px] font-medium text-ink">
                    JavaScript / Expression Condition
                  </label>
                  <input
                    type="text"
                    data-testid="condition-expression-input"
                    value={config.condition || ''}
                    onChange={(e) => handleConfigChange('condition', e.target.value)}
                    placeholder="e.g. $json.amount > 10000 && $json.status === 'ACTIVE'"
                    className="w-full rounded-lg border border-border px-3 py-2 text-xs font-mono text-ink focus:border-brand focus:outline-none"
                  />
                  <p className="text-[10px] text-ink-subtle">
                    Routes to TRUE handle if truthy; otherwise routes to FALSE handle.
                  </p>
                </div>
              </div>
            )}

            {/* Send Email Node Config */}
            {node.type === 'sendEmailNode' && (
              <div className="space-y-3 pt-2 border-t border-border/40">
                <div className="space-y-1">
                  <label className="text-[11px] font-medium text-ink">Recipient Email (To)</label>
                  <input
                    type="text"
                    data-testid="email-to-input"
                    value={config.to || ''}
                    onChange={(e) => handleConfigChange('to', e.target.value)}
                    placeholder="{{ $json.email }} or owner@company.com"
                    className="w-full rounded-lg border border-border px-3 py-1.5 text-xs font-mono text-ink focus:border-brand focus:outline-none"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] font-medium text-ink">Subject</label>
                  <input
                    type="text"
                    data-testid="email-subject-input"
                    value={config.subject || ''}
                    onChange={(e) => handleConfigChange('subject', e.target.value)}
                    placeholder="Quotation {{ $trigger.payload.quoteNumber }} Ready"
                    className="w-full rounded-lg border border-border px-3 py-1.5 text-xs text-ink focus:border-brand focus:outline-none"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] font-medium text-ink">Body Content</label>
                  <textarea
                    rows={4}
                    data-testid="email-body-input"
                    value={config.body || ''}
                    onChange={(e) => handleConfigChange('body', e.target.value)}
                    placeholder="Hello {{ $json.name }}, your quote total is ${{ $json.amount }}."
                    className="w-full rounded-lg border border-border p-2 text-xs font-mono text-ink focus:border-brand focus:outline-none resize-none"
                  />
                  {aiHint && (
                    <p data-testid="email-ai-hint" className="text-[10px] text-ink-muted">
                      {aiHint}
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* Delay Node Config */}
            {node.type === 'delayNode' && (
              <div className="space-y-3 pt-2 border-t border-border/40">
                <div className="space-y-1">
                  <label className="text-[11px] font-medium text-ink flex items-center gap-1">
                    <Timer className="h-3 w-3 text-ink-muted" />
                    Sleep Delay (Milliseconds or Duration)
                  </label>
                  <input
                    type="text"
                    data-testid="delay-duration-input"
                    value={config.durationMs || '5000'}
                    onChange={(e) => handleConfigChange('durationMs', e.target.value)}
                    placeholder="5000 (ms)"
                    className="w-full rounded-lg border border-border px-3 py-2 text-xs font-mono text-ink focus:border-brand focus:outline-none"
                  />
                </div>
              </div>
            )}

            {/* CRM Mutate Node Config */}
            {node.type === 'crmMutateNode' && (
              <CrmStepFields
                key={node.id}
                config={config}
                onChange={(next) => onUpdate(node.id, { config: next })}
              />
            )}

            {/* Trigger Nodes (Webhook / Schedule / CRM Event), by the automation's trigger type */}
            {triggerEditor === 'mismatch' && (
              <p data-testid="trigger-type-mismatch" className="pt-2 border-t border-border/40 text-[11px] text-ink-muted">
                This trigger doesn&apos;t match the automation&apos;s trigger type.
              </p>
            )}

            {triggerEditor === 'WEBHOOK' && workflow && (
              <>
                <WebhookTriggerFields
                  workflow={workflow}
                  config={triggerConfig ?? {}}
                  onChange={(next) => onTriggerConfigChange?.(next)}
                  onRegenerate={canEditTrigger ? onRegenerateWebhook : undefined}
                />
              </>
            )}

            {triggerEditor === 'SCHEDULE' && (
              <>
                <ScheduleTriggerFields
                  key={node.id}
                  canEdit={canEditTrigger}
                  onValidityChange={onTriggerValidityChange}
                  schedule={(triggerConfig as ScheduleTriggerConfig | undefined)?.schedule}
                  onChange={(schedule) => onTriggerConfigChange?.({ ...(triggerConfig ?? {}), schedule })}
                />
              </>
            )}

            {triggerEditor === 'CRM_EVENT' && (
              <div className="space-y-2 pt-2 border-t border-border/40">
                <label className="text-[11px] font-medium text-ink">CRM Event Trigger</label>
                <select
                  data-testid="crm-event-select"
                  value={config.event || ''}
                  onChange={(e) => handleConfigChange('event', e.target.value)}
                  className="w-full rounded-lg border border-border px-2 py-1.5 text-xs text-ink font-semibold bg-surface-muted"
                >
                  <option value="">Choose an event</option>
                  {CRM_EVENTS.map((ev) => (
                    <option key={ev.value} value={ev.value}>
                      {ev.label}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Embedded Expression Helper */}
            {showHelper && (
              <div className="pt-3 border-t border-border/40">
                <ExpressionHelper
                  allNodes={allNodes}
                  samplePayload={samplePayload}
                  onSelectVariable={handleVariableInsert}
                />
              </div>
            )}
          </>
        ) : (
          /* Node Settings Tab */
          <div className="space-y-4">
            <div className="flex items-center justify-between p-3 rounded-lg border border-border bg-surface-muted/60">
              <div>
                <h5 className="text-xs font-semibold text-ink">Continue on Fail</h5>
                <p className="text-[10px] text-ink-muted">
                  Keep executing subsequent nodes if this node errors.
                </p>
              </div>
              <input
                type="checkbox"
                data-testid="continue-on-fail-checkbox"
                checked={Boolean(node.data?.continueOnFail)}
                onChange={(e) => onUpdate(node.id, { continueOnFail: e.target.checked })}
                className="h-4 w-4 rounded text-brand focus:ring-brand cursor-pointer"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium text-ink">Retry Attempts</label>
              <input
                type="number"
                min={0}
                max={5}
                data-testid="retry-count-input"
                value={node.data?.retryCount ?? 0}
                onChange={(e) => onUpdate(node.id, { retryCount: parseInt(e.target.value, 10) || 0 })}
                className="w-full rounded-lg border border-border px-3 py-2 text-xs text-ink"
              />
              <p className="text-[10px] text-ink-subtle">
                Number of automatic retries with exponential backoff on failure.
              </p>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
