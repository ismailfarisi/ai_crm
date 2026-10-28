import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { WorkflowExecutionAlreadyStartedError } from '@temporalio/client';
import type {
  AutomationNode,
  CreateAutomationWorkflowPayload,
  UpdateAutomationWorkflowPayload,
} from '@saas/shared';
import { AutomationWorkflow } from './entities/automation-workflow.entity';
import { AutomationExecution } from './entities/automation-execution.entity';
import { TemporalService } from '../temporal/temporal.service';
import { dynamicDagWorkflow } from './workflows/dynamic-dag.workflow';
import {
  approveNodeSignal,
  getExecutionStateQuery,
  rejectNodeSignal,
  WorkflowExecutionState,
} from './workflows/interfaces';

export interface TriggerExecutionOptions {
  /** Outbox event id: makes the trigger idempotent per (workflow, event). */
  sourceEventId?: string;
}

/** `temporalWorkflowId` placeholder until Temporal has accepted the start. */
const PENDING_WORKFLOW_ID_PREFIX = 'exec-';

const SOURCE_EVENT_UNIQUE = 'uq_automation_executions_source_event';

function isSourceEventConflict(err: unknown): boolean {
  const e = err as { code?: string; constraint?: string; driverError?: any };
  const code = e?.code ?? e?.driverError?.code;
  const constraint = e?.constraint ?? e?.driverError?.constraint;
  return code === '23505' && constraint === SOURCE_EVENT_UNIQUE;
}

/**
 * The web editor keeps a CRM trigger's event on the trigger node, while the
 * event bridge matches on `triggerConfig.event`. Copy it across on every save.
 */
function syncTriggerConfig(wf: {
  triggerType: string;
  triggerConfig: Record<string, any>;
  nodes: AutomationNode[];
}): void {
  if (wf.triggerType !== 'CRM_EVENT') return;
  const trigger = (wf.nodes || []).find((n) => n.type === 'crmEventTrigger');
  const event = trigger?.data?.config?.event;
  if (typeof event === 'string' && event) {
    wf.triggerConfig = { ...(wf.triggerConfig || {}), event };
  }
}

@Injectable()
export class AutomationsService {
  private readonly logger = new Logger(AutomationsService.name);

  constructor(
    @InjectRepository(AutomationWorkflow)
    private readonly workflowRepo: Repository<AutomationWorkflow>,
    @InjectRepository(AutomationExecution)
    private readonly executionRepo: Repository<AutomationExecution>,
    private readonly temporalService: TemporalService,
  ) {}

  private generateWebhookSlug(): string {
    return `wh_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  }

  async createWorkflow(
    tenantId: string,
    payload: CreateAutomationWorkflowPayload,
  ): Promise<AutomationWorkflow> {
    const webhookSlug =
      payload.triggerType === 'WEBHOOK' ? this.generateWebhookSlug() : null;

    const wf = this.workflowRepo.create({
      tenantId,
      name: payload.name,
      description: payload.description || null,
      triggerType: payload.triggerType,
      triggerConfig: payload.triggerConfig || {},
      nodes: payload.nodes || [],
      edges: payload.edges || [],
      webhookSlug,
      activatedByUserId: null,
      status: 'DRAFT',
      version: 1,
    });
    syncTriggerConfig(wf);

    return this.workflowRepo.save(wf);
  }

  async findAllWorkflows(tenantId: string): Promise<AutomationWorkflow[]> {
    return this.workflowRepo.find({
      where: { tenantId },
      order: { updatedAt: 'DESC' },
    });
  }

  async findWorkflowById(
    tenantId: string,
    id: string,
  ): Promise<AutomationWorkflow> {
    const wf = await this.workflowRepo.findOne({
      where: { id, tenantId },
    });
    if (!wf) {
      throw new NotFoundException(`Workflow ${id} not found`);
    }
    return wf;
  }

  async updateWorkflow(
    tenantId: string,
    id: string,
    payload: UpdateAutomationWorkflowPayload,
    actorUserId: string,
  ): Promise<AutomationWorkflow> {
    const wf = await this.findWorkflowById(tenantId, id);
    const wasActive = wf.status === 'ACTIVE';

    if (payload.name !== undefined) wf.name = payload.name;
    if (payload.description !== undefined) wf.description = payload.description;
    if (payload.status !== undefined) wf.status = payload.status;
    if (payload.triggerType !== undefined) wf.triggerType = payload.triggerType;
    if (payload.triggerConfig !== undefined)
      wf.triggerConfig = payload.triggerConfig;
    if (payload.nodes !== undefined) wf.nodes = payload.nodes;
    if (payload.edges !== undefined) wf.edges = payload.edges;

    syncTriggerConfig(wf);

    if (wf.status === 'ACTIVE') {
      if (wf.triggerType === 'CRM_EVENT' && !wf.triggerConfig?.event) {
        throw new BadRequestException(
          'Choose the CRM event that starts this automation',
        );
      }
      const graphChanged =
        payload.nodes !== undefined ||
        payload.edges !== undefined ||
        payload.triggerConfig !== undefined;
      // Action steps run as the owner: whoever switches it on, or whoever
      // later changes what it does.
      if (!wasActive || graphChanged) wf.activatedByUserId = actorUserId;
    }

    if (wf.triggerType === 'WEBHOOK' && !wf.webhookSlug) {
      wf.webhookSlug = this.generateWebhookSlug();
    }

    wf.version = (wf.version || 1) + 1;

    return this.workflowRepo.save(wf);
  }

  async deleteWorkflow(tenantId: string, id: string): Promise<void> {
    const wf = await this.findWorkflowById(tenantId, id);
    await this.workflowRepo.remove(wf);
  }

  async triggerExecution(
    tenantId: string,
    workflowId: string,
    triggerPayload: Record<string, any> = {},
    actorUserId?: string,
    options: TriggerExecutionOptions = {},
  ): Promise<AutomationExecution> {
    const wf = await this.findWorkflowById(tenantId, workflowId);

    if (options.sourceEventId) {
      return this.triggerForEvent(
        wf,
        options.sourceEventId,
        triggerPayload,
        actorUserId,
      );
    }

    const exec = this.executionRepo.create({
      tenantId,
      workflowId: wf.id,
      temporalWorkflowId: `exec-${Date.now()}`,
      status: 'RUNNING',
      triggerPayload,
      nodeResults: {},
    });

    const savedExec = await this.executionRepo.save(exec);

    try {
      const client = this.temporalService.getClient();
      const handle = await client.workflow.start(dynamicDagWorkflow, {
        taskQueue: 'automations-queue',
        workflowId: `automation-exec-${savedExec.id}`,
        args: [
          {
            executionId: savedExec.id,
            workflowId: wf.id,
            tenantId,
            ...(actorUserId ? { actorUserId } : {}),
            // A test run acts as the person who clicked; every other path
            // acts as the user who activated the automation.
            ...(actorUserId || wf.activatedByUserId
              ? { ownerUserId: actorUserId ?? wf.activatedByUserId! }
              : {}),
            workflowName: wf.name,
            nodes: wf.nodes || [],
            edges: wf.edges || [],
            triggerPayload,
          },
        ],
      });
      savedExec.temporalWorkflowId = handle.workflowId;
      await this.executionRepo.save(savedExec);
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Temporal start deferred/failed: ${errorMsg}`);
    }

    return savedExec;
  }

  /**
   * An outbox delivery is at-least-once, so the same event can arrive more
   * than once. One execution per (workflow, event) is enforced by
   * `uq_automation_executions_source_event`, and the Temporal workflow id is
   * derived from the event so a second start is rejected. A start that fails
   * is rethrown: the outbox then retries the event, and the retry picks up the
   * execution row recorded here instead of creating another.
   */
  private async triggerForEvent(
    wf: AutomationWorkflow,
    sourceEventId: string,
    triggerPayload: Record<string, any>,
    actorUserId?: string,
  ): Promise<AutomationExecution> {
    const where = { tenantId: wf.tenantId, workflowId: wf.id, sourceEventId };
    const temporalWorkflowId = `automation-${wf.id}-${sourceEventId}`;

    let exec = await this.executionRepo.findOne({ where });
    if (!exec) {
      try {
        exec = await this.executionRepo.save(
          this.executionRepo.create({
            tenantId: wf.tenantId,
            workflowId: wf.id,
            sourceEventId,
            temporalWorkflowId: `${PENDING_WORKFLOW_ID_PREFIX}${Date.now()}`,
            status: 'RUNNING',
            triggerPayload,
            nodeResults: {},
          }),
        );
      } catch (err: unknown) {
        if (!isSourceEventConflict(err)) throw err;
        exec = await this.executionRepo.findOne({ where });
        if (!exec) throw err;
      }
    }

    if (!exec.temporalWorkflowId.startsWith(PENDING_WORKFLOW_ID_PREFIX)) {
      return exec;
    }

    try {
      const client = this.temporalService.getClient();
      await client.workflow.start(dynamicDagWorkflow, {
        taskQueue: 'automations-queue',
        workflowId: temporalWorkflowId,
        workflowIdReusePolicy: 'REJECT_DUPLICATE',
        args: [
          {
            executionId: exec.id,
            workflowId: wf.id,
            tenantId: wf.tenantId,
            ...(actorUserId ? { actorUserId } : {}),
            ...(wf.activatedByUserId
              ? { ownerUserId: wf.activatedByUserId }
              : {}),
            workflowName: wf.name,
            nodes: wf.nodes || [],
            edges: wf.edges || [],
            triggerPayload: exec.triggerPayload,
          },
        ],
      });
    } catch (err: unknown) {
      if (!(err instanceof WorkflowExecutionAlreadyStartedError)) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        this.logger.warn(
          `Temporal start failed for execution ${exec.id} (event ${sourceEventId}); the event will be retried: ${errorMsg}`,
        );
        throw err;
      }
    }

    exec.temporalWorkflowId = temporalWorkflowId;
    return this.executionRepo.save(exec);
  }

  async triggerWebhook(
    slug: string,
    triggerPayload: Record<string, any> = {},
  ): Promise<AutomationExecution> {
    const wf = await this.workflowRepo.findOne({
      where: { webhookSlug: slug },
    });
    if (!wf) {
      throw new NotFoundException(`Webhook slug ${slug} not found`);
    }

    return this.triggerExecution(wf.tenantId, wf.id, triggerPayload);
  }

  async findExecutionsByWorkflow(
    tenantId: string,
    workflowId: string,
  ): Promise<AutomationExecution[]> {
    await this.findWorkflowById(tenantId, workflowId);
    return this.executionRepo.find({
      where: { tenantId, workflowId },
      order: { startedAt: 'DESC' },
    });
  }

  async findExecutionById(
    tenantId: string,
    executionId: string,
  ): Promise<AutomationExecution> {
    const execution = await this.findExecutionRecord(tenantId, executionId);
    const state = await this.getLiveExecutionState(execution);
    return this.withLiveExecutionState(execution, state);
  }

  async signalExecution(
    tenantId: string,
    executionId: string,
    payload: {
      action: 'APPROVE' | 'REJECT';
      nodeId: string;
      reason?: string;
      comment?: string;
    },
  ): Promise<AutomationExecution> {
    const exec = await this.findExecutionRecord(tenantId, executionId);
    const state = await this.getLiveExecutionState(exec);
    if (!state.pendingApprovals[payload.nodeId]) {
      throw new BadRequestException(
        `Node '${payload.nodeId}' has no pending approval`,
      );
    }

    try {
      const client = this.temporalService.getClient();
      const handle = client.workflow.getHandle(exec.temporalWorkflowId);
      if (payload.action === 'APPROVE') {
        await handle.signal(approveNodeSignal, {
          nodeId: payload.nodeId,
          comment: payload.comment,
        });
      } else {
        await handle.signal(rejectNodeSignal, {
          nodeId: payload.nodeId,
          reason: payload.reason,
        });
      }
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Temporal signal dispatch failed: ${errorMsg}`);
      throw new ServiceUnavailableException(
        'Unable to deliver the approval decision to the workflow',
      );
    }

    return this.withLiveExecutionState(exec, state);
  }

  private async findExecutionRecord(
    tenantId: string,
    executionId: string,
  ): Promise<AutomationExecution> {
    const execution = await this.executionRepo.findOne({
      where: { id: executionId, tenantId },
    });
    if (!execution) {
      throw new NotFoundException(`Execution ${executionId} not found`);
    }
    return execution;
  }

  private async getLiveExecutionState(
    execution: AutomationExecution,
  ): Promise<WorkflowExecutionState> {
    try {
      const handle = this.temporalService
        .getClient()
        .workflow.getHandle(execution.temporalWorkflowId);
      return await handle.query(getExecutionStateQuery);
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `Temporal state query failed for execution ${execution.id}: ${errorMsg}`,
      );
      throw new ServiceUnavailableException(
        'Unable to retrieve live automation execution state',
      );
    }
  }

  private withLiveExecutionState(
    execution: AutomationExecution,
    state: WorkflowExecutionState,
  ): AutomationExecution {
    return {
      ...execution,
      status: state.status,
      nodeResults: state.nodeResults,
      finishedAt: state.finishedAt
        ? new Date(state.finishedAt)
        : execution.finishedAt,
      errorMessage: state.errorMessage ?? execution.errorMessage,
    };
  }
}
