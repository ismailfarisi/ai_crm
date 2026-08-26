'use client';

import React from 'react';
import {
  X,
  CheckCircle2,
  XCircle,
  Clock,
  Terminal,
  Activity,
} from 'lucide-react';
import clsx from 'clsx';
import type { AutomationExecutionDto } from '@saas/shared';

export interface ExecutionTraceDrawerProps {
  execution: AutomationExecutionDto | null;
  onClose: () => void;
  className?: string;
}

export function ExecutionTraceDrawer({
  execution,
  onClose,
  className,
}: ExecutionTraceDrawerProps) {
  const [selectedNodeKey, setSelectedNodeKey] = React.useState<string | null>(null);

  if (!execution) return null;

  const nodeResultKeys = Object.keys(execution.nodeResults || {});
  const activeKey = selectedNodeKey || (nodeResultKeys.length > 0 ? nodeResultKeys[0] : null);

  return (
    <aside
      data-testid="execution-trace-drawer"
      className={clsx(
        'w-[440px] border-l border-stone-200 bg-white shadow-2xl flex flex-col h-full z-40 select-text',
        className,
      )}
    >
      <div className="flex items-center justify-between p-4 border-b border-stone-100 bg-stone-50/50">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-stone-800 text-white">
            <Activity className="h-4 w-4" />
          </div>
          <div>
            <h3 className="text-xs font-bold text-stone-900">Execution Details</h3>
            <p className="text-[10px] text-stone-500 font-mono">{execution.id}</p>
          </div>
        </div>
        <button
          type="button"
          data-testid="close-trace-drawer-btn"
          onClick={onClose}
          className="p-1.5 rounded-lg text-stone-400 hover:text-stone-700 hover:bg-stone-100 cursor-pointer"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Status card */}
        <div className="flex items-center justify-between p-3 rounded-xl border border-stone-200 bg-stone-50">
          <div>
            <span className="text-[10px] text-stone-500 uppercase font-semibold">Status</span>
            <p className="text-xs font-bold text-stone-900">{execution.status}</p>
          </div>
          <div>
            <span className="text-[10px] text-stone-500 uppercase font-semibold">Started</span>
            <p className="text-xs font-mono text-stone-700">{new Date(execution.startedAt).toLocaleTimeString()}</p>
          </div>
        </div>

        {/* Node Results list */}
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-stone-800">Node Traces</label>
          {nodeResultKeys.length === 0 ? (
            <p className="text-xs text-stone-400 italic">No node execution steps recorded.</p>
          ) : (
            nodeResultKeys.map((k) => {
              const item = execution.nodeResults[k];
              return (
                <button
                  key={k}
                  type="button"
                  data-testid={`trace-node-${k}`}
                  onClick={() => setSelectedNodeKey(k)}
                  className={clsx(
                    'w-full flex items-center justify-between p-2 rounded-lg border text-left text-xs transition-all cursor-pointer',
                    activeKey === k
                      ? 'border-amber-500 bg-amber-50/60 font-semibold'
                      : 'border-stone-200 bg-stone-50 hover:bg-stone-100',
                  )}
                >
                  <div className="flex items-center gap-2 truncate">
                    {item.status === 'SUCCESS' ? (
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                    ) : item.status === 'WAITING' ? (
                      <Clock className="h-3.5 w-3.5 text-amber-600 shrink-0" />
                    ) : (
                      <XCircle className="h-3.5 w-3.5 text-rose-600 shrink-0" />
                    )}
                    <span className="truncate">{k}</span>
                  </div>
                  <span className="text-[10px] font-mono text-stone-400 shrink-0">
                    {item.durationMs ? `${item.durationMs}ms` : ''}
                  </span>
                </button>
              );
            })
          )}
        </div>

        {/* Selected Node Data Viewer */}
        {activeKey && execution.nodeResults?.[activeKey] && (
          <div className="space-y-2 pt-2">
            <label className="text-[11px] font-semibold text-stone-700 flex items-center gap-1">
              <Terminal className="h-3 w-3 text-stone-500" />
              Payload Data for: {activeKey}
            </label>
            <pre
              data-testid="trace-node-payload-json"
              className="p-2.5 rounded-lg bg-stone-900 text-amber-300 font-mono text-[11px] overflow-x-auto max-h-60 border border-stone-800"
            >
              {JSON.stringify(execution.nodeResults[activeKey], null, 2)}
            </pre>
          </div>
        )}
      </div>
    </aside>
  );
}
