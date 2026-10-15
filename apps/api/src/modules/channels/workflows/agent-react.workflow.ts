import {
  proxyActivities,
  defineSignal,
  setHandler,
  condition,
  getExternalWorkflowHandle,
  isCancellation,
} from '@temporalio/workflow';
import { APPROVED_ACTION_CHANGED } from './activities/agent-react.activities';
import type {
  AgentReactActivities,
  AssistantEventInput,
  ToolAuditProvenance,
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

/**
 * `toolId` binds a decision to one gated tool call: a signal naming a
 * different call (or arriving while nothing is awaited) is ignored. Signals
 * without it — the automation parent's relay — keep the original behaviour.
 */
export interface ApprovalSignalPayload {
  approved: boolean;
  note?: string;
  toolId?: string;
}

export const approvalSignal = defineSignal<[ApprovalSignalPayload]>(
  'agentApprovalSignal',
);

/** Sends a customer message: never auto-approved, whatever the caller asked for. */
const ALWAYS_ASK_TOOLS = new Set(['channel_message.send']);

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
  /** Earlier user/assistant messages of an in-app conversation, oldest first. */
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
  /** What the user was looking at. A hint for the planner — tools still check access. */
  pageContext?: { entity: string; id: string; label?: string };
  /** Present for in-app assistant turns: every step is reported through emitAssistantEventActivity. */
  eventSink?: { conversationId: string; turnId: string };
  /** Provenance recorded on committed mutations. Defaults to SYSTEM. */
  audit?: ToolAuditProvenance;
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

function goalWithContext(input: AgentReActWorkflowInput): string {
  if (!input.pageContext) return input.prompt;
  const { entity, id, label } = input.pageContext;
  return `${input.prompt}\n\n(The user is currently viewing ${entity} ${label ?? id} (id ${id}).)`;
}

/** The user-facing message of a commit refused because the approved action changed. */
function approvedActionChangedMessage(error: unknown): string | null {
  const cause = (error as { cause?: { type?: unknown; message?: unknown } } | null)?.cause;
  return cause?.type === APPROVED_ACTION_CHANGED && typeof cause.message === 'string'
    ? cause.message
    : null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.cause instanceof Error
      ? error.cause.message
      : error.message
    : String(error);
}

type Emit = (
  event: Omit<AssistantEventInput, 'organizationId' | 'conversationId' | 'turnId'>,
) => Promise<void>;

export async function agentReActWorkflow(
  input: AgentReActWorkflowInput,
): Promise<AgentReActWorkflowOutput> {
  const emit: Emit = async (event) => {
    if (!input.eventSink) return;
    await activities.emitAssistantEventActivity({
      organizationId: input.organizationId,
      conversationId: input.eventSink.conversationId,
      turnId: input.eventSink.turnId,
      ...event,
    });
  };

  let result: AgentReActWorkflowOutput;
  try {
    result = await runAgentLoop(input, emit);
  } catch (error) {
    if (!input.eventSink || isCancellation(error)) throw error;
    result = {
      status: 'FAILED',
      finalResponse:
        approvedActionChangedMessage(error) ?? 'Something went wrong while working on that.',
      stepsExecuted: 0,
    };
    await emit({
      eventKey: 'final',
      role: 'assistant',
      content: result.finalResponse,
      turn: { status: 'FAILED', pendingAction: null, error: errorMessage(error) },
    });
    return result;
  }
  await emit({
    eventKey: 'final',
    role: 'assistant',
    content: result.finalResponse,
    turn: { status: result.status, pendingAction: null, steps: result.stepsExecuted },
  });
  return result;
}

async function runAgentLoop(
  input: AgentReActWorkflowInput,
  emit: Emit,
): Promise<AgentReActWorkflowOutput> {
  const maxTurns = input.maxTurns ?? 6;
  let turns = 0;
  let isDone = false;
  let finalResponse = '';
  const goal = goalWithContext(input);
  // Assistant turns may use assistant-only skills; anything else is an
  // automation. The field is omitted (not undefined) on the automation path
  // so its activity inputs keep their original shape.
  const surface = input.eventSink ? { surface: 'assistant' as const } : {};
  const toolCtx = {
    organizationId: input.organizationId,
    userId: input.userId,
    message: input.prompt,
    ...(input.audit ? { audit: input.audit } : {}),
    ...surface,
  };

  const approvalQueue: ApprovalSignalPayload[] = [];
  // The gated tool call currently waiting for a decision, if any.
  let awaitingToolId: string | undefined;
  setHandler(approvalSignal, (signal) => {
    // Handler-only logic: adds no Temporal commands, so replay is unaffected.
    if (signal.toolId !== undefined && signal.toolId !== awaitingToolId) return;
    if (signal.approved && approvalQueue.length === 0) {
      approvalQueue.push(signal);
    } else if (!signal.approved) {
      approvalQueue.splice(0, approvalQueue.length, signal);
    }
  });

  const history: Array<{ role: 'user' | 'assistant' | 'tool'; content: string }> = [
    ...(input.history ?? []),
    { role: 'user', content: goal },
  ];

  while (!isDone && turns < maxTurns) {
    turns++;
    const availableTools = await activities.listAvailableTools({
      organizationId: input.organizationId,
      userId: input.userId,
      allowedDomains: input.allowedDomains,
      ...surface,
    });

    const turn = await activities.planReActTurn({
      organizationId: input.organizationId,
      userId: input.userId,
      prompt: goal,
      conversationHistory: history,
      availableTools,
    });
    if (turn.thought) {
      await emit({
        eventKey: `t${turns}:thought`,
        role: 'step',
        content: turn.thought,
        turn: { steps: turns, ...(turn.model ? { model: turn.model } : {}) },
      });
    }

    if (turn.finalAnswer && (!turn.toolCalls || turn.toolCalls.length === 0)) {
      finalResponse = turn.finalAnswer;
      isDone = true;
      break;
    }

    if (turn.toolCalls && turn.toolCalls.length > 0) {
      for (const plannedTool of turn.toolCalls) {
        let tool: ToolCallSpec = turn.model ? { ...plannedTool, model: turn.model } : plannedTool;
        await emit({
          eventKey: `t${turns}:call:${tool.id}`,
          role: 'tool_call',
          content: `Using ${tool.name}`,
          toolName: tool.name,
          payload: { args: tool.args },
        });
        const execution = await activities.executeToolActivity(tool, toolCtx);

        if (execution.requiresApproval && execution.isMutating) {
          // What was resolved is what is shown and what is committed: the
          // skill's pinned args replace the planner's before the approval.
          if (execution.resolvedArgs) {
            tool = { ...tool, args: execution.resolvedArgs, pinned: true };
          }
          const approvedPreview = execution.previewPayload ?? {};
          if (!input.autoApprove || ALWAYS_ASK_TOOLS.has(tool.name)) {
            // Only a decision made while this call is awaited counts: drop any
            // stray decision that arrived earlier, and bind the wait to its id.
            approvalQueue.length = 0;
            awaitingToolId = tool.id;
            if (input.parentWorkflowId && input.automationNodeId) {
              await getExternalWorkflowHandle(input.parentWorkflowId).signal(
                agentApprovalRequestedSignal,
                { nodeId: input.automationNodeId, tool, preview: execution.previewPayload ?? {} },
              );
            }
            const pendingAction = {
              tool: { id: tool.id, name: tool.name, args: tool.args },
              preview: execution.previewPayload ?? {},
            };
            await emit({
              eventKey: `t${turns}:approval:${tool.id}`,
              role: 'approval',
              content:
                typeof pendingAction.preview.summary === 'string'
                  ? pendingAction.preview.summary
                  : `Approve ${tool.name}?`,
              toolName: tool.name,
              payload: pendingAction,
              turn: { status: 'AWAITING_APPROVAL', pendingAction },
            });

            const approved = await condition(
              () => approvalQueue.length > 0,
              approvalTimeoutToMilliseconds(input.approvalTimeout),
            );
            awaitingToolId = undefined;
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
            await emit({
              eventKey: `t${turns}:approved:${tool.id}`,
              role: 'step',
              content: `Approved ${tool.name}`,
              toolName: tool.name,
              turn: { status: 'RUNNING', pendingAction: null },
            });
          }

          await emit({
            eventKey: `t${turns}:committing:${tool.id}`,
            role: 'step',
            content: `Running ${tool.name}`,
            toolName: tool.name,
          });
          const commit = await commitActivities.commitToolMutationActivity(
            tool,
            input.eventSink ? { ...toolCtx, approvedPreview } : toolCtx,
          );
          await emit({
            eventKey: `t${turns}:result:${tool.id}`,
            role: 'tool_result',
            content: commit.resultSummary,
            toolName: tool.name,
            payload: commit,
          });
          history.push({ role: 'tool', content: JSON.stringify(commit) });
        } else {
          const output = execution.output ?? { error: execution.errorMessage };
          const reply =
            typeof output.reply === 'string'
              ? output.reply
              : typeof output.error === 'string'
                ? output.error
                : `${tool.name} finished`;
          await emit({
            eventKey: `t${turns}:result:${tool.id}`,
            role: 'tool_result',
            content: reply,
            toolName: tool.name,
            payload: output,
          });
          history.push({ role: 'tool', content: JSON.stringify(output) });
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
