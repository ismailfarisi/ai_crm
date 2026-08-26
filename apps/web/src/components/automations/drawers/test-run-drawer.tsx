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
        'w-[440px] border-l border-stone-200 bg-white shadow-2xl flex flex-col h-full z-40 select-text',
        className,
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-stone-100 bg-stone-50/50">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500 text-white font-bold">
            <Play className="h-4 w-4 fill-white" />
          </div>
          <div>
            <h3 className="text-xs font-bold text-stone-900">Test Run Workflow</h3>
            <p className="text-[10px] text-stone-500">Live trigger simulation & step tracer</p>
          </div>
        </div>
        <button
          type="button"
          data-testid="close-test-drawer-btn"
          onClick={onClose}
          className="p-1.5 rounded-lg text-stone-400 hover:text-stone-700 hover:bg-stone-100 cursor-pointer"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Test Payload Input Form */}
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-stone-800 flex items-center justify-between">
            <span>Trigger Input JSON Payload</span>
            <span className="text-[10px] text-stone-400 font-mono">mock $trigger</span>
          </label>
          <textarea
            rows={5}
            data-testid="test-payload-input"
            value={testPayloadStr}
            onChange={(e) => setTestPayloadStr(e.target.value)}
            className="w-full rounded-lg border border-stone-200 p-2.5 font-mono text-[11px] text-stone-900 bg-stone-50 focus:bg-white focus:border-amber-500 focus:outline-none resize-none leading-relaxed"
          />
        </div>

        {/* Action Button */}
        <button
          type="button"
          data-testid="execute-test-btn"
          disabled={isRunning}
          onClick={handleRun}
          className={clsx(
            'w-full py-2.5 px-4 rounded-xl text-xs font-semibold text-white shadow-sm flex items-center justify-center gap-2 transition-all cursor-pointer',
            isRunning
              ? 'bg-amber-400 cursor-not-allowed'
              : 'bg-amber-600 hover:bg-amber-700 active:scale-[0.99]',
          )}
        >
          {isRunning ? (
            <>
              <RotateCcw className="h-3.5 w-3.5 animate-spin" />
              Executing Workflow DAG...
            </>
          ) : (
            <>
              <Play className="h-3.5 w-3.5 fill-white" />
              Run Test Now
            </>
          )}
        </button>

        {/* Execution Results View */}
        {executionResult && (
          <div data-testid="execution-result-section" className="space-y-3 pt-3 border-t border-stone-200">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-stone-900">Execution Output</span>
              <span
                className={clsx(
                  'px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider',
                  executionResult.status === 'COMPLETED' && 'bg-emerald-100 text-emerald-800',
                  executionResult.status === 'RUNNING' && 'bg-blue-100 text-blue-800',
                  executionResult.status === 'WAITING_APPROVAL' && 'bg-amber-100 text-amber-800',
                  executionResult.status === 'FAILED' && 'bg-rose-100 text-rose-800',
                )}
              >
                {executionResult.status}
              </span>
            </div>

            {/* Step-by-Step Node Results Timeline */}
            <div className="space-y-1.5">
              <label className="text-[11px] font-medium text-stone-600">Step Traces</label>
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
                        ? 'border-amber-500 bg-amber-50/60 font-semibold'
                        : 'border-stone-200 bg-stone-50 hover:bg-stone-100',
                    )}
                  >
                    <div className="flex items-center gap-2 truncate">
                      {res.status === 'SUCCESS' ? (
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                      ) : res.status === 'WAITING' ? (
                        <Clock className="h-3.5 w-3.5 text-amber-600 shrink-0" />
                      ) : (
                        <XCircle className="h-3.5 w-3.5 text-rose-600 shrink-0" />
                      )}
                      <span className="truncate">{nodeId}</span>
                    </div>
                    <span className="text-[10px] font-mono text-stone-400 shrink-0">
                      {res.durationMs !== undefined ? `${res.durationMs}ms` : ''}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {/* Selected Node Details */}
            {selectedNodeResultKey && executionResult.nodeResults?.[selectedNodeResultKey] && (
              <div className="space-y-2 pt-2">
                <label className="text-[11px] font-semibold text-stone-700 flex items-center gap-1">
                  <Terminal className="h-3 w-3 text-stone-500" />
                  Output for: {selectedNodeResultKey}
                </label>
                <pre
                  data-testid="selected-node-output-json"
                  className="p-2.5 rounded-lg bg-stone-900 text-emerald-400 font-mono text-[11px] overflow-x-auto max-h-56 border border-stone-800"
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
