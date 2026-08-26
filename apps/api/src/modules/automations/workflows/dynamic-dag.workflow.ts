import {
  condition,
  proxyActivities,
  setHandler,
  sleep,
} from '@temporalio/workflow';
import type { AutomationEdge, AutomationNode } from '@saas/shared';
import type * as activities from './automation.activities';
import { evaluateExpression, ExpressionContext, interpolateObject } from './expression-evaluator';
import {
  AiPromptActivityConfig,
  approveNodeSignal,
  CrmMutationActivityConfig,
  DynamicWorkflowInput,
  EmailActivityConfig,
  getExecutionStateQuery,
  HttpActivityConfig,
  NodeApprovalSignalPayload,
  NodeRejectionSignalPayload,
  PendingApprovalState,
  rejectNodeSignal,
  WorkflowExecutionState,
} from './interfaces';

const {
  executeHttpActivity,
  executeAiPromptActivity,
  executeEmailActivity,
  executeCodeTransformActivity,
  executeCrmMutationActivity,
  recordNodeResultActivity,
} = proxyActivities<typeof activities>({
  startToCloseTimeout: '5 minutes',
  retry: {
    maximumAttempts: 3,
  },
});

export async function dynamicDagWorkflow(
  input: DynamicWorkflowInput,
): Promise<WorkflowExecutionState> {
  const startedAt = new Date().toISOString();

  // In-memory maps for signal coordination
  const approvedNodes = new Map<string, NodeApprovalSignalPayload>();
  const rejectedNodes = new Map<string, NodeRejectionSignalPayload>();

  const executionState: WorkflowExecutionState = {
    executionId: input.executionId,
    workflowId: input.workflowId,
    tenantId: input.tenantId,
    status: 'RUNNING',
    currentNodeId: null,
    nodeResults: {},
    pendingApprovals: {},
    startedAt,
    finishedAt: null,
    errorMessage: null,
  };

  // Signal handlers
  setHandler(approveNodeSignal, (payload: NodeApprovalSignalPayload | string) => {
    const data: NodeApprovalSignalPayload =
      typeof payload === 'string' ? { nodeId: payload } : payload;
    approvedNodes.set(data.nodeId, data);
  });

  setHandler(rejectNodeSignal, (payload: NodeRejectionSignalPayload | string) => {
    const data: NodeRejectionSignalPayload =
      typeof payload === 'string' ? { nodeId: payload } : payload;
    rejectedNodes.set(data.nodeId, data);
  });

  // Query handler
  setHandler(getExecutionStateQuery, () => executionState);

  const nodesById = new Map<string, AutomationNode>(input.nodes.map((n) => [n.id, n]));
  const outgoingEdges = new Map<string, AutomationEdge[]>();

  for (const edge of input.edges) {
    const list = outgoingEdges.get(edge.source) || [];
    list.push(edge);
    outgoingEdges.set(edge.source, list);
  }

  // Determine starting trigger node
  let startNodeId = input.triggerNodeId;
  if (!startNodeId) {
    const triggerNode = input.nodes.find((n) =>
      ['webhookTrigger', 'scheduleTrigger', 'crmEventTrigger', 'manualTrigger'].includes(n.type),
    );
    if (triggerNode) {
      startNodeId = triggerNode.id;
    } else {
      // Find node with no incoming edges
      const targetIds = new Set(input.edges.map((e) => e.target));
      const rootNode = input.nodes.find((n) => !targetIds.has(n.id));
      startNodeId = rootNode ? rootNode.id : input.nodes[0]?.id;
    }
  }

  if (!startNodeId || !nodesById.has(startNodeId)) {
    executionState.status = 'COMPLETED';
    executionState.finishedAt = new Date().toISOString();
    return executionState;
  }

  // Queue holds { nodeId, previousOutput }
  const queue: Array<{ nodeId: string; previousOutput: any }> = [
    { nodeId: startNodeId, previousOutput: input.triggerPayload },
  ];

  const processedNodeIds = new Set<string>();

  while (queue.length > 0) {
    const { nodeId, previousOutput } = queue.shift()!;
    const node = nodesById.get(nodeId);

    if (!node) continue;

    executionState.currentNodeId = nodeId;
    const nodeStartTime = Date.now();
    const nodeStartedAtIso = new Date(nodeStartTime).toISOString();

    // Build execution context for expression interpolation
    const nodeContextMap: Record<
      string,
      { json?: any; data?: any; output?: any; [key: string]: any }
    > = {};

    for (const [id, res] of Object.entries(executionState.nodeResults)) {
      const nodeMeta = nodesById.get(id);
      const outputData = res.output ?? {};
      const jsonPayload =
        outputData && typeof outputData === 'object' && 'data' in outputData && outputData.data && typeof outputData.data === 'object'
          ? { ...outputData.data, ...outputData }
          : outputData;

      const nodeEntry = {
        json: jsonPayload,
        data: outputData,
        output: outputData,
        response: outputData,
        result: outputData,
      };

      nodeContextMap[id] = nodeEntry;
      if (nodeMeta?.data?.label) {
        nodeContextMap[nodeMeta.data.label] = nodeEntry;
      }
    }

    const prevJson =
      previousOutput && typeof previousOutput === 'object' && 'data' in previousOutput && previousOutput.data && typeof previousOutput.data === 'object'
        ? { ...previousOutput.data, ...previousOutput }
        : previousOutput ?? {};

    const context: ExpressionContext = {
      $json: prevJson,
      $trigger: input.triggerPayload ?? {},
      $node: nodeContextMap,
    };

    let nodeOutput: any = null;
    let branchHandle: string | null = null;
    let nodeError: string | undefined;

    try {
      // Interpolate node configuration
      const rawConfig = node.data?.config || {};
      const config = interpolateObject(rawConfig, context);

      switch (node.type) {
        case 'webhookTrigger':
        case 'scheduleTrigger':
        case 'crmEventTrigger':
        case 'manualTrigger':
          nodeOutput = input.triggerPayload;
          break;

        case 'httpRequestNode':
          nodeOutput = await executeHttpActivity(config as unknown as HttpActivityConfig);
          break;

        case 'aiPromptNode':
          nodeOutput = await executeAiPromptActivity(config as unknown as AiPromptActivityConfig);
          break;

        case 'sendEmailNode':
          nodeOutput = await executeEmailActivity(config as unknown as EmailActivityConfig);
          break;

        case 'transformNode':
          nodeOutput = await executeCodeTransformActivity({
            code: config.code || '',
            input: context.$json,
            context: config.context || context,
          });
          break;

        case 'crmMutateNode':
          nodeOutput = await executeCrmMutationActivity(
            config as unknown as CrmMutationActivityConfig,
          );
          break;

        case 'delayNode': {
          const duration = config.duration || config.delay || '1s';
          await sleep(duration);
          nodeOutput = { delayed: true, duration };
          break;
        }

        case 'conditionNode': {
          let conditionValue = false;
          if (config.expression !== undefined) {
            conditionValue = Boolean(evaluateExpression(config.expression, context));
          } else if (config.condition !== undefined) {
            conditionValue = Boolean(
              typeof config.condition === 'string'
                ? evaluateExpression(config.condition, context)
                : config.condition,
            );
          } else if (config.rules && Array.isArray(config.rules)) {
            conditionValue = config.rules.every((rule: any) =>
              Boolean(evaluateExpression(rule.expression || rule.condition, context)),
            );
          }

          nodeOutput = { result: conditionValue };
          branchHandle = conditionValue ? 'true' : 'false';
          break;
        }

        case 'approvalNode': {
          const timeoutDuration = node.data.timeoutDuration || config.timeoutDuration || '3 days';

          const pendingApproval: PendingApprovalState = {
            nodeId: node.id,
            nodeLabel: node.data.label || 'Approval Node',
            requestedAt: new Date().toISOString(),
            timeoutDuration,
            context: config,
          };

          executionState.status = 'WAITING_APPROVAL';
          executionState.pendingApprovals[node.id] = pendingApproval;
          executionState.nodeResults[node.id] = {
            status: 'WAITING',
            input: config,
            startedAt: nodeStartedAtIso,
          };

          await recordNodeResultActivity({
            executionId: input.executionId,
            workflowId: input.workflowId,
            tenantId: input.tenantId,
            nodeId: node.id,
            nodeType: node.type,
            status: 'WAITING',
            input: config,
            startedAt: nodeStartedAtIso,
          });

          // Wait for approval signal, rejection signal, or SLA timeout
          const conditionMet = await condition(
            () => approvedNodes.has(node.id) || rejectedNodes.has(node.id),
            timeoutDuration,
          );

          delete executionState.pendingApprovals[node.id];
          executionState.status = 'RUNNING';

          if (approvedNodes.has(node.id)) {
            const approvalData = approvedNodes.get(node.id)!;
            branchHandle = 'approved';
            nodeOutput = {
              decision: 'APPROVED',
              approvedBy: approvalData.approvedBy,
              comment: approvalData.comment,
            };
          } else if (rejectedNodes.has(node.id)) {
            const rejectionData = rejectedNodes.get(node.id)!;
            branchHandle = 'rejected';
            nodeOutput = {
              decision: 'REJECTED',
              rejectedBy: rejectionData.rejectedBy,
              reason: rejectionData.reason,
            };
          } else if (!conditionMet) {
            branchHandle = 'timeout';
            nodeOutput = {
              decision: 'TIMEOUT',
              reason: `Approval timed out after ${timeoutDuration}`,
            };
          }
          break;
        }

        default:
          nodeOutput = { skipped: true, type: node.type };
      }

      const nodeEndTime = Date.now();
      const durationMs = nodeEndTime - nodeStartTime;

      executionState.nodeResults[node.id] = {
        status: 'SUCCESS',
        input: config,
        output: nodeOutput,
        startedAt: nodeStartedAtIso,
        finishedAt: new Date(nodeEndTime).toISOString(),
        durationMs,
      };

      await recordNodeResultActivity({
        executionId: input.executionId,
        workflowId: input.workflowId,
        tenantId: input.tenantId,
        nodeId: node.id,
        nodeType: node.type,
        status: 'SUCCESS',
        input: config,
        output: nodeOutput,
        startedAt: nodeStartedAtIso,
        finishedAt: new Date(nodeEndTime).toISOString(),
        durationMs,
      });

      processedNodeIds.add(node.id);
    } catch (err: any) {
      const nodeEndTime = Date.now();
      const durationMs = nodeEndTime - nodeStartTime;
      nodeError = err?.message || String(err);

      executionState.nodeResults[node.id] = {
        status: 'FAILED',
        input: node.data?.config,
        error: nodeError,
        startedAt: nodeStartedAtIso,
        finishedAt: new Date(nodeEndTime).toISOString(),
        durationMs,
      };

      await recordNodeResultActivity({
        executionId: input.executionId,
        workflowId: input.workflowId,
        tenantId: input.tenantId,
        nodeId: node.id,
        nodeType: node.type,
        status: 'FAILED',
        input: node.data?.config,
        error: nodeError,
        startedAt: nodeStartedAtIso,
        finishedAt: new Date(nodeEndTime).toISOString(),
        durationMs,
      });

      processedNodeIds.add(node.id);

      if (!node.data?.continueOnFail) {
        executionState.status = 'FAILED';
        executionState.finishedAt = new Date().toISOString();
        executionState.errorMessage = nodeError;
        return executionState;
      }
    }

    // Determine downstream targets based on branch handle
    const edgesFromNode = outgoingEdges.get(node.id) || [];
    let nextEdges: AutomationEdge[] = [];

    if (branchHandle) {
      nextEdges = edgesFromNode.filter(
        (e) => e.sourceHandle === branchHandle || (!e.sourceHandle && branchHandle === 'approved'),
      );
    } else {
      nextEdges = edgesFromNode;
    }

    for (const edge of nextEdges) {
      if (nodesById.has(edge.target)) {
        queue.push({
          nodeId: edge.target,
          previousOutput: nodeOutput,
        });
      }
    }
  }

  executionState.status = 'COMPLETED';
  executionState.finishedAt = new Date().toISOString();
  executionState.currentNodeId = null;

  return executionState;
}
