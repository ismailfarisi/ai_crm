import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type {
  CreateAutomationWorkflowPayload,
  UpdateAutomationWorkflowPayload,
} from '@saas/shared';
import { AutomationWorkflow } from './entities/automation-workflow.entity';
import { AutomationExecution } from './entities/automation-execution.entity';
import { TemporalService } from '../temporal/temporal.service';
import { dynamicDagWorkflow } from './workflows/dynamic-dag.workflow';
import { approveNodeSignal, rejectNodeSignal } from './workflows/interfaces';

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
      status: 'DRAFT',
      version: 1,
    });

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
  ): Promise<AutomationWorkflow> {
    const wf = await this.findWorkflowById(tenantId, id);

    if (payload.name !== undefined) wf.name = payload.name;
    if (payload.description !== undefined) wf.description = payload.description;
    if (payload.status !== undefined) wf.status = payload.status;
    if (payload.triggerType !== undefined) wf.triggerType = payload.triggerType;
    if (payload.triggerConfig !== undefined)
      wf.triggerConfig = payload.triggerConfig;
    if (payload.nodes !== undefined) wf.nodes = payload.nodes;
    if (payload.edges !== undefined) wf.edges = payload.edges;

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
  ): Promise<AutomationExecution> {
    const wf = await this.findWorkflowById(tenantId, workflowId);

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
    const exec = await this.executionRepo.findOne({
      where: { id: executionId, tenantId },
    });
    if (!exec) {
      throw new NotFoundException(`Execution ${executionId} not found`);
    }
    return exec;
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
    const exec = await this.findExecutionById(tenantId, executionId);

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
    }

    return exec;
  }
}
