import {
  proxyActivities,
  defineSignal,
  setHandler,
  condition,
  getExternalWorkflowHandle,
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
const commitActivities = proxyActivities<
  Pick<AgentReactActivities, 'commitToolMutationActivity'>
>({
  startToCloseTimeout: '5 minutes',
  retry: {
    maximumAttempts: 1,
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
  parentWorkflowId?: string;
  automationNodeId?: string;
  autoApprove?: boolean;
  allowedDomains?: string[];
  approvalTimeout?: string;
  maxTurns?: number;
}

export interface AgentReActWorkflowOutput {
  status:
    | 'COMPLETED'
    | 'AWAITING_APPROVAL'
    | 'REJECTED'
    | 'TIMED_OUT'
    | 'FAILED';
  finalResponse: string;
  stepsExecuted: number;
  pendingAction?: {
    tool: ToolCallSpec;
    preview: Record<string, unknown>;
  };
}

function approvalTimeoutToMilliseconds(timeout?: string): number {
  const value = timeout ?? '48 hours';
  const match =
    /^(\d+(?:\.\d+)?)\s*(milliseconds?|seconds?|minutes?|hours?|days?)$/i.exec(
      value.trim(),
    );
  if (!match) {
    throw new Error(`Invalid approval timeout '${value}'`);
  }

  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  const multiplier = unit.startsWith('millisecond')
    ? 1
    : unit.startsWith('second')
      ? 1_000
      : unit.startsWith('minute')
        ? 60_000
        : unit.startsWith('hour')
          ? 3_600_000
          : 86_400_000;
  const duration = amount * multiplier;
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error(`Invalid approval timeout '${value}'`);
  }
  return duration;
}

export async function agentReActWorkflow(
  input: AgentReActWorkflowInput,
): Promise<AgentReActWorkflowOutput> {
  const maxTurns = input.maxTurns ?? 6;
  let turns = 0;
  let isDone = false;
  let finalResponse = '';

  const approvalQueue: Array<{ approved: boolean; note?: string }> = [];
  setHandler(approvalSignal, (signal) => {
    if (signal.approved && approvalQueue.length === 0) {
      approvalQueue.push(signal);
    } else if (!signal.approved) {
      approvalQueue.splice(0, approvalQueue.length, signal);
    }
  });

  const history: Array<{ role: 'user' | 'assistant' | 'tool'; content: string }> = [
    { role: 'user', content: input.prompt },
  ];

  while (!isDone && turns < maxTurns) {
    turns++;
    const availableTools = await activities.listAvailableTools({
      organizationId: input.organizationId,
      userId: input.userId,
      allowedDomains: input.allowedDomains,
    });

    const turn = await activities.planReActTurn({
      organizationId: input.organizationId,
      userId: input.userId,
      prompt: input.prompt,
      conversationHistory: history,
      availableTools,
    });

    if (turn.finalAnswer && (!turn.toolCalls || turn.toolCalls.length === 0)) {
      finalResponse = turn.finalAnswer;
      isDone = true;
      break;
    }

    if (turn.toolCalls && turn.toolCalls.length > 0) {
      for (const plannedTool of turn.toolCalls) {
        const tool = turn.model
          ? { ...plannedTool, model: turn.model }
          : plannedTool;
        const execution = await activities.executeToolActivity(tool, {
          organizationId: input.organizationId,
          userId: input.userId,
          message: input.prompt,
        });

        if (execution.requiresApproval && execution.isMutating) {
          if (!input.autoApprove) {
            if (input.parentWorkflowId && input.automationNodeId) {
              await getExternalWorkflowHandle(input.parentWorkflowId).signal(
                agentApprovalRequestedSignal,
                {
                  nodeId: input.automationNodeId,
                  tool,
                  preview: execution.previewPayload ?? {},
                },
              );
            }

            const approved = await condition(
              () => approvalQueue.length > 0,
              approvalTimeoutToMilliseconds(input.approvalTimeout),
            );
            const currentApproval = approvalQueue.shift();
            if (!approved) {
              return {
                status: 'TIMED_OUT',
                finalResponse: `Approval for ${tool.name} timed out.`,
                stepsExecuted: turns,
              };
            }
            if (!currentApproval?.approved) {
              return {
                status: 'REJECTED',
                finalResponse: currentApproval?.note
                  ? `Action ${tool.name} was rejected: ${currentApproval.note}`
                  : `Action ${tool.name} was rejected or approval timed out.`,
                stepsExecuted: turns,
              };
            }
          }

          const commit = await commitActivities.commitToolMutationActivity(tool, {
            organizationId: input.organizationId,
            userId: input.userId,
            message: input.prompt,
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
    status: isDone ? 'COMPLETED' : 'FAILED',
    finalResponse:
      finalResponse ||
      `Agent stopped after reaching the ${maxTurns}-turn limit without a final answer.`,
    stepsExecuted: turns,
  };
}

export const agentApprovalRequestedSignal = defineSignal<
  [{ nodeId: string; tool: ToolCallSpec; preview: Record<string, unknown> }]
>('agentApprovalRequested');
