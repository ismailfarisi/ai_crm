import React, { useState } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ReactFlowProvider } from '@xyflow/react';
import type { AutomationAgentOptionDto, AutomationNode } from '@saas/shared';
import { AgentOptionsContext, agentStepsProblem } from './agent-options';
import { AiAgentStepFields, AGENT_TASK_EXAMPLES } from './ai-agent-step-fields';
import { AgentStepResult, readAgentStepOutput } from './agent-step-result';
import { NodeInspectorDrawer } from '../drawers/node-inspector-drawer';
import { ActionNode } from '../nodes/action-node';
import { NODE_PALETTE_ITEMS } from '../drawers/node-palette-drawer';
import { DEFAULT_NODE_CONFIGS } from '@/hooks/use-automation-canvas';

const chaser: AutomationAgentOptionDto = {
  id: 'agent-1',
  name: 'Quote chaser',
  description: 'Follows up quotes nobody answered',
  isEnabled: true,
  tools: ['quote.lookup', 'quote.create'],
};
const retired: AutomationAgentOptionDto = {
  id: 'agent-2',
  name: 'Old helper',
  description: '',
  isEnabled: false,
  tools: [],
};

const agentNode = (config: Record<string, unknown>, label = 'Chase quote'): AutomationNode => ({
  id: 'agent',
  type: 'aiAgentNode',
  position: { x: 0, y: 0 },
  data: { label, config },
});

/** The inspector over a node whose edits are kept, as the studio page keeps them. */
function Inspector({
  initial,
  options = [chaser, retired],
  onConfig,
}: {
  initial: Record<string, unknown>;
  options?: AutomationAgentOptionDto[];
  onConfig?: (config: Record<string, unknown>) => void;
}) {
  const [node, setNode] = useState(agentNode(initial));
  return (
    <AgentOptionsContext.Provider value={options}>
      <NodeInspectorDrawer
        node={node}
        allNodes={[node]}
        onClose={vi.fn()}
        onUpdate={(_id, data) => {
          // Merges config key by key, as the canvas's updateNodeData does.
          setNode((current) => ({
            ...current,
            data: {
              ...current.data,
              ...data,
              config: { ...current.data.config, ...(data.config ?? {}) },
            },
          }));
          if (data.config) onConfig?.(data.config);
        }}
      />
    </AgentOptionsContext.Provider>
  );
}

describe('AI agent step settings', () => {
  it('a step fresh from the palette says it has no task and that it blocks switching on', () => {
    render(<Inspector initial={DEFAULT_NODE_CONFIGS.aiAgentNode} />);

    expect(screen.getByTestId('agent-step-task-problem').textContent).toBe(
      "This step has no task. Say what the agent should do. The automation can't be switched on until it does.",
    );
    expect(screen.getByTestId('agent-step-task-input').getAttribute('aria-invalid')).toBe('true');
  });

  it('a task of only spaces still counts as no task', () => {
    render(<Inspector initial={{ goal: '   ' }} />);

    expect(screen.queryByTestId('agent-step-task-problem')).not.toBeNull();
  });

  it('typing a task saves it as the goal and clears the warning', () => {
    const onConfig = vi.fn();
    render(<Inspector initial={{ goal: '', autoApprove: false }} onConfig={onConfig} />);

    fireEvent.change(screen.getByTestId('agent-step-task-input'), {
      target: { value: 'Follow up the quote' },
    });

    expect(onConfig).toHaveBeenLastCalledWith({ goal: 'Follow up the quote', autoApprove: false });
    expect(screen.queryByTestId('agent-step-task-problem')).toBeNull();
  });

  it('an example fills the task with data from the trigger', () => {
    const onConfig = vi.fn();
    render(<Inspector initial={{ goal: '' }} onConfig={onConfig} />);

    fireEvent.click(screen.getAllByTestId('agent-step-example-btn')[0]);

    expect(onConfig).toHaveBeenLastCalledWith({ goal: AGENT_TASK_EXAMPLES[0].task });
    expect(AGENT_TASK_EXAMPLES[0].task).toContain('{{ $trigger.payload.quoteNumber }}');
  });

  it('inserts data from an earlier step at the end of the task', () => {
    const onConfig = vi.fn();
    render(<Inspector initial={{ goal: 'Follow up quote' }} onConfig={onConfig} />);

    expect(screen.queryByTestId('expression-helper')).toBeNull();
    fireEvent.click(screen.getByTestId('agent-step-insert-data-btn'));
    fireEvent.click(screen.getByTestId('tab-json'));
    fireEvent.click(screen.getByTestId('variable-item-$json.name'));

    expect(onConfig).toHaveBeenLastCalledWith({ goal: 'Follow up quote {{ $json.name }}' });
  });

  it('lists only agents that are switched on, after the general assistant', () => {
    render(<Inspector initial={{ goal: 'x' }} />);

    const select = screen.getByTestId('agent-step-agent-select') as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual([
      'General assistant',
      'Quote chaser',
    ]);
    expect(select.value).toBe('');
  });

  it('picking an agent saves its id, drops the domain limit and shows its tools', () => {
    const onConfig = vi.fn();
    render(
      <Inspector initial={{ goal: 'x', allowedDomains: ['SALES', 'GENERAL'] }} onConfig={onConfig} />,
    );

    fireEvent.change(screen.getByTestId('agent-step-agent-select'), { target: { value: 'agent-1' } });

    expect(onConfig).toHaveBeenLastCalledWith({ goal: 'x', agentId: 'agent-1', allowedDomains: null });
    expect((screen.getByTestId('agent-step-agent-select') as HTMLSelectElement).value).toBe('agent-1');
    const summary = screen.getByTestId('agent-step-agent-summary').textContent;
    expect(summary).toContain('Follows up quotes nobody answered');
    expect(summary).toContain('Tools: Quote lookup, Quote create.');
  });

  it('going back to the general assistant removes the agent and restores the domain limit', () => {
    const onConfig = vi.fn();
    render(<Inspector initial={{ goal: 'x', agentId: 'agent-1' }} onConfig={onConfig} />);

    fireEvent.change(screen.getByTestId('agent-step-agent-select'), { target: { value: '' } });

    expect(onConfig).toHaveBeenLastCalledWith({
      goal: 'x',
      agentId: null,
      allowedDomains: ['SALES', 'GENERAL'],
    });
    // The step's own config is merged, not replaced: the choice must stick.
    expect((screen.getByTestId('agent-step-agent-select') as HTMLSelectElement).value).toBe('');
    expect(screen.queryByTestId('agent-step-agent-summary')).toBeNull();
  });

  it('says so when the saved agent was deleted', () => {
    render(<Inspector initial={{ goal: 'x', agentId: 'gone' }} />);

    expect(screen.getByTestId('agent-step-agent-problem').textContent).toBe(
      'The agent this step used no longer exists. Pick another one.',
    );
    expect((screen.getByTestId('agent-step-agent-select') as HTMLSelectElement).value).toBe('gone');
  });

  it('says so when the saved agent is switched off, and still shows which one', () => {
    render(<Inspector initial={{ goal: 'x', agentId: 'agent-2' }} />);

    expect(screen.getByTestId('agent-step-agent-problem').textContent).toBe(
      '"Old helper" is switched off in Settings → AI. Switch it on there or pick another agent.',
    );
    const select = screen.getByTestId('agent-step-agent-select') as HTMLSelectElement;
    expect(select.selectedOptions[0].textContent).toBe('Old helper (switched off)');
  });

  it('raises no agent problem while the agents are still loading', () => {
    render(
      <AgentOptionsContext.Provider value={undefined}>
        <AiAgentStepFields
          config={{ goal: 'x', agentId: 'agent-1' }}
          onChange={vi.fn()}
          showVariables={false}
          onToggleVariables={vi.fn()}
        />
      </AgentOptionsContext.Provider>,
    );

    expect(screen.queryByTestId('agent-step-agent-problem')).toBeNull();
  });

  it('points to Settings when there is no agent to pick', () => {
    render(<Inspector initial={{ goal: 'x' }} options={[]} />);

    expect(screen.getByText(/You have no agents for staff work yet/)).not.toBeNull();
    expect(screen.getByRole('link', { name: 'Manage agents in Settings → AI' }).getAttribute('href')).toBe(
      '/settings/ai',
    );
  });

  it('says changes wait for approval and lets the wait be set', () => {
    const onConfig = vi.fn();
    render(<Inspector initial={{ goal: 'x', timeoutDuration: '3 days' }} onConfig={onConfig} />);

    expect(screen.getByTestId('agent-step-approval-note').textContent).toContain(
      'Before it creates or changes a record it stops and asks in Approvals',
    );
    fireEvent.change(screen.getByTestId('agent-step-wait-select'), { target: { value: '1 day' } });
    expect(onConfig).toHaveBeenLastCalledWith({ goal: 'x', timeoutDuration: '1 day' });
  });

  it('keeps a wait saved in another form visible rather than showing a different one', () => {
    render(<Inspector initial={{ goal: 'x', timeoutDuration: '30m' }} />);

    const select = screen.getByTestId('agent-step-wait-select') as HTMLSelectElement;
    expect(select.selectedOptions[0].textContent).toBe('30m');
  });

  it('a step already set to act without asking says so and can be set back', () => {
    const onConfig = vi.fn();
    render(<Inspector initial={{ goal: 'x', autoApprove: true }} onConfig={onConfig} />);

    expect(screen.getByTestId('agent-step-approval-note').textContent).toContain(
      'This step is set to change records without asking',
    );
    expect(screen.queryByTestId('agent-step-wait-select')).toBeNull();
    fireEvent.click(screen.getByTestId('agent-step-ask-first-btn'));
    expect(onConfig).toHaveBeenLastCalledWith({ goal: 'x', autoApprove: false });
  });

  it('the palette entry and new step start with approvals on and no task', () => {
    const item = NODE_PALETTE_ITEMS.find((entry) => entry.type === 'aiAgentNode');
    expect(item?.label).toBe('AI agent');
    expect(DEFAULT_NODE_CONFIGS.aiAgentNode).toMatchObject({ goal: '', autoApprove: false, timeoutDuration: '3 days' });
  });
});

describe('agentStepsProblem', () => {
  const trigger = { type: 'manualTrigger', data: { label: 'Start', config: {} } } as AutomationNode;

  it('is null with no agent step, and with one that has a task and a usable agent', () => {
    expect(agentStepsProblem([trigger], [chaser])).toBeNull();
    expect(agentStepsProblem([trigger, agentNode({ goal: 'x', agentId: 'agent-1' })], [chaser])).toBeNull();
    expect(agentStepsProblem([agentNode({ goal: 'x' })], [])).toBeNull();
  });

  it('names the step that has no task', () => {
    expect(agentStepsProblem([trigger, agentNode({ goal: ' ' })], [chaser])).toBe(
      'The AI agent step "Chase quote" has no task. Say what the agent should do before switching this automation on.',
    );
  });

  it('names the step whose agent is gone or switched off', () => {
    expect(agentStepsProblem([agentNode({ goal: 'x', agentId: 'gone' })], [chaser])).toBe(
      'AI agent step "Chase quote": The agent this step used no longer exists. Pick another one.',
    );
    expect(agentStepsProblem([agentNode({ goal: 'x', agentId: 'agent-2' })], [chaser, retired])).toContain(
      '"Old helper" is switched off',
    );
  });

  it('does not block on the agent while the agents are still loading', () => {
    expect(agentStepsProblem([agentNode({ goal: 'x', agentId: 'agent-1' })], undefined)).toBeNull();
  });
});

describe('AI agent step on the canvas', () => {
  const renderNode = (config: Record<string, unknown>, options: AutomationAgentOptionDto[] | undefined = [chaser, retired]) =>
    render(
      <ReactFlowProvider>
        <AgentOptionsContext.Provider value={options}>
          <ActionNode type="aiAgentNode" data={{ label: 'Chase quote', config }} />
        </AgentOptionsContext.Provider>
      </ReactFlowProvider>,
    );

  it('shows the agent and the task instead of "Generic Action"', () => {
    renderNode({ goal: 'Follow up quote {{ $trigger.payload.quoteNumber }}', agentId: 'agent-1' });

    expect(screen.getByTestId('agent-node-agent').textContent).toBe('Quote chaser');
    expect(screen.getByTestId('agent-node-task').textContent).toBe(
      'Follow up quote {{ $trigger.payload.quoteNumber }}',
    );
    expect(screen.queryByText('Generic Action')).toBeNull();
    expect(screen.queryByTestId('agent-node-problem')).toBeNull();
  });

  it('flags a step with no task', () => {
    renderNode({ goal: '' });

    expect(screen.getByTestId('agent-node-agent').textContent).toBe('General assistant');
    expect(screen.getByTestId('agent-node-problem').textContent).toBe('Needs a task');
  });

  it('flags an agent that is switched off or deleted', () => {
    const { unmount } = renderNode({ goal: 'x', agentId: 'agent-2' });
    expect(screen.getByTestId('agent-node-problem').textContent).toBe('Agent is switched off');
    unmount();

    renderNode({ goal: 'x', agentId: 'gone' });
    expect(screen.getByTestId('agent-node-problem').textContent).toBe('Pick another agent');
  });

  it('renders with no agents provided', () => {
    renderNode({ goal: 'x', agentId: 'agent-1' }, undefined);

    expect(screen.queryByTestId('agent-node-problem')).toBeNull();
  });
});

describe('AgentStepResult', () => {
  const output = {
    success: true,
    status: 'COMPLETED',
    solution: 'I drafted a follow-up for Q-104.',
    agent: { id: 'agent-1', name: 'Quote chaser' },
    model: 'model-x',
    actions: [
      { tool: 'quote.lookup', status: 'DONE', summary: 'Q-104, sent 9 days ago', changedData: false },
      { tool: 'quote.create', status: 'DONE', summary: 'Created Q-105', changedData: true, approved: true },
      { tool: 'contact.update', status: 'REJECTED', summary: 'Not done, it was rejected', changedData: false },
      { tool: 'quote.send', status: 'TIMED_OUT', summary: 'Not done, nobody approved it in time', changedData: false },
      { tool: 'note.add', status: 'DONE', summary: 'Added a note', changedData: true, approved: false },
    ],
  };

  it('lists each thing the agent did, in order, with what changed a record', () => {
    render(<AgentStepResult output={output} />);

    const rows = screen.getAllByTestId('agent-step-action').map((row) => row.textContent);
    expect(rows).toEqual([
      'Quote lookupDoneQ-104, sent 9 days ago',
      'Quote createChanged a record · approvedDoneCreated Q-105',
      'Contact updateRejectedNot done, it was rejected',
      'Quote sendNobody answeredNot done, nobody approved it in time',
      'Note addChanged a record · without askingDoneAdded a note',
    ]);
    expect(screen.getByTestId('agent-step-result').textContent).toContain('Ran as Quote chaser · model-x');
    expect(screen.getByTestId('agent-step-answer').textContent).toBe('I drafted a follow-up for Q-104.');
  });

  it('says so when the agent used no tools', () => {
    render(<AgentStepResult output={{ solution: 'Nothing to do.', actions: [] }} />);

    expect(screen.getByTestId('agent-step-result').textContent).toContain('Ran as General assistant');
    expect(screen.getByText('It used no tools and changed nothing.')).not.toBeNull();
  });

  it('shows the reason when the step ended on a rejection', () => {
    render(<AgentStepResult output={{ status: 'REJECTED', error: 'Action quote.send was rejected', actions: [] }} />);

    expect(screen.getByTestId('agent-step-answer').textContent).toBe('Action quote.send was rejected');
  });

  it('shows nothing for a run recorded before steps kept what the agent did', () => {
    const { container } = render(<AgentStepResult output={{ solution: 'done', stepsTaken: 2 }} />);

    expect(container.innerHTML).toBe('');
    expect(readAgentStepOutput(undefined)).toBeNull();
  });

  it('skips a malformed action rather than failing the run page', () => {
    const read = readAgentStepOutput({ actions: [null, { tool: 'x' }, { tool: 'y', status: 'DONE' }] });

    expect(read?.actions).toEqual([{ tool: 'y', status: 'DONE' }]);
  });
});
