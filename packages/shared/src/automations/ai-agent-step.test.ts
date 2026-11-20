import { describe, expect, it } from 'vitest';
import {
  AI_AGENT_STEP_NO_TASK,
  agentStepsActivationProblem,
  aiAgentStepProblem,
  aiAgentStepTask,
} from './ai-agent-step';
import type { AutomationNode } from './types';

const step = (
  type: AutomationNode['type'],
  config: Record<string, unknown>,
  label = 'Chase quote',
): AutomationNode => ({
  id: 'n1',
  type,
  position: { x: 0, y: 0 },
  data: { label, config },
});

describe('AI agent step task', () => {
  it('reads the task trimmed, and treats a missing or non-text task as none', () => {
    expect(aiAgentStepTask(step('aiAgentNode', { goal: '  Follow up  ' }))).toBe('Follow up');
    expect(aiAgentStepTask(step('aiAgentNode', {}))).toBe('');
    expect(aiAgentStepTask(step('aiAgentNode', { goal: 42 }))).toBe('');
  });

  it('flags an agent step with no task, and only an agent step', () => {
    expect(aiAgentStepProblem(step('aiAgentNode', { goal: '   ' }))).toBe(AI_AGENT_STEP_NO_TASK);
    expect(aiAgentStepProblem(step('aiAgentNode', { goal: 'Do it' }))).toBeNull();
    expect(aiAgentStepProblem(step('aiPromptNode', {}))).toBeNull();
  });

  it('names the step that blocks switching the automation on', () => {
    expect(
      agentStepsActivationProblem([
        step('manualTrigger', {}),
        step('aiAgentNode', { goal: 'Do it' }, 'Fine'),
        step('aiAgentNode', { goal: '' }, 'Chase quote'),
      ]),
    ).toBe(
      'The AI agent step "Chase quote" has no task. Say what the agent should do before switching this automation on.',
    );
    expect(agentStepsActivationProblem([step('aiAgentNode', { goal: 'Do it' })])).toBeNull();
    expect(agentStepsActivationProblem(undefined)).toBeNull();
  });
});
