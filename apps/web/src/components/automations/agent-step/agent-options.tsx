'use client';

import { createContext, useContext } from 'react';
import { agentStepsActivationProblem } from '@saas/shared';
import type { AutomationAgentOptionDto, AutomationNode } from '@saas/shared';

/**
 * The staff agents an AI agent step can run as. The studio page loads them
 * once and both the step's settings and its card on the canvas read them here.
 * Undefined while they load, or where nothing provides them.
 */
export const AgentOptionsContext = createContext<AutomationAgentOptionDto[] | undefined>(undefined);

export function useAgentOptions(): AutomationAgentOptionDto[] | undefined {
  return useContext(AgentOptionsContext);
}

export type AgentChoice =
  | { state: 'none' }
  | { state: 'loading' }
  | { state: 'ok'; agent: AutomationAgentOptionDto }
  | { state: 'off'; agent: AutomationAgentOptionDto }
  | { state: 'missing' };

/** What the step's saved agent is right now: fine, switched off, or gone. */
export function agentChoice(
  agentId: unknown,
  options: AutomationAgentOptionDto[] | undefined,
): AgentChoice {
  if (typeof agentId !== 'string' || !agentId) return { state: 'none' };
  if (!options) return { state: 'loading' };
  const agent = options.find((option) => option.id === agentId);
  if (!agent) return { state: 'missing' };
  return agent.isEnabled ? { state: 'ok', agent } : { state: 'off', agent };
}

export const AGENT_MISSING = 'The agent this step used no longer exists. Pick another one.';

export function agentOffMessage(name: string): string {
  return `"${name}" is switched off in Settings → AI. Switch it on there or pick another agent.`;
}

/** Why the step's agent stops the automation being switched on, if it does. */
export function agentChoiceProblem(choice: AgentChoice): string | null {
  if (choice.state === 'missing') return AGENT_MISSING;
  if (choice.state === 'off') return agentOffMessage(choice.agent.name);
  return null;
}

/**
 * Why the automation can't be switched on because of an AI agent step: one
 * has no task, or its agent is gone or switched off. The API checks the same.
 */
export function agentStepsProblem(
  nodes: ReadonlyArray<Pick<AutomationNode, 'type' | 'data'>>,
  options: AutomationAgentOptionDto[] | undefined,
): string | null {
  const noTask = agentStepsActivationProblem(nodes);
  if (noTask) return noTask;
  for (const node of nodes) {
    if (node.type !== 'aiAgentNode') continue;
    const problem = agentChoiceProblem(agentChoice(node.data?.config?.agentId, options));
    if (problem) {
      const label = node.data?.label?.trim();
      return `AI agent step${label ? ` "${label}"` : ''}: ${problem}`;
    }
  }
  return null;
}
