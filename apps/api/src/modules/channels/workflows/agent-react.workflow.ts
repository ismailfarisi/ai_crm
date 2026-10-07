import {
  proxyActivities,
  defineSignal,
  setHandler,
  condition,
  ApplicationFailure,
} from '@temporalio/workflow';
import type {
  AgentReactActivities,
  ToolCallSpec,
  ToolExecutionResult,
} from './activities/agent-react.activities';

const activities = proxyActivities<AgentReactActivities>({
  startToCloseTimeout: '45 seconds',
  retry: {
    maximumAttempts: 3,
  },
});

export const approvalSignal = defineSignal<[{ approved: boolean; note?: string }]>(
  'agentApprovalSignal',
);

export interface AgentReActWorkflowInput {
  organizationId: string;
  userId: string;
  conversationId: string;
  prompt: string;
  maxTurns?: number;
}

export interface AgentReActWorkflowOutput {
  status: 'COMPLETED' | 'AWAITING_APPROVAL' | 'REJECTED' | 'FAILED';
  finalResponse: string;
  stepsExecuted: number;
  pendingAction?: {
    tool: ToolCallSpec;
    preview: Record<string, unknown>;
  };
}

export async function agentReActWorkflow(
  input: AgentReActWorkflowInput,
): Promise<AgentReActWorkflowOutput> {
  const maxTurns = input.maxTurns ?? 6;
  let turns = 0;
  let isDone = false;
  let finalResponse = '';

  let approvalResult: { approved: boolean; note?: string } | null = null;
  setHandler(approvalSignal, (signal) => {
    approvalResult = signal;
  });

  const history: Array<{ role: 'user' | 'assistant' | 'tool'; content: string }> = [
    { role: 'user', content: input.prompt },
  ];

  while (!isDone && turns < maxTurns) {
    turns++;

    const turn = await activities.planReActTurn({
      organizationId: input.organizationId,
      userId: input.userId,
      prompt: input.prompt,
      conversationHistory: history,
      availableTools: [],
    });

    if (turn.finalAnswer && (!turn.toolCalls || turn.toolCalls.length === 0)) {
      finalResponse = turn.finalAnswer;
      isDone = true;
      break;
    }

    if (turn.toolCalls && turn.toolCalls.length > 0) {
      for (const tool of turn.toolCalls) {
        const execution = await activities.executeToolActivity(tool, {
          organizationId: input.organizationId,
          userId: input.userId,
        });

        if (execution.requiresApproval && execution.isMutating) {
          // Pause workflow and wait up to 48 hours for user signal
          const approved = await condition(() => approvalResult !== null, '48 hours');

          const currentApproval = approvalResult as { approved: boolean; note?: string } | null;
          if (!approved || !currentApproval?.approved) {
            return {
              status: 'REJECTED',
              finalResponse: `Action ${tool.name} was rejected by user.`,
              stepsExecuted: turns,
            };
          }

          // User approved -> execute commit
          const commit = await activities.commitToolMutationActivity(tool, {
            organizationId: input.organizationId,
            userId: input.userId,
          });

          history.push({
            role: 'tool',
            content: JSON.stringify(commit),
          });
        } else {
          history.push({
            role: 'tool',
            content: JSON.stringify(execution.output ?? { error: execution.errorMessage }),
          });
        }
      }
    }
  }

  return {
    status: 'COMPLETED',
    finalResponse: finalResponse || 'Execution finished.',
    stepsExecuted: turns,
  };
}
