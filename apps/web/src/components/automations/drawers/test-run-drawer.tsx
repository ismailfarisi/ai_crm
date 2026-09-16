'use client';

import React, { useState } from 'react';
import {
  X,
  Play,
  RotateCcw,
  CheckCircle2,
  XCircle,
  Clock,
  ChevronRight,
  Layers,
  Sparkles,
  ShieldAlert,
  Terminal,
} from 'lucide-react';
import clsx from 'clsx';
import type { AutomationWorkflowDto, AutomationExecutionDto } from '@saas/shared';

export interface TestRunDrawerProps {
  workflow: AutomationWorkflowDto | null;
  onExecuteTest: (payload: Record<string, any>) => Promise<AutomationExecutionDto | null>;
  onClose: () => void;
  className?: string;
}

export function TestRunDrawer({
  workflow,
  onExecuteTest,
  onClose,
  className,
}: TestRunDrawerProps) {
  const [testPayloadStr, setTestPayloadStr] = useState(
    JSON.stringify(
      {
        customerName: 'Acme Systems Corp',
        customerEmail: 'contact@acmesystems.com',
        amount: 24500,
        currency: 'USD',
        quoteNumber: 'QT-2026-TEST',
        status: 'PENDING',
      },
      null,
      2,
    ),
  );

  const [isRunning, setIsRunning] = useState(false);
  const [executionResult, setExecutionResult] = useState<AutomationExecutionDto | null>(null);
  const [selectedNodeResultKey, setSelectedNodeResultKey] = useState<string | null>(null);

  const handleRun = async () => {
    let payload = {};
    try {
      payload = JSON.parse(testPayloadStr);
    } catch {
      payload = { raw: testPayloadStr };
    }

    setIsRunning(true);
    try {
      const res = await onExecuteTest(payload);
      setExecutionResult(res);
      if (res?.nodeResults && Object.keys(res.nodeResults).length > 0) {
        setSelectedNodeResultKey(Object.keys(res.nodeResults)[0]);
      }
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <aside
      data-testid="test-run-drawer"
      className={clsx(
        'w-[440px] border-l border-border bg-surface shadow-2xl flex flex-col h-full z-40 select-text',
        className,
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-border/40 bg-surface-muted/50">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand text-ink font-bold">
            <Play className="h-4 w-4 fill-surface" />
          </div>
          <div>
            <h3 className="text-xs font-bold text-ink">Test Run Workflow</h3>
            <p className="text-[10px] text-ink-muted">Live trigger simulation & step tracer</p>
          </div>
        </div>
        <button
          type="button"
          data-testid="close-test-drawer-btn"
          onClick={onClose}
          className="p-1.5 rounded-lg text-ink-subtle hover:text-ink hover:bg-surface-muted cursor-pointer"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Test Payload Input Form */}
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-ink flex items-center justify-between">
            <span>Trigger Input JSON Payload</span>
            <span className="text-[10px] text-ink-subtle font-mono">mock $trigger</span>
          </label>
          <textarea
            rows={5}
            data-testid="test-payload-input"
            value={testPayloadStr}
            onChange={(e) => setTestPayloadStr(e.target.value)}
            className="w-full rounded-lg border border-border p-2.5 font-mono text-[11px] text-ink bg-surface-muted focus:bg-surface focus:border-brand focus:outline-none resize-none leading-relaxed"
          />
        </div>

        {/* Action Button */}
        <button
          type="button"
          data-testid="execute-test-btn"
          disabled={isRunning}
          onClick={handleRun}
          className={clsx(
            'w-full py-2.5 px-4 rounded-xl text-xs font-semibold text-ink-inverted shadow-sm flex items-center justify-center gap-2 transition-all cursor-pointer',
            isRunning
              ? 'bg-brand cursor-not-allowed'
              : 'bg-brand hover:bg-brand-hover active:scale-[0.99]',
          )}
        >
          {isRunning ? (
            <>
              <RotateCcw className="h-3.5 w-3.5 animate-spin" />
              Executing Workflow DAG...
            </>
          ) : (
            <>
              <Play className="h-3.5 w-3.5 fill-surface" />
              Run Test Now
            </>
          )}
        </button>

        {/* Execution Results View */}
        {executionResult && (
          <div data-testid="execution-result-section" className="space-y-3 pt-3 border-t border-border">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-ink">Execution Output</span>
              <span
                className={clsx(
                  'px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider',
                  executionResult.status === 'COMPLETED' && 'bg-success-soft text-success',
                  executionResult.status === 'RUNNING' && 'bg-info-soft text-info',
                  executionResult.status === 'WAITING_APPROVAL' && 'bg-brand-soft text-ink',
                  executionResult.status === 'FAILED' && 'bg-danger-soft text-danger',
                )}
              >
                {executionResult.status}
              </span>
            </div>

            {/* Step-by-Step Node Results Timeline */}
            <div className="space-y-1.5">
              <label className="text-[11px] font-medium text-ink-muted">Step Traces</label>
              <div className="space-y-1.5">
                {Object.entries(executionResult.nodeResults || {}).map(([nodeId, res]) => (
                  <button
                    key={nodeId}
                    type="button"
                    data-testid={`step-trace-${nodeId}`}
                    onClick={() => setSelectedNodeResultKey(nodeId)}
                    className={clsx(
                      'w-full flex items-center justify-between p-2 rounded-lg border text-left text-xs transition-all cursor-pointer',
                      selectedNodeResultKey === nodeId
                        ? 'border-brand bg-brand-soft/60 font-semibold'
                        : 'border-border bg-surface-muted hover:bg-surface-muted',
                    )}
                  >
                    <div className="flex items-center gap-2 truncate">
                      {res.status === 'SUCCESS' ? (
                        <CheckCircle2 className="h-3.5 w-3.5 text-success shrink-0" />
                      ) : res.status === 'WAITING' ? (
                        <Clock className="h-3.5 w-3.5 text-brand shrink-0" />
                      ) : (
                        <XCircle className="h-3.5 w-3.5 text-danger shrink-0" />
                      )}
                      <span className="truncate">{nodeId}</span>
                    </div>
                    <span className="text-[10px] font-mono text-ink-subtle shrink-0">
                      {res.durationMs !== undefined ? `${res.durationMs}ms` : ''}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {/* Selected Node Details */}
            {selectedNodeResultKey && executionResult.nodeResults?.[selectedNodeResultKey] && (
              <div className="space-y-2 pt-2">
                <label className="text-[11px] font-semibold text-ink flex items-center gap-1">
                  <Terminal className="h-3 w-3 text-ink-muted" />
                  Output for: {selectedNodeResultKey}
                </label>
                <pre
                  data-testid="selected-node-output-json"
                  className="p-2.5 rounded-lg bg-brand-dark text-success font-mono text-[11px] overflow-x-auto max-h-56 border border-border-strong"
                >
                  {JSON.stringify(
                    executionResult.nodeResults[selectedNodeResultKey].output ||
                      executionResult.nodeResults[selectedNodeResultKey].input ||
                      executionResult.nodeResults[selectedNodeResultKey],
                    null,
                    2,
                  )}
                </pre>
              </div>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}
