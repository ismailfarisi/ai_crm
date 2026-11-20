'use client';

import React from 'react';
import clsx from 'clsx';
import type { AiAgentActionRecord } from '@saas/shared';
import { toolLabel } from '@/components/settings/agents/agent-labels';

const ACTION_STATUS: Record<AiAgentActionRecord['status'], { label: string; className: string }> = {
  DONE: { label: 'Done', className: 'bg-success-soft text-success' },
  FAILED: { label: 'Failed', className: 'bg-danger-soft text-danger' },
  REJECTED: { label: 'Rejected', className: 'bg-danger-soft text-danger' },
  TIMED_OUT: { label: 'Nobody answered', className: 'bg-surface text-ink-muted border border-border' },
};

interface AgentStepOutput {
  agentName: string;
  model: string | null;
  answer: string | null;
  actions: AiAgentActionRecord[];
}

function isAction(value: unknown): value is AiAgentActionRecord {
  const action = value as Partial<AiAgentActionRecord> | null;
  return (
    !!action &&
    typeof action === 'object' &&
    typeof action.tool === 'string' &&
    typeof action.status === 'string' &&
    action.status in ACTION_STATUS
  );
}

/**
 * Reads an AI agent step's stored output. Null when it holds nothing to show
 * (a run from before steps recorded what the agent did has no `actions`).
 */
export function readAgentStepOutput(output: unknown): AgentStepOutput | null {
  if (!output || typeof output !== 'object') return null;
  const out = output as Record<string, unknown>;
  const agent = out.agent as { name?: unknown } | null | undefined;
  if (!Array.isArray(out.actions)) return null;
  const answer = [out.solution, out.error].find(
    (text): text is string => typeof text === 'string' && text.trim() !== '',
  );
  return {
    agentName: typeof agent?.name === 'string' && agent.name ? agent.name : 'General assistant',
    model: typeof out.model === 'string' && out.model ? out.model : null,
    answer: answer ?? null,
    actions: out.actions.filter(isAction),
  };
}

/** What the agent did in one run of an AI agent step, in the order it did it. */
export function AgentStepResult({ output }: { output: unknown }) {
  const result = readAgentStepOutput(output);
  if (!result) return null;

  return (
    <div data-testid="agent-step-result" className="mt-1.5 space-y-1.5 border-t border-border pt-1.5">
      <p className="text-[11px] text-ink-muted">
        Ran as <span className="font-semibold text-ink">{result.agentName}</span>
        {result.model ? ` · ${result.model}` : ''}
      </p>

      {result.actions.length === 0 ? (
        <p className="text-[11px] text-ink-muted">It used no tools and changed nothing.</p>
      ) : (
        <ol className="space-y-1">
          {result.actions.map((action, index) => (
            <li
              key={index}
              data-testid="agent-step-action"
              className="rounded-md border border-border bg-surface p-1.5 text-[11px]"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-ink truncate">{toolLabel(action.tool)}</span>
                <span className="flex items-center gap-1 shrink-0">
                  {action.changedData && (
                    <span className="rounded px-1.5 py-0.5 font-semibold bg-brand-soft text-ink">
                      {action.approved === true
                        ? 'Changed a record · approved'
                        : action.approved === false
                          ? 'Changed a record · without asking'
                          : 'Changed a record'}
                    </span>
                  )}
                  <span className={clsx('rounded px-1.5 py-0.5 font-semibold', ACTION_STATUS[action.status].className)}>
                    {ACTION_STATUS[action.status].label}
                  </span>
                </span>
              </div>
              {action.summary && <p className="mt-0.5 text-ink-muted break-words">{action.summary}</p>}
            </li>
          ))}
        </ol>
      )}

      {result.answer && (
        <div>
          <p className="text-[11px] font-semibold text-ink-muted">What it said</p>
          <p data-testid="agent-step-answer" className="text-[11px] text-ink whitespace-pre-wrap break-words">
            {result.answer}
          </p>
        </div>
      )}
    </div>
  );
}
