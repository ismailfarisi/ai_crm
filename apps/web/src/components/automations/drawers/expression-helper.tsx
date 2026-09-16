'use client';

import React, { useState, useMemo } from 'react';
import {
  Code,
  Sparkles,
  Copy,
  Check,
  Search,
  Zap,
  Layers,
  Database,
  Key,
  Info,
} from 'lucide-react';
import clsx from 'clsx';
import type { AutomationNode } from '@saas/shared';

export interface VariableItem {
  key: string;
  expression: string;
  category: 'json' | 'trigger' | 'node' | 'env';
  description: string;
  sampleValue?: any;
}

export const DEFAULT_SAMPLE_PAYLOAD = {
  $json: {
    id: 'cont_987123',
    name: 'Sarah Connor',
    email: 'sarah.connor@cyberdyne.io',
    phone: '+1 (555) 019-2834',
    amount: 14500,
    currency: 'USD',
    status: 'ACTIVE',
    stage: 'PROPOSAL',
    company: 'Cyberdyne Systems',
    createdAt: '2026-08-15T10:00:00Z',
  },
  $trigger: {
    eventType: 'QUOTE_APPROVED',
    entityId: 'quote_456',
    timestamp: '2026-08-17T12:00:00Z',
    payload: {
      quoteId: 'quote_456',
      quoteNumber: 'Q-2026-009',
      totalAmount: 14500,
      customerName: 'Sarah Connor',
      approvedBy: 'admin@company.com',
    },
  },
  $node: {
    'Fetch Customer': {
      json: {
        id: 'cust_111',
        tier: 'Enterprise',
        discount: 0.15,
        creditLimit: 50000,
      },
    },
    'Calculate Discount': {
      json: {
        netAmount: 12325,
        appliedDiscount: 2175,
      },
    },
  },
  $env: {
    CRM_API_URL: 'https://api.crm.example.com',
    APP_ENV: 'production',
    COMPANY_NAME: 'Acme SaaS Corp',
    SUPPORT_EMAIL: 'support@acmecorp.io',
  },
};

/**
 * Safely resolves nested property paths (e.g. "$json.user.email" or "$node['Fetch Customer'].json.id")
 */
function resolvePath(path: string, context: Record<string, any>): any {
  const clean = path.trim();
  
  // Check for node reference like $node['Node Name'].json.field or $node["Node Name"].json.field
  const nodeMatch = clean.match(/^\$node\[['"]([^'"]+)['"]\](?:\.(.+))?$/);
  if (nodeMatch) {
    const nodeName = nodeMatch[1];
    const rest = nodeMatch[2];
    const nodeData = context.$node?.[nodeName];
    if (!nodeData) return undefined;
    if (!rest) return nodeData;
    return rest.split('.').reduce((acc, part) => (acc ? acc[part] : undefined), nodeData);
  }

  // Standard dot path e.g. $json.name or $trigger.payload.quoteNumber
  const parts = clean.split('.');
  return parts.reduce((acc, part) => {
    if (acc === undefined || acc === null) return undefined;
    return acc[part];
  }, context as any);
}

/**
 * Interpolates string templates with {{ $json.field }} variables using safe context evaluation.
 */
export function interpolateExpression(
  template: string,
  context: Record<string, any> = DEFAULT_SAMPLE_PAYLOAD,
): string {
  if (!template) return '';
  return template.replace(/\{\{\s*([^}]+)\s*\}\}/g, (match, expr) => {
    try {
      const resolved = resolvePath(expr, context);
      if (resolved === undefined || resolved === null) {
        return match; // Return unchanged if not found
      }
      if (typeof resolved === 'object') {
        return JSON.stringify(resolved);
      }
      return String(resolved);
    } catch {
      return match;
    }
  });
}

export interface ExpressionHelperProps {
  onSelectVariable?: (variableCode: string) => void;
  allNodes?: AutomationNode[];
  samplePayload?: Record<string, any>;
  previewTemplate?: string;
  onPreviewChange?: (template: string) => void;
  compact?: boolean;
  className?: string;
}

export function ExpressionHelper({
  onSelectVariable,
  allNodes = [],
  samplePayload = DEFAULT_SAMPLE_PAYLOAD,
  previewTemplate = '',
  onPreviewChange,
  compact = false,
  className,
}: ExpressionHelperProps) {
  const [activeTab, setActiveTab] = useState<'all' | 'json' | 'trigger' | 'node' | 'env' | 'preview'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [templateInput, setTemplateInput] = useState(previewTemplate || 'Hello {{ $json.name }}, quote {{ $trigger.payload.quoteNumber }} total is ${{ $json.amount }}.');

  const handleCopyOrSelect = (expression: string) => {
    onSelectVariable?.(expression);
    navigator.clipboard?.writeText?.(expression);
    setCopiedKey(expression);
    setTimeout(() => setCopiedKey(null), 1800);
  };

  // Build variable list dynamically from samplePayload and allNodes
  const variables: VariableItem[] = useMemo(() => {
    const list: VariableItem[] = [];

    // Current Node ($json)
    if (samplePayload.$json && typeof samplePayload.$json === 'object') {
      Object.entries(samplePayload.$json).forEach(([k, v]) => {
        list.push({
          key: `$json.${k}`,
          expression: `{{ $json.${k} }}`,
          category: 'json',
          description: `Current item ${k}`,
          sampleValue: v,
        });
      });
    }

    // Trigger Data ($trigger)
    if (samplePayload.$trigger && typeof samplePayload.$trigger === 'object') {
      list.push({
        key: '$trigger.eventType',
        expression: '{{ $trigger.eventType }}',
        category: 'trigger',
        description: 'CRM event or trigger type name',
        sampleValue: samplePayload.$trigger.eventType,
      });
      list.push({
        key: '$trigger.entityId',
        expression: '{{ $trigger.entityId }}',
        category: 'trigger',
        description: 'Target entity ID from trigger',
        sampleValue: samplePayload.$trigger.entityId,
      });
      if (samplePayload.$trigger.payload) {
        Object.entries(samplePayload.$trigger.payload).forEach(([k, v]) => {
          list.push({
            key: `$trigger.payload.${k}`,
            expression: `{{ $trigger.payload.${k} }}`,
            category: 'trigger',
            description: `Trigger payload ${k}`,
            sampleValue: v,
          });
        });
      }
    }

    // Preceding Nodes ($node)
    if (allNodes.length > 0) {
      allNodes.forEach((node) => {
        const nodeLabel = node.data?.label || node.id;
        list.push({
          key: `$node['${nodeLabel}'].json`,
          expression: `{{ $node['${nodeLabel}'].json }}`,
          category: 'node',
          description: `Full output payload of node "${nodeLabel}"`,
          sampleValue: { status: 'SUCCESS' },
        });
        list.push({
          key: `$node['${nodeLabel}'].json.id`,
          expression: `{{ $node['${nodeLabel}'].json.id }}`,
          category: 'node',
          description: `Result ID from node "${nodeLabel}"`,
          sampleValue: 'res_101',
        });
      });
    } else if (samplePayload.$node) {
      Object.entries(samplePayload.$node).forEach(([nodeName, nodeObj]: [string, any]) => {
        if (nodeObj?.json) {
          Object.entries(nodeObj.json).forEach(([k, v]) => {
            list.push({
              key: `$node['${nodeName}'].json.${k}`,
              expression: `{{ $node['${nodeName}'].json.${k} }}`,
              category: 'node',
              description: `Output field ${k} from "${nodeName}"`,
              sampleValue: v,
            });
          });
        }
      });
    }

    // Environment ($env)
    if (samplePayload.$env) {
      Object.entries(samplePayload.$env).forEach(([k, v]) => {
        list.push({
          key: `$env.${k}`,
          expression: `{{ $env.${k} }}`,
          category: 'env',
          description: `Environment variable ${k}`,
          sampleValue: v,
        });
      });
    }

    return list;
  }, [samplePayload, allNodes]);

  const filteredVariables = useMemo(() => {
    return variables.filter((v) => {
      const matchesTab = activeTab === 'all' || v.category === activeTab;
      const q = searchQuery.toLowerCase().trim();
      const matchesSearch =
        !q ||
        v.key.toLowerCase().includes(q) ||
        v.expression.toLowerCase().includes(q) ||
        v.description.toLowerCase().includes(q);
      return matchesTab && matchesSearch;
    });
  }, [variables, activeTab, searchQuery]);

  const interpolatedPreview = useMemo(() => {
    const textToEvaluate = previewTemplate || templateInput;
    return interpolateExpression(textToEvaluate, samplePayload);
  }, [previewTemplate, templateInput, samplePayload]);

  return (
    <div
      data-testid="expression-helper"
      className={clsx(
        'rounded-xl border border-border bg-surface shadow-xs flex flex-col text-xs text-ink',
        compact ? 'p-2 space-y-2' : 'p-3 space-y-3',
        className,
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 font-semibold text-ink">
          <Sparkles className="h-3.5 w-3.5 text-brand" />
          <span>Expression & Variable Helper</span>
        </div>
        <span className="text-[10px] text-ink-subtle font-mono">
          Click pill to copy / insert
        </span>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-border/40 pb-1.5 overflow-x-auto no-scrollbar">
        <button
          type="button"
          data-testid="tab-all"
          onClick={() => setActiveTab('all')}
          className={clsx(
            'px-2 py-0.5 rounded text-[11px] font-medium transition-colors cursor-pointer',
            activeTab === 'all'
              ? 'bg-brand-soft text-ink font-semibold'
              : 'text-ink-muted hover:bg-surface-muted',
          )}
        >
          All
        </button>
        <button
          type="button"
          data-testid="tab-json"
          onClick={() => setActiveTab('json')}
          className={clsx(
            'px-2 py-0.5 rounded text-[11px] font-medium transition-colors flex items-center gap-1 cursor-pointer',
            activeTab === 'json'
              ? 'bg-brand-soft text-ink font-semibold'
              : 'text-ink-muted hover:bg-surface-muted',
          )}
        >
          <Database className="h-3 w-3 text-ink" />
          $json
        </button>
        <button
          type="button"
          data-testid="tab-trigger"
          onClick={() => setActiveTab('trigger')}
          className={clsx(
            'px-2 py-0.5 rounded text-[11px] font-medium transition-colors flex items-center gap-1 cursor-pointer',
            activeTab === 'trigger'
              ? 'bg-brand-soft text-ink font-semibold'
              : 'text-ink-muted hover:bg-surface-muted',
          )}
        >
          <Zap className="h-3 w-3 text-success" />
          $trigger
        </button>
        <button
          type="button"
          data-testid="tab-node"
          onClick={() => setActiveTab('node')}
          className={clsx(
            'px-2 py-0.5 rounded text-[11px] font-medium transition-colors flex items-center gap-1 cursor-pointer',
            activeTab === 'node'
              ? 'bg-brand-soft text-ink font-semibold'
              : 'text-ink-muted hover:bg-surface-muted',
          )}
        >
          <Layers className="h-3 w-3 text-info" />
          $node
        </button>
        <button
          type="button"
          data-testid="tab-env"
          onClick={() => setActiveTab('env')}
          className={clsx(
            'px-2 py-0.5 rounded text-[11px] font-medium transition-colors flex items-center gap-1 cursor-pointer',
            activeTab === 'env'
              ? 'bg-brand-soft text-ink font-semibold'
              : 'text-ink-muted hover:bg-surface-muted',
          )}
        >
          <Key className="h-3 w-3 text-info" />
          $env
        </button>
        <button
          type="button"
          data-testid="tab-preview"
          onClick={() => setActiveTab('preview')}
          className={clsx(
            'px-2 py-0.5 rounded text-[11px] font-medium transition-colors flex items-center gap-1 ml-auto cursor-pointer',
            activeTab === 'preview'
              ? 'bg-brand text-ink font-semibold'
              : 'text-ink-muted hover:bg-surface-muted',
          )}
        >
          <Code className="h-3 w-3" />
          Live Preview
        </button>
      </div>

      {activeTab !== 'preview' ? (
        <>
          {/* Search bar */}
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-ink-subtle pointer-events-none" />
            <input
              type="text"
              data-testid="expression-search-input"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search variables (e.g. email, quote, amount)..."
              className="w-full pl-7 pr-3 py-1 text-[11px] bg-surface-muted border border-border rounded-lg text-ink placeholder:text-ink-subtle focus:bg-surface focus:border-brand focus:outline-none"
            />
          </div>

          {/* Variables List / Pills */}
          <div
            data-testid="expression-variable-list"
            className="max-h-48 overflow-y-auto space-y-1.5 pr-1"
          >
            {filteredVariables.length === 0 ? (
              <div className="py-4 text-center text-ink-subtle text-[11px]">
                No variables match &quot;{searchQuery}&quot;
              </div>
            ) : (
              filteredVariables.map((v) => {
                const isCopied = copiedKey === v.expression;
                return (
                  <div
                    key={v.key}
                    data-testid={`variable-item-${v.key}`}
                    onClick={() => handleCopyOrSelect(v.expression)}
                    className="group flex items-center justify-between p-1.5 rounded-lg border border-border/70 bg-surface-muted/50 hover:bg-brand-soft/60 hover:border-brand/40 transition-all cursor-pointer"
                  >
                    <div className="min-w-0 flex-1 pr-2">
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono font-semibold text-ink text-[11px] group-hover:text-ink truncate">
                          {v.expression}
                        </span>
                        {v.sampleValue !== undefined && (
                          <span className="text-[10px] text-ink-subtle truncate max-w-[120px] font-mono">
                            = {typeof v.sampleValue === 'object' ? '{...}' : String(v.sampleValue)}
                          </span>
                        )}
                      </div>
                      <p className="text-[10px] text-ink-muted truncate mt-0.5">
                        {v.description}
                      </p>
                    </div>

                    <div className="shrink-0 flex items-center gap-1 text-ink-subtle group-hover:text-ink">
                      {isCopied ? (
                        <Check className="h-3.5 w-3.5 text-success animate-in zoom-in-50" />
                      ) : (
                        <Copy className="h-3.5 w-3.5 opacity-60 group-hover:opacity-100" />
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </>
      ) : (
        /* Live Preview / Expression Evaluator */
        <div data-testid="expression-preview-panel" className="space-y-2.5">
          <div className="space-y-1">
            <label className="text-[11px] font-medium text-ink">
              Expression Template:
            </label>
            <textarea
              data-testid="expression-preview-input"
              rows={2}
              value={previewTemplate || templateInput}
              onChange={(e) => {
                setTemplateInput(e.target.value);
                onPreviewChange?.(e.target.value);
              }}
              placeholder="e.g. Contact {{ $json.name }} was updated at {{ $trigger.timestamp }}"
              className="w-full p-2 font-mono text-[11px] bg-surface-muted border border-border rounded-lg text-ink focus:bg-surface focus:border-brand focus:outline-none resize-none"
            />
          </div>

          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <label className="text-[11px] font-medium text-ink flex items-center gap-1">
                <Info className="h-3 w-3 text-ink-subtle" />
                Evaluated Output:
              </label>
              <button
                type="button"
                data-testid="copy-preview-btn"
                onClick={() => handleCopyOrSelect(interpolatedPreview)}
                className="text-[10px] text-ink hover:text-ink font-medium cursor-pointer"
              >
                Copy Output
              </button>
            </div>
            <div
              data-testid="expression-preview-output"
              className="p-2 rounded-lg bg-brand-dark text-brand font-mono text-[11px] min-h-[44px] break-all border border-border-strong shadow-inner"
            >
              {interpolatedPreview || <span className="text-ink-muted italic">Empty output</span>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
