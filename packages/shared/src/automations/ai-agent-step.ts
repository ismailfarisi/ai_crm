import type { AutomationNode } from './types';

/**
 * One thing an AI agent step did, in the order it did them. `tool` is the
 * tool's name; `summary` is what the tool said about the outcome, in words.
 */
export interface AiAgentActionRecord {
  tool: string;
  /** DONE: ran. FAILED: the tool refused or errored. REJECTED / TIMED_OUT: a person did not approve it. */
  status: 'DONE' | 'FAILED' | 'REJECTED' | 'TIMED_OUT';
  summary: string;
  /** True when the tool creates or changes a record. */
  changedData: boolean;
  /** True when a person approved it; false when it ran without asking. */
  approved?: boolean;
}

/** The agent a step ran as; null fields mean the organisation's defaults. */
export interface AiAgentStepAgent {
  id: string;
  name: string;
}

/**
 * A staff agent an automation step can run as, for the step's picker. Leaves
 * out the agent's instructions: picking an agent needs less than editing one.
 */
export interface AutomationAgentOptionDto {
  id: string;
  name: string;
  description: string;
  /** False when the agent is switched off in Settings; a step using it fails. */
  isEnabled: boolean;
  /** Tool names the agent was given. A run narrows them to what its user may do. */
  tools: string[];
}

export const AI_AGENT_STEP_NO_TASK =
  'This step has no task. Say what the agent should do.';

/** The task an agent step was given, trimmed; '' when it has none. */
export function aiAgentStepTask(node: Pick<AutomationNode, 'data'>): string {
  const goal = node.data?.config?.goal;
  return typeof goal === 'string' ? goal.trim() : '';
}

/** Why an agent step cannot run as configured, or null when it can. */
export function aiAgentStepProblem(
  node: Pick<AutomationNode, 'type' | 'data'>,
): string | null {
  if (node.type !== 'aiAgentNode') return null;
  return aiAgentStepTask(node) ? null : AI_AGENT_STEP_NO_TASK;
}

/**
 * Why an automation cannot be switched on because of its agent steps, or
 * null. Names the first step at fault so the person knows where to look.
 */
export function agentStepsActivationProblem(
  nodes: ReadonlyArray<Pick<AutomationNode, 'type' | 'data'>> | undefined,
): string | null {
  for (const node of nodes ?? []) {
    if (aiAgentStepProblem(node)) {
      const label = node.data?.label?.trim();
      return `The AI agent step${label ? ` "${label}"` : ''} has no task. Say what the agent should do before switching this automation on.`;
    }
  }
  return null;
}
