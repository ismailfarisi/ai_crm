'use client';

import React, { useState } from 'react';
import {
  X,
  Trash2,
  ShieldAlert,
  Split,
  Timer,
  Webhook,
  Layers,
  Clock,
  MessageSquareText,
  Bot,
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
import { DataField } from './data-field';
import { ConditionBuilder } from './condition-builder';
import { DurationInput } from './duration-input';
import { CrmStepFields } from './crm-step-fields';
import { AiAgentStepFields } from '../agent-step/ai-agent-step-fields';
import { MessageStepFields, NotifyStepFields } from './shop-step-fields';
import { CRM_EVENTS, CRM_EVENT_GROUPS, crmEventOf, findCrmEvent, normalizeCrmEventConfig } from '../crm-events';
import { eventFieldsFor } from '../event-data';
import { availableData, plainStepName, stepWording } from '../step-wording';
import { delayConfig, formatDuration, parseDuration, readDelay } from '../duration';

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
  const [activeTab, setActiveTab] = useState<'params' | 'settings'>('params');
  const [showHelper, setShowHelper] = useState(false);

  if (!node) return null;

  const config = node.data?.config || {};
  const triggerEditor = triggerEditorFor(node.type, workflow?.triggerType);
  const storedEvent = node.type === 'crmEventTrigger' ? crmEventOf(config) : null;
  const unknownEvent = storedEvent && !findCrmEvent(storedEvent) ? storedEvent : null;

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

  // What this step can use from the trigger and the steps before it.
  const data = availableData(node.id, allNodes, edges);

  return (
    <aside
      data-testid="node-inspector-drawer"
      className={clsx(
        'w-96 border-l border-border bg-surface shadow-xl flex flex-col h-full z-40 transition duration-200 select-text',
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
              <MessageSquareText className="h-4 w-4" />
            ) : node.type === 'aiAgentNode' ? (
              <Bot className="h-4 w-4" />
            ) : (
              <Layers className="h-4 w-4" />
            )}
          </div>
          <div className="min-w-0">
            <span className="text-[11px] font-semibold text-ink block truncate">
              {stepWording(node.type)?.kind ?? 'Step'}
            </span>
            <h3 className="text-xs font-semibold text-ink truncate">
              {plainStepName(node.type, node.data?.label)}
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
              title="Delete this step"
              aria-label="Delete this step"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
          <button
            type="button"
            data-testid="close-inspector-btn"
            onClick={onClose}
            className="p-1.5 rounded-lg text-ink-subtle hover:text-ink hover:bg-surface-muted transition-colors cursor-pointer"
            title="Close"
            aria-label="Close"
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
          Set up
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
          If it fails
        </button>
      </div>

      {/* Main Content Body */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {activeTab === 'params' ? (
          <>
            {/* Common Label Field */}
            <div className="space-y-1">
              <label className="text-xs font-medium text-ink">Step name</label>
              <input
                type="text"
                data-testid="node-label-input"
                value={plainStepName(node.type, node.data?.label)}
                onChange={(e) => onUpdate(node.id, { label: e.target.value })}
                placeholder="e.g. Tell the team"
                className="w-full rounded-lg border border-border px-3 py-2 text-xs text-ink focus:border-brand focus:outline-none"
              />
            </div>

            {/* HTTP Request Node Config */}
            {node.type === 'httpRequestNode' && (
              <div className="space-y-3 pt-2 border-t border-border/40">
                <div className="grid grid-cols-3 gap-2">
                  <div className="col-span-1 space-y-1">
                    <label className="text-[11px] font-medium text-ink">Type</label>
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
                  <div className="col-span-2">
                    <DataField
                      label="Web address"
                      testId="http-url-input"
                      groups={data}
                      value={config.url || ''}
                      onChange={(v) => handleConfigChange('url', v)}
                      placeholder="https://example.com/orders"
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-[11px] font-medium text-ink">Data to send (JSON)</label>
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
                    placeholder='{"quote": "{{ $trigger.payload.quoteNumber }}"}'
                    className="w-full rounded-lg border border-border p-2 text-xs font-mono text-ink focus:border-brand focus:outline-none resize-none"
                  />
                </div>
              </div>
            )}

            {/* AI Prompt Node Config */}
            {node.type === 'aiPromptNode' && (
              <div className="space-y-3 pt-2 border-t border-border/40">
                <DataField
                  label="What should the AI write?"
                  icon={<MessageSquareText className="h-3 w-3 text-ink-muted" />}
                  testId="ai-prompt-input"
                  multiline
                  rows={6}
                  groups={data}
                  value={config.prompt || ''}
                  onChange={(v) => handleConfigChange('prompt', v)}
                  placeholder="Write a short, friendly note telling the team this quote was accepted and what to do next."
                  hint="Later steps can use what the AI wrote: pick it from Insert data."
                />
              </div>
            )}

            {/* AI Agent Node Config */}
            {node.type === 'aiAgentNode' && (
              <AiAgentStepFields
                config={config}
                onChange={(next) => onUpdate(node.id, { config: next })}
                showVariables={showHelper}
                onToggleVariables={() => setShowHelper(!showHelper)}
              />
            )}

            {/* Approval Node Config */}
            {node.type === 'approvalNode' && (
              <div className="space-y-3 pt-2 border-t border-border/40">
                <div className="p-3 rounded-xl bg-brand-soft/80 border border-brand/30 text-[11px] text-ink/90 leading-relaxed">
                  The automation pauses here until someone who can approve automations decides. It then follows the
                  <span className="font-semibold text-success"> Approved</span>,
                  <span className="font-semibold text-danger"> Rejected</span> or
                  <span className="font-semibold text-ink"> No answer</span> path.
                </div>

                <DataField
                  label="Message for the approver"
                  testId="approval-message-input"
                  multiline
                  rows={3}
                  groups={data}
                  value={config.message || ''}
                  onChange={(v) => handleConfigChange('message', v)}
                  placeholder="Please approve the follow-up for this quote."
                  hint="Shown in the Approvals inbox."
                />

                <div className="space-y-1">
                  <span className="text-[11px] font-medium text-ink flex items-center gap-1">
                    <Clock className="h-3 w-3 text-ink-muted" />
                    If nobody answers within
                  </span>
                  <DurationInput
                    label="If nobody answers within"
                    testId="approval-timeout-input"
                    units={['hours', 'days', 'weeks']}
                    value={parseDuration(node.data?.timeoutDuration) ?? { amount: 3, unit: 'days' }}
                    onChange={(d) => onUpdate(node.id, { timeoutDuration: formatDuration(d) })}
                  />
                  <p className="text-[11px] text-ink-subtle">Then the automation follows the No answer path.</p>
                </div>
              </div>
            )}

            {/* Condition Node Config */}
            {node.type === 'conditionNode' && (
              <ConditionBuilder
                key={node.id}
                config={config}
                groups={data}
                onChange={(patch) => onUpdate(node.id, { config: { ...config, ...patch } })}
              />
            )}

            {/* Send Email Node Config */}
            {node.type === 'sendEmailNode' && (
              <div className="space-y-3 pt-2 border-t border-border/40">
                <DataField
                  label="Send to"
                  testId="email-to-input"
                  groups={data}
                  value={config.to || ''}
                  onChange={(v) => handleConfigChange('to', v)}
                  placeholder="team@yourworkshop.ae"
                  hint="An email address, or pick the customer's with Insert data. Separate several with commas."
                />
                <DataField
                  label="Subject"
                  testId="email-subject-input"
                  groups={data}
                  value={config.subject || ''}
                  onChange={(v) => handleConfigChange('subject', v)}
                  placeholder="Quote accepted"
                />
                <DataField
                  label="Message"
                  testId="email-body-input"
                  multiline
                  rows={5}
                  groups={data}
                  value={config.body || ''}
                  onChange={(v) => handleConfigChange('body', v)}
                  placeholder="Write the message. Use Insert data to add details such as the quote number."
                />
                {aiHint && (
                  <p data-testid="email-ai-hint" className="text-[11px] text-ink-muted">
                    {aiHint}
                  </p>
                )}
              </div>
            )}

            {/* Delay Node Config */}
            {node.type === 'delayNode' && (
              <div className="space-y-1 pt-2 border-t border-border/40">
                <span className="text-[11px] font-medium text-ink flex items-center gap-1">
                  <Timer className="h-3 w-3 text-ink-muted" />
                  Wait for
                </span>
                <DurationInput
                  label="Wait for"
                  testId="delay-duration-input"
                  value={readDelay(config)}
                  onChange={(d) => onUpdate(node.id, { config: { ...config, ...delayConfig(d) } })}
                />
                <p className="text-[11px] text-ink-subtle">The next step runs once this time has passed.</p>
              </div>
            )}

            {/* CRM Mutate Node Config */}
            {node.type === 'crmMutateNode' && (
              <CrmStepFields
                key={node.id}
                config={config}
                onChange={(next) => onUpdate(node.id, { config: next })}
                groups={data}
              />
            )}

            {/* Send Message / Notify Staff Config */}
            {node.type === 'sendMessageNode' && (
              <MessageStepFields config={config} onChange={(next) => onUpdate(node.id, { config: next })} />
            )}
            {node.type === 'notifyStaffNode' && (
              <NotifyStepFields config={config} onChange={(next) => onUpdate(node.id, { config: next })} />
            )}

            {/* Trigger Nodes (Webhook / Schedule / CRM Event), by the automation's trigger type */}
            {triggerEditor === 'mismatch' && (
              <p data-testid="trigger-type-mismatch" className="pt-2 border-t border-border/40 text-[11px] text-ink-muted">
                This isn&apos;t how this automation was set to start, so it has no settings here.
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
                <label htmlFor={`crm-event-${node.id}`} className="text-[11px] font-medium text-ink">
                  Start when
                </label>
                <select
                  id={`crm-event-${node.id}`}
                  data-testid="crm-event-select"
                  value={storedEvent ?? ''}
                  aria-describedby={unknownEvent ? `crm-event-unknown-${node.id}` : undefined}
                  onChange={(e) =>
                    onUpdate(node.id, {
                      // One field: `event`, which the API reads. A legacy
                      // `eventType` is dropped as soon as the event is set.
                      config: normalizeCrmEventConfig({ ...config, event: e.target.value }),
                    })
                  }
                  className="w-full rounded-lg border border-border-control px-2 py-1.5 text-xs text-ink font-semibold bg-surface-muted"
                >
                  <option value="">Choose an event</option>
                  {unknownEvent && <option value={unknownEvent}>Unknown event: {unknownEvent}</option>}
                  {CRM_EVENT_GROUPS.map((group) => (
                    <optgroup key={group} label={group}>
                      {CRM_EVENTS.filter((ev) => ev.group === group).map((ev) => (
                        <option key={ev.value} value={ev.value}>
                          {ev.label}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
                {eventFieldsFor(storedEvent).length > 0 && (
                  <p data-testid="crm-event-fields" className="text-[11px] text-ink-muted">
                    Later steps can use:{' '}
                    {eventFieldsFor(storedEvent)
                      .filter((f) => !/ ID$/.test(f.label))
                      .map((f) => f.label)
                      .join(', ')}
                    .
                  </p>
                )}
                {unknownEvent && (
                  <p
                    id={`crm-event-unknown-${node.id}`}
                    data-testid="crm-event-unknown"
                    className="rounded-lg border border-warning/20 bg-warning-soft px-2 py-1.5 text-[11px] text-warning"
                  >
                    &quot;{unknownEvent}&quot; is not an event Kerf sends, so this automation may never run. Choose one from the list.
                  </p>
                )}
              </div>
            )}

                      </>
        ) : (
          /* Node Settings Tab */
          <div className="space-y-4">
            <div className="flex items-center justify-between p-3 rounded-lg border border-border bg-surface-muted/60">
              <div>
                <h5 className="text-xs font-semibold text-ink">Carry on if this step fails</h5>
                <p className="text-[11px] text-ink-muted">
                  The steps after it still run. Off: the automation stops here.
                </p>
              </div>
              <input
                type="checkbox"
                data-testid="continue-on-fail-checkbox"
                checked={Boolean(node.data?.continueOnFail)}
                onChange={(e) => onUpdate(node.id, { continueOnFail: e.target.checked })}
                className="h-4 w-4 rounded accent-[var(--color-brand)] cursor-pointer"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium text-ink">Try again</label>
              <input
                type="number"
                min={0}
                max={5}
                data-testid="retry-count-input"
                value={node.data?.retryCount ?? 0}
                onChange={(e) => onUpdate(node.id, { retryCount: parseInt(e.target.value, 10) || 0 })}
                className="w-full rounded-lg border border-border px-3 py-2 text-xs text-ink"
              />
              <p className="text-[11px] text-ink-subtle">
                How many more times to try before giving up, waiting a little longer each time.
              </p>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
