'use client';

import React from 'react';
import Link from 'next/link';
import { Bot, ShieldCheck } from 'lucide-react';
import { AI_AGENT_STEP_NO_TASK, aiAgentStepTask } from '@saas/shared';
import { toolLabel } from '@/components/settings/agents/agent-labels';
import { agentChoice, agentChoiceProblem, useAgentOptions } from './agent-options';

/** Tasks a workshop actually hands off; each fills the box as a starting point. */
export const AGENT_TASK_EXAMPLES = [
  {
    label: 'Chase a quote',
    task:
      'Look up quote {{ $trigger.payload.quoteNumber }}. If the customer has not replied, ' +
      'draft a short, polite follow-up and say what you would send.',
  },
  {
    label: 'Chase an overdue invoice',
    task:
      'Invoice {{ $trigger.payload.invoiceNumber }} is overdue. Check what has been paid ' +
      'and what is still owed, then draft a payment reminder for the customer.',
  },
  {
    label: 'Check a new enquiry',
    task:
      'A new contact was added: {{ $trigger.payload.firstName }} {{ $trigger.payload.lastName }} ' +
      'from {{ $trigger.payload.company }}. Check whether we have quoted them before and ' +
      'summarise what they are likely to need.',
  },
] as const;

const DEFAULT_DOMAINS = ['SALES', 'GENERAL'];

const WAIT_OPTIONS = [
  { value: '1 hour', label: '1 hour' },
  { value: '1 day', label: '1 day' },
  { value: '3 days', label: '3 days' },
  { value: '7 days', label: '7 days' },
];

const selectClass =
  'w-full rounded-lg border border-border px-2 py-1.5 text-xs text-ink font-semibold bg-surface-muted';

export interface AiAgentStepFieldsProps {
  config: Record<string, unknown>;
  /** Replaces the step's whole config. */
  onChange: (config: Record<string, unknown>) => void;
  showVariables: boolean;
  onToggleVariables: () => void;
}

export function AiAgentStepFields({
  config,
  onChange,
  showVariables,
  onToggleVariables,
}: AiAgentStepFieldsProps) {
  const options = useAgentOptions();
  const agentId = typeof config.agentId === 'string' ? config.agentId : '';
  const choice = agentChoice(agentId, options);
  const agentProblem = agentChoiceProblem(choice);
  const usable = (options ?? []).filter((option) => option.isEnabled);
  const hasTask = aiAgentStepTask({ data: { label: '', config } }) !== '';
  const wait = typeof config.timeoutDuration === 'string' ? config.timeoutDuration : '';
  const waitKnown = WAIT_OPTIONS.some((option) => option.value === wait);

  const pickAgent = (picked: string) => {
    // The canvas merges a step's config key by key, so a key is cleared by
    // setting it, not by leaving it out.
    onChange(
      picked
        ? // The agent's own tool list decides what it can use.
          { ...config, agentId: picked, allowedDomains: null }
        : { ...config, agentId: null, allowedDomains: DEFAULT_DOMAINS },
    );
  };

  return (
    <div data-testid="ai-agent-step-fields" className="space-y-3 pt-2 border-t border-border/40">
      <div className="space-y-1">
        <label htmlFor="agent-step-agent" className="text-[11px] font-medium text-ink flex items-center gap-1">
          <Bot className="h-3 w-3 text-ink-muted" />
          Agent
        </label>
        <select
          id="agent-step-agent"
          data-testid="agent-step-agent-select"
          value={agentId}
          onChange={(e) => pickAgent(e.target.value)}
          className={selectClass}
        >
          <option value="">General assistant</option>
          {usable.map((option) => (
            <option key={option.id} value={option.id}>
              {option.name}
            </option>
          ))}
          {choice.state === 'off' && (
            <option value={choice.agent.id}>{choice.agent.name} (switched off)</option>
          )}
          {choice.state === 'missing' && <option value={agentId}>Deleted agent</option>}
          {choice.state === 'loading' && <option value={agentId}>Loading…</option>}
        </select>

        {agentProblem && (
          <p role="alert" data-testid="agent-step-agent-problem" className="text-[11px] text-danger">
            {agentProblem}
          </p>
        )}
        {choice.state === 'ok' && (
          <div data-testid="agent-step-agent-summary" className="text-[11px] text-ink-muted space-y-0.5">
            {choice.agent.description && <p>{choice.agent.description}</p>}
            <p>
              Tools: {choice.agent.tools.map(toolLabel).join(', ') || 'none, so it can only answer in words'}.
            </p>
          </div>
        )}
        {choice.state === 'none' && (
          <p className="text-[11px] text-ink-muted">
            {options && usable.length === 0
              ? 'You have no agents for staff work yet. '
              : 'Uses the standard assistant. Pick one of your agents to use its instructions, model and tools. '}
            <Link href="/settings/ai" className="font-semibold text-ink hover:underline">
              Manage agents in Settings → AI
            </Link>
          </p>
        )}
      </div>

      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <label htmlFor="agent-step-task" className="text-[11px] font-medium text-ink">
            Task
          </label>
          <button
            type="button"
            data-testid="agent-step-insert-data-btn"
            onClick={onToggleVariables}
            className="text-[11px] text-ink font-semibold hover:underline cursor-pointer"
          >
            {showVariables ? 'Hide data from earlier steps' : 'Insert data from earlier steps'}
          </button>
        </div>
        <textarea
          id="agent-step-task"
          rows={6}
          data-testid="agent-step-task-input"
          value={typeof config.goal === 'string' ? config.goal : ''}
          onChange={(e) => onChange({ ...config, goal: e.target.value })}
          aria-invalid={!hasTask}
          aria-describedby={hasTask ? undefined : 'agent-step-task-problem'}
          placeholder="Say what the agent should do, as you would to a colleague."
          className={
            'w-full rounded-lg border p-2.5 text-xs text-ink focus:outline-none resize-none leading-relaxed ' +
            (hasTask ? 'border-border focus:border-brand' : 'border-danger focus:border-danger')
          }
        />
        {!hasTask && (
          <>
            <p
              id="agent-step-task-problem"
              role="alert"
              data-testid="agent-step-task-problem"
              className="text-[11px] text-danger"
            >
              {AI_AGENT_STEP_NO_TASK} The automation can&apos;t be switched on until it does.
            </p>
            <div className="flex flex-wrap items-center gap-1.5 pt-1">
              <span className="text-[11px] text-ink-muted">Start from:</span>
              {AGENT_TASK_EXAMPLES.map((example) => (
                <button
                  key={example.label}
                  type="button"
                  data-testid="agent-step-example-btn"
                  onClick={() => onChange({ ...config, goal: example.task })}
                  className="rounded-full border border-border bg-surface px-2 py-0.5 text-[11px] font-medium text-ink hover:bg-surface-muted cursor-pointer"
                >
                  {example.label}
                </button>
              ))}
            </div>
          </>
        )}
        {hasTask && (
          <p className="text-[11px] text-ink-subtle">
            Text in {'{{ }}'} is replaced with data from the run, e.g. {'{{ $trigger.payload.quoteNumber }}'}.
          </p>
        )}
      </div>

      <div className="rounded-xl border border-border bg-surface-muted p-3 space-y-2">
        <div className="flex items-start gap-1.5 text-[11px] text-ink leading-relaxed">
          <ShieldCheck className="h-3.5 w-3.5 mt-0.5 shrink-0 text-ink-muted" />
          {config.autoApprove === true ? (
            <p data-testid="agent-step-approval-note">
              This step is set to change records without asking, except in runs started by a webhook.{' '}
              <button
                type="button"
                data-testid="agent-step-ask-first-btn"
                onClick={() => onChange({ ...config, autoApprove: false })}
                className="font-semibold hover:underline cursor-pointer"
              >
                Ask first instead
              </button>
            </p>
          ) : (
            <p data-testid="agent-step-approval-note">
              The agent can look things up on its own. Before it creates or changes a record it stops and asks in
              Approvals. It can never do more than the person this automation runs as.
            </p>
          )}
        </div>
        {config.autoApprove !== true && (
          <div className="space-y-1">
            <label htmlFor="agent-step-wait" className="text-[11px] font-medium text-ink">
              Wait for an answer for
            </label>
            <select
              id="agent-step-wait"
              data-testid="agent-step-wait-select"
              value={waitKnown ? wait : ''}
              onChange={(e) => onChange({ ...config, timeoutDuration: e.target.value })}
              className={selectClass}
            >
              {!waitKnown && <option value="">{wait || 'Choose…'}</option>}
              {WAIT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <p className="text-[11px] text-ink-subtle">After that the step stops without making the change.</p>
          </div>
        )}
      </div>
    </div>
  );
}
