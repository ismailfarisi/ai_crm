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
import type { AutomationNode } from '@saas/shared';
import { ExpressionHelper } from './expression-helper';

export interface NodeInspectorDrawerProps {
  node: AutomationNode | null;
  allNodes?: AutomationNode[];
  onUpdate: (nodeId: string, data: Partial<AutomationNode['data']>) => void;
  onDelete?: (nodeId: string) => void;
  onClose: () => void;
  samplePayload?: Record<string, any>;
  className?: string;
}

export function NodeInspectorDrawer({
  node,
  allNodes = [],
  onUpdate,
  onDelete,
  onClose,
  samplePayload,
  className,
}: NodeInspectorDrawerProps) {
  const [showHelper, setShowHelper] = useState(false);
  const [activeTab, setActiveTab] = useState<'params' | 'settings'>('params');

  if (!node) return null;

  const config = node.data?.config || {};

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
    } else if (node.type === 'sendEmailNode') {
      const current = config.body || '';
      handleConfigChange('body', `${current} ${variableCode}`.trim());
    }
  };

  return (
    <aside
      data-testid="node-inspector-drawer"
      className={clsx(
        'w-96 border-l border-stone-200 bg-white shadow-xl flex flex-col h-full z-40 transition-all duration-200 select-text',
        className,
      )}
    >
      {/* Drawer Header */}
      <div className="flex items-center justify-between p-4 border-b border-stone-100 bg-stone-50/50">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-800">
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
            <span className="text-[10px] font-bold uppercase tracking-wider text-amber-700 block truncate">
              {node.type}
            </span>
            <h3 className="text-xs font-semibold text-stone-900 truncate">
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
              className="p-1.5 rounded-lg text-stone-400 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
              title="Delete Node"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
          <button
            type="button"
            data-testid="close-inspector-btn"
            onClick={onClose}
            className="p-1.5 rounded-lg text-stone-400 hover:text-stone-700 hover:bg-stone-100 transition-colors cursor-pointer"
            title="Close Drawer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="flex items-center border-b border-stone-200 px-4 pt-1 bg-white">
        <button
          type="button"
          data-testid="inspector-tab-params"
          onClick={() => setActiveTab('params')}
          className={clsx(
            'px-3 py-2 text-xs font-semibold border-b-2 transition-colors cursor-pointer',
            activeTab === 'params'
              ? 'border-amber-600 text-amber-900'
              : 'border-transparent text-stone-500 hover:text-stone-800',
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
              ? 'border-amber-600 text-amber-900'
              : 'border-transparent text-stone-500 hover:text-stone-800',
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
              <label className="text-xs font-medium text-stone-700">Display Label</label>
              <input
                type="text"
                data-testid="node-label-input"
                value={node.data?.label || ''}
                onChange={(e) => onUpdate(node.id, { label: e.target.value })}
                placeholder="e.g. Generate AI Quotation"
                className="w-full rounded-lg border border-stone-200 px-3 py-2 text-xs text-stone-900 focus:border-amber-500 focus:outline-none"
              />
            </div>

            {/* HTTP Request Node Config */}
            {node.type === 'httpRequestNode' && (
              <div className="space-y-3 pt-2 border-t border-stone-100">
                <div className="grid grid-cols-3 gap-2">
                  <div className="col-span-1 space-y-1">
                    <label className="text-[11px] font-medium text-stone-700">Method</label>
                    <select
                      data-testid="http-method-select"
                      value={config.method || 'GET'}
                      onChange={(e) => handleConfigChange('method', e.target.value)}
                      className="w-full rounded-lg border border-stone-200 px-2 py-1.5 text-xs text-stone-900 font-semibold bg-stone-50"
                    >
                      <option value="GET">GET</option>
                      <option value="POST">POST</option>
                      <option value="PUT">PUT</option>
                      <option value="PATCH">PATCH</option>
                      <option value="DELETE">DELETE</option>
                    </select>
                  </div>
                  <div className="col-span-2 space-y-1">
                    <label className="text-[11px] font-medium text-stone-700">URL Endpoint</label>
                    <input
                      type="text"
                      data-testid="http-url-input"
                      value={config.url || ''}
                      onChange={(e) => handleConfigChange('url', e.target.value)}
                      placeholder="https://api.example.com/v1/resource"
                      className="w-full rounded-lg border border-stone-200 px-3 py-1.5 text-xs font-mono text-stone-900 focus:border-amber-500 focus:outline-none"
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-[11px] font-medium text-stone-700">JSON Body Payload</label>
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
                    className="w-full rounded-lg border border-stone-200 p-2 text-xs font-mono text-stone-900 focus:border-amber-500 focus:outline-none resize-none"
                  />
                </div>
              </div>
            )}

            {/* AI Prompt Node Config */}
            {node.type === 'aiPromptNode' && (
              <div className="space-y-3 pt-2 border-t border-stone-100">
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <label className="text-[11px] font-medium text-stone-700 flex items-center gap-1">
                      <Sparkles className="h-3 w-3 text-amber-600" />
                      LLM Prompt Template
                    </label>
                    <button
                      type="button"
                      data-testid="toggle-expression-helper-btn"
                      onClick={() => setShowHelper(!showHelper)}
                      className="text-[10px] text-amber-700 font-semibold hover:underline cursor-pointer"
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
                    className="w-full rounded-lg border border-stone-200 p-2.5 text-xs font-mono text-stone-900 focus:border-amber-500 focus:outline-none resize-none leading-relaxed"
                  />
                </div>
              </div>
            )}

            {/* Approval Node Config */}
            {node.type === 'approvalNode' && (
              <div className="space-y-3 pt-2 border-t border-stone-100">
                <div className="p-3 rounded-xl bg-amber-50/80 border border-amber-200/70 text-xs text-amber-900 space-y-1">
                  <div className="flex items-center gap-1.5 font-semibold">
                    <ShieldAlert className="h-3.5 w-3.5 text-amber-700" />
                    Human-in-the-Loop Approval Gate
                  </div>
                  <p className="text-[11px] text-amber-800/90 leading-relaxed">
                    Workflow pauses in Temporal awaiting manager decision. Exposes 3 outbound branch handles:
                    <span className="font-semibold text-emerald-700"> Approved</span>,
                    <span className="font-semibold text-rose-700"> Rejected</span>, and
                    <span className="font-semibold text-amber-700"> Timeout</span>.
                  </p>
                </div>

                <div className="space-y-1">
                  <label className="text-[11px] font-medium text-stone-700 flex items-center gap-1">
                    <Clock className="h-3 w-3 text-stone-500" />
                    Timeout / SLA Escalation Duration
                  </label>
                  <input
                    type="text"
                    data-testid="approval-timeout-input"
                    value={node.data?.timeoutDuration || '3 days'}
                    onChange={(e) => onUpdate(node.id, { timeoutDuration: e.target.value })}
                    placeholder="e.g. 24 hours, 3 days, 1 week"
                    className="w-full rounded-lg border border-stone-200 px-3 py-2 text-xs font-mono text-stone-900 focus:border-amber-500 focus:outline-none"
                  />
                  <p className="text-[10px] text-stone-400">
                    If no action is taken within this duration, flow routes along the Timeout branch.
                  </p>
                </div>
              </div>
            )}

            {/* Condition Node Config */}
            {node.type === 'conditionNode' && (
              <div className="space-y-3 pt-2 border-t border-stone-100">
                <div className="space-y-1">
                  <label className="text-[11px] font-medium text-stone-700">
                    JavaScript / Expression Condition
                  </label>
                  <input
                    type="text"
                    data-testid="condition-expression-input"
                    value={config.condition || ''}
                    onChange={(e) => handleConfigChange('condition', e.target.value)}
                    placeholder="e.g. $json.amount > 10000 && $json.status === 'ACTIVE'"
                    className="w-full rounded-lg border border-stone-200 px-3 py-2 text-xs font-mono text-stone-900 focus:border-amber-500 focus:outline-none"
                  />
                  <p className="text-[10px] text-stone-400">
                    Routes to TRUE handle if truthy; otherwise routes to FALSE handle.
                  </p>
                </div>
              </div>
            )}

            {/* Send Email Node Config */}
            {node.type === 'sendEmailNode' && (
              <div className="space-y-3 pt-2 border-t border-stone-100">
                <div className="space-y-1">
                  <label className="text-[11px] font-medium text-stone-700">Recipient Email (To)</label>
                  <input
                    type="text"
                    data-testid="email-to-input"
                    value={config.to || ''}
                    onChange={(e) => handleConfigChange('to', e.target.value)}
                    placeholder="{{ $json.email }} or owner@company.com"
                    className="w-full rounded-lg border border-stone-200 px-3 py-1.5 text-xs font-mono text-stone-900 focus:border-amber-500 focus:outline-none"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] font-medium text-stone-700">Subject</label>
                  <input
                    type="text"
                    data-testid="email-subject-input"
                    value={config.subject || ''}
                    onChange={(e) => handleConfigChange('subject', e.target.value)}
                    placeholder="Quotation {{ $trigger.payload.quoteNumber }} Ready"
                    className="w-full rounded-lg border border-stone-200 px-3 py-1.5 text-xs text-stone-900 focus:border-amber-500 focus:outline-none"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] font-medium text-stone-700">Body Content</label>
                  <textarea
                    rows={4}
                    data-testid="email-body-input"
                    value={config.body || ''}
                    onChange={(e) => handleConfigChange('body', e.target.value)}
                    placeholder="Hello {{ $json.name }}, your quote total is ${{ $json.amount }}."
                    className="w-full rounded-lg border border-stone-200 p-2 text-xs font-mono text-stone-900 focus:border-amber-500 focus:outline-none resize-none"
                  />
                </div>
              </div>
            )}

            {/* Delay Node Config */}
            {node.type === 'delayNode' && (
              <div className="space-y-3 pt-2 border-t border-stone-100">
                <div className="space-y-1">
                  <label className="text-[11px] font-medium text-stone-700 flex items-center gap-1">
                    <Timer className="h-3 w-3 text-stone-500" />
                    Sleep Delay (Milliseconds or Duration)
                  </label>
                  <input
                    type="text"
                    data-testid="delay-duration-input"
                    value={config.durationMs || '5000'}
                    onChange={(e) => handleConfigChange('durationMs', e.target.value)}
                    placeholder="5000 (ms)"
                    className="w-full rounded-lg border border-stone-200 px-3 py-2 text-xs font-mono text-stone-900 focus:border-amber-500 focus:outline-none"
                  />
                </div>
              </div>
            )}

            {/* CRM Mutate Node Config */}
            {node.type === 'crmMutateNode' && (
              <div className="space-y-3 pt-2 border-t border-stone-100">
                <div className="space-y-1">
                  <label className="text-[11px] font-medium text-stone-700">Entity</label>
                  <select
                    data-testid="crm-entity-select"
                    value={config.entity || 'quote'}
                    onChange={(e) => handleConfigChange('entity', e.target.value)}
                    className="w-full rounded-lg border border-stone-200 px-2 py-1.5 text-xs text-stone-900 font-semibold bg-stone-50"
                  >
                    <option value="quote">Quote</option>
                    <option value="invoice">Invoice</option>
                    <option value="contact">Contact</option>
                    <option value="deal">Deal</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] font-medium text-stone-700">Action</label>
                  <select
                    data-testid="crm-action-select"
                    value={config.action || 'updateStatus'}
                    onChange={(e) => handleConfigChange('action', e.target.value)}
                    className="w-full rounded-lg border border-stone-200 px-2 py-1.5 text-xs text-stone-900 font-semibold bg-stone-50"
                  >
                    <option value="updateStatus">Update Status</option>
                    <option value="generateInvoice">Generate Invoice from Quote</option>
                    <option value="addNote">Add Activity Note</option>
                  </select>
                </div>
              </div>
            )}

            {/* Trigger Nodes (Webhook / Schedule / CRM Event) */}
            {node.type === 'webhookTrigger' && (
              <div className="space-y-2 pt-2 border-t border-stone-100">
                <label className="text-[11px] font-medium text-stone-700">Webhook Path / Slug</label>
                <input
                  type="text"
                  readOnly
                  value={config.slug ? `/api/automations/webhook/${config.slug}` : '/api/automations/webhook/[slug]'}
                  className="w-full rounded-lg bg-stone-100 border border-stone-200 px-3 py-1.5 text-xs font-mono text-stone-600"
                />
              </div>
            )}

            {node.type === 'scheduleTrigger' && (
              <div className="space-y-2 pt-2 border-t border-stone-100">
                <label className="text-[11px] font-medium text-stone-700">Cron Schedule</label>
                <input
                  type="text"
                  data-testid="schedule-cron-input"
                  value={config.cron || '0 9 * * 1-5'}
                  onChange={(e) => handleConfigChange('cron', e.target.value)}
                  placeholder="0 9 * * 1-5 (Weekdays at 9am)"
                  className="w-full rounded-lg border border-stone-200 px-3 py-1.5 text-xs font-mono text-stone-900"
                />
              </div>
            )}

            {node.type === 'crmEventTrigger' && (
              <div className="space-y-2 pt-2 border-t border-stone-100">
                <label className="text-[11px] font-medium text-stone-700">CRM Event Trigger</label>
                <select
                  data-testid="crm-event-select"
                  value={config.event || 'QUOTE_CREATED'}
                  onChange={(e) => handleConfigChange('event', e.target.value)}
                  className="w-full rounded-lg border border-stone-200 px-2 py-1.5 text-xs text-stone-900 font-semibold bg-stone-50"
                >
                  <option value="QUOTE_CREATED">Quote Created</option>
                  <option value="QUOTE_APPROVED">Quote Approved</option>
                  <option value="QUOTE_REJECTED">Quote Rejected</option>
                  <option value="CONTACT_CREATED">Contact Created</option>
                  <option value="DEAL_STAGE_CHANGED">Deal Stage Changed</option>
                  <option value="RESERVE_BUDGET_CHANGED">Finance Reserve Budget Changed</option>
                </select>
              </div>
            )}

            {/* Embedded Expression Helper */}
            {showHelper && (
              <div className="pt-3 border-t border-stone-100">
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
            <div className="flex items-center justify-between p-3 rounded-lg border border-stone-200 bg-stone-50/60">
              <div>
                <h5 className="text-xs font-semibold text-stone-900">Continue on Fail</h5>
                <p className="text-[10px] text-stone-500">
                  Keep executing subsequent nodes if this node errors.
                </p>
              </div>
              <input
                type="checkbox"
                data-testid="continue-on-fail-checkbox"
                checked={Boolean(node.data?.continueOnFail)}
                onChange={(e) => onUpdate(node.id, { continueOnFail: e.target.checked })}
                className="h-4 w-4 rounded text-amber-600 focus:ring-amber-500 cursor-pointer"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium text-stone-700">Retry Attempts</label>
              <input
                type="number"
                min={0}
                max={5}
                data-testid="retry-count-input"
                value={node.data?.retryCount ?? 0}
                onChange={(e) => onUpdate(node.id, { retryCount: parseInt(e.target.value, 10) || 0 })}
                className="w-full rounded-lg border border-stone-200 px-3 py-2 text-xs text-stone-900"
              />
              <p className="text-[10px] text-stone-400">
                Number of automatic retries with exponential backoff on failure.
              </p>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
