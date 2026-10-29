import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomBytes } from 'crypto';
import { Repository } from 'typeorm';
import type { ZodError } from 'zod';
import { WorkflowExecutionAlreadyStartedError } from '@temporalio/client';
import type {
  AutomationExecutionDto,
  AutomationExecutionPageDto,
  AutomationExecutionStatus,
  AutomationNode,
  CreateAutomationWorkflowPayload,
  ExecutionStepResultDto,
  ExecutionTriggerSource,
  UpdateAutomationWorkflowPayload,
} from '@saas/shared';
import {
  AUTOMATION_EXECUTION_STATUSES,
  automationScheduleSchema,
  PERMISSIONS,
} from '@saas/shared';
import { AutomationWorkflow } from './entities/automation-workflow.entity';
import { AutomationExecution } from './entities/automation-execution.entity';
import { TemporalService } from '../temporal/temporal.service';
import { AutomationSchedulesService } from './schedules/automation-schedules.service';
import { AutomationApprovalsService } from './approvals/automation-approvals.service';
import { dynamicDagWorkflow } from './workflows/dynamic-dag.workflow';

export interface TriggerExecutionOptions {
  /** Outbox event id: makes the trigger idempotent per (workflow, event). */
  sourceEventId?: string;
  /**
   * The caller's "same request again" key (a webhook's `Idempotency-Key`, a
   * schedule tick's time). Within {@link IDEMPOTENCY_WINDOW_MS} the same key
   * on the same workflow returns the first execution instead of starting
   * another, and resumes it if its start failed. Ignored with `sourceEventId`.
   */
  idempotencyKey?: string;
  /**
   * Rethrow when Temporal refuses the start (after marking the execution
   * FAILED), so the caller can answer "not started" and its sender retry.
   * Without it the failure is logged and the execution returned.
   */
  failOnStartError?: boolean;
  /**
   * Set only by the test-run endpoint: the run then acts as `actorUserId`.
   * Every other run (events, webhooks) acts as the workflow's owner.
   */
  testRun?: boolean;
  /** What started the run; a test run or a `sourceEventId` overrides it. */
  triggerSource?: ExecutionTriggerSource;
}

function resolveTriggerSource(
  options: TriggerExecutionOptions,
): ExecutionTriggerSource {
  if (options.testRun) return 'test';
  if (options.sourceEventId) return 'event';
  return options.triggerSource ?? 'event';
}

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function encodeCursor(startedAt: Date, id: string): string {
  return Buffer.from(`${startedAt.toISOString()}|${id}`).toString('base64url');
}

function decodeCursor(cursor: string): { startedAt: Date; id: string } {
  const bad = () => new BadRequestException('Invalid cursor');
  const text = Buffer.from(cursor, 'base64url').toString('utf8');
  const sep = text.indexOf('|');
  if (sep < 0) throw bad();
  const iso = text.slice(0, sep);
  const id = text.slice(sep + 1);
  const startedAt = new Date(iso);
  if (
    Number.isNaN(startedAt.getTime()) ||
    startedAt.toISOString() !== iso ||
    !UUID_RE.test(id)
  ) {
    throw bad();
  }
  return { startedAt, id };
}

/** How long an idempotency key is remembered per workflow. */
const IDEMPOTENCY_WINDOW_MS = 24 * 60 * 60 * 1000;

/** `temporalWorkflowId` placeholder until Temporal has accepted the start. */
const PENDING_WORKFLOW_ID_PREFIX = 'exec-';

const SOURCE_EVENT_UNIQUE = 'uq_automation_executions_source_event';
const IDEMPOTENCY_KEY_UNIQUE = 'uq_automation_executions_idempotency_key';

function isUniqueConflict(err: unknown, constraintName: string): boolean {
  const e = err as { code?: string; constraint?: string; driverError?: any };
  const code = e?.code ?? e?.driverError?.code;
  const constraint = e?.constraint ?? e?.driverError?.constraint;
  return code === '23505' && constraint === constraintName;
}

/**
 * The web editor keeps a CRM trigger's event on the trigger node, while the
 * event bridge matches on `triggerConfig.event`. Copy it across on every save;
 * a cleared event or a deleted trigger node clears it too, so the automation
 * stops matching (and can't be activated) instead of firing on the old event.
 */
function syncTriggerConfig(wf: {
  triggerType: string;
  triggerConfig: Record<string, any>;
  nodes: AutomationNode[];
}): void {
  if (wf.triggerType !== 'CRM_EVENT') return;
  const trigger = (wf.nodes || []).find((n) => n.type === 'crmEventTrigger');
  const event = trigger?.data?.config?.event;
  const triggerConfig = { ...(wf.triggerConfig || {}) };
  if (typeof event === 'string' && event) {
    triggerConfig.event = event;
  } else {
    delete triggerConfig.event;
  }
  wf.triggerConfig = triggerConfig;
}

export const WEBHOOK_TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

/** 32 random bytes, base64url: the unguessable address of a webhook. */
export function generateWebhookToken(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * The webhook address and signature secret are credentials: only people who
 * can edit the automation may see them. Returns a copy; the entity itself may
 * be saved later and must not lose them.
 */
export function redactForReader<
  T extends { webhookSlug: string | null; triggerConfig: Record<string, any> },
>(wf: T, permissions: readonly string[]): T {
  if (permissions.includes(PERMISSIONS.AUTOMATION_UPDATE)) return wf;
  const triggerConfig = { ...(wf.triggerConfig || {}) };
  delete triggerConfig.signatureSecret;
  return { ...wf, webhookSlug: null, triggerConfig };
}

function zodMessage(err: ZodError): string {
  return err.issues
    .map((i) => (i.path.length ? `${i.path.join('.')}: ${i.message}` : i.message))
    .join('; ');
}

/**
 * Normalise and validate the trigger-specific parts of `triggerConfig`:
 * a schedule's shape, a webhook's https-only redirect and its signature secret.
 * Works on a copy. The server owns the signature secret: one sent by the
 * client is ignored, and `previous` supplies the secret to keep.
 */
function applyTriggerConfig(
  wf: {
    triggerType: string;
    status: string;
    triggerConfig: Record<string, any>;
  },
  previous: Record<string, any>,
  regenerateSignature: boolean,
): void {
  const config = { ...(wf.triggerConfig || {}) };
  if (wf.triggerType === 'SCHEDULE') {
    if (config.schedule !== undefined && config.schedule !== null) {
      const parsed = automationScheduleSchema.safeParse(config.schedule);
      if (!parsed.success) {
        throw new BadRequestException(zodMessage(parsed.error));
      }
      config.schedule = parsed.data;
    } else {
      delete config.schedule;
      if (wf.status === 'ACTIVE') {
        throw new BadRequestException('Choose when this automation runs');
      }
    }
  } else if (wf.triggerType === 'WEBHOOK') {
    if (config.redirectUrl) {
      let ok = false;
      try {
        ok = new URL(String(config.redirectUrl)).protocol === 'https:';
      } catch {
        ok = false;
      }
      if (!ok) {
        throw new BadRequestException('The redirect URL must start with https://');
      }
    } else {
      delete config.redirectUrl;
    }
    if (config.requireSignature === true) {
      const kept = previous.signatureSecret;
      config.signatureSecret =
        regenerateSignature || !kept ? generateWebhookToken() : kept;
    } else {
      delete config.signatureSecret;
    }
  }
  wf.triggerConfig = config;
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
    private readonly schedules: AutomationSchedulesService,
    private readonly approvals: AutomationApprovalsService,
  ) {}

  async createWorkflow(
    tenantId: string,
    payload: CreateAutomationWorkflowPayload,
  ): Promise<AutomationWorkflow> {
    const webhookSlug =
      payload.triggerType === 'WEBHOOK' ? generateWebhookToken() : null;

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
    applyTriggerConfig(wf, {}, false);
    // Always a draft, so this asks Temporal for nothing; kept so that a
    // future "create as active" cannot skip its schedule.
    await this.schedules.sync(wf, { hadSchedule: false });

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
    const hadSchedule = wasActive && wf.triggerType === 'SCHEDULE';

    if (payload.name !== undefined) wf.name = payload.name;
    if (payload.description !== undefined) wf.description = payload.description;
    if (payload.status !== undefined) wf.status = payload.status;
    if (payload.triggerType !== undefined) wf.triggerType = payload.triggerType;
    const previousConfig = wf.triggerConfig || {};
    if (payload.triggerConfig !== undefined)
      wf.triggerConfig = payload.triggerConfig;
    if (payload.nodes !== undefined) wf.nodes = payload.nodes;
    if (payload.edges !== undefined) wf.edges = payload.edges;

    syncTriggerConfig(wf);
    applyTriggerConfig(
      wf,
      previousConfig,
      payload.regenerateSignature === true,
    );

    if (wf.status === 'ACTIVE') {
      if (wf.triggerType === 'CRM_EVENT' && !wf.triggerConfig?.event) {
        throw new BadRequestException(
          'Choose the CRM event that starts this automation',
        );
      }
      const graphChanged =
        payload.nodes !== undefined ||
        payload.edges !== undefined ||
        payload.triggerType !== undefined ||
        payload.triggerConfig !== undefined ||
        payload.regenerateSignature === true;
      // Action steps run as the owner: whoever switches it on, or whoever
      // later changes what it does.
      if (!wasActive || graphChanged) wf.activatedByUserId = actorUserId;
    }

    if (
      wf.triggerType === 'WEBHOOK' &&
      !WEBHOOK_TOKEN_RE.test(wf.webhookSlug ?? '')
    ) {
      wf.webhookSlug = generateWebhookToken();
    }

    wf.version = (wf.version || 1) + 1;

    // Temporal first: if it refuses, nothing is saved and the stored
    // automation still matches its schedule. If the save below fails after
    // the schedule changed, the two drift until the next API boot, whose
    // reconciliation rewrites every schedule from the database.
    await this.schedules.sync(wf, { hadSchedule });

    return this.workflowRepo.save(wf);
  }

  async regenerateWebhookToken(
    tenantId: string,
    id: string,
    actorUserId: string,
  ): Promise<AutomationWorkflow> {
    const wf = await this.findWorkflowById(tenantId, id);
    if (wf.triggerType !== 'WEBHOOK') {
      throw new BadRequestException('Only webhook automations have a web address');
    }
    wf.webhookSlug = generateWebhookToken();
    wf.version = (wf.version || 1) + 1;
    this.logger.log(`Webhook address regenerated for ${id} by ${actorUserId}`);
    return this.workflowRepo.save(wf);
  }

  async deleteWorkflow(tenantId: string, id: string): Promise<void> {
    const wf = await this.findWorkflowById(tenantId, id);
    // Schedule first, so a failure leaves the automation (and its schedule)
    // in place rather than a schedule ticking for a row that is gone.
    await this.schedules.deleteFor(wf);
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

    const triggerSource = resolveTriggerSource(options);
    const ownerUserId =
      options.testRun && actorUserId ? actorUserId : wf.activatedByUserId;

    let exec: AutomationExecution;
    if (options.idempotencyKey) {
      exec = await this.findOrRecordKeyed(
        wf,
        options.idempotencyKey,
        triggerPayload,
        triggerSource,
      );
      if (!exec.temporalWorkflowId.startsWith(PENDING_WORKFLOW_ID_PREFIX)) {
        return exec;
      }
    } else {
      exec = await this.executionRepo.save(
        this.executionRepo.create({
          tenantId,
          workflowId: wf.id,
          temporalWorkflowId: `${PENDING_WORKFLOW_ID_PREFIX}${Date.now()}`,
          status: 'RUNNING',
          triggerSource,
          triggerPayload,
          nodeResults: {},
        }),
      );
    }

    // Derived from the execution, so a retry that resumes this row cannot
    // start a second workflow for it.
    const temporalWorkflowId = `automation-exec-${exec.id}`;
    try {
      const client = await this.temporalService.getClient();
      await client.workflow.start(dynamicDagWorkflow, {
        taskQueue: 'automations-queue',
        workflowId: temporalWorkflowId,
        workflowIdReusePolicy: 'REJECT_DUPLICATE',
        args: [
          {
            executionId: exec.id,
            workflowId: wf.id,
            tenantId,
            ...(actorUserId ? { actorUserId } : {}),
            // A test run acts as the person who clicked; every other path
            // acts as the user who activated the automation.
            ...(ownerUserId ? { ownerUserId } : {}),
            workflowName: wf.name,
            nodes: wf.nodes || [],
            edges: wf.edges || [],
            // A resumed execution runs with the payload it was recorded with.
            triggerPayload: exec.triggerPayload,
            // From the automation, never the payload: webhook runs never
            // auto-approve agent tools.
            triggerType: wf.triggerType,
          },
        ],
      });
    } catch (err: unknown) {
      if (!(err instanceof WorkflowExecutionAlreadyStartedError)) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        if (!options.failOnStartError) {
          this.logger.warn(`Temporal start failed: ${errorMsg}`);
          // The placeholder workflow id stays, so an idempotent retry still
          // resumes this row.
          exec.status = 'FAILED';
          exec.errorMessage = "Couldn't start the run";
          exec.finishedAt = new Date();
          return this.executionRepo.save(exec);
        }
        this.logger.warn(
          `Temporal start failed for execution ${exec.id}: ${errorMsg}`,
        );
        // The placeholder workflow id stays: a retry with the same
        // idempotency key finds this row and starts it.
        exec.status = 'FAILED';
        exec.errorMessage = "Couldn't start the run";
        exec.finishedAt = new Date();
        await this.executionRepo.save(exec);
        throw err;
      }
    }

    exec.temporalWorkflowId = temporalWorkflowId;
    if (exec.status === 'FAILED') {
      exec.status = 'RUNNING';
      exec.errorMessage = null;
      exec.finishedAt = null;
    }
    return this.executionRepo.save(exec);
  }

  /**
   * The execution already recorded for this key, or a new one. A key older
   * than {@link IDEMPOTENCY_WINDOW_MS} is released first so it can start a new
   * run; two requests racing on a fresh key meet at the unique index.
   */
  private async findOrRecordKeyed(
    wf: AutomationWorkflow,
    idempotencyKey: string,
    triggerPayload: Record<string, any>,
    triggerSource: ExecutionTriggerSource,
  ): Promise<AutomationExecution> {
    const where = { tenantId: wf.tenantId, workflowId: wf.id, idempotencyKey };

    const existing = await this.executionRepo.findOne({ where });
    if (existing) {
      const age = Date.now() - new Date(existing.startedAt).getTime();
      if (age < IDEMPOTENCY_WINDOW_MS) return existing;
      await this.executionRepo.update(
        { id: existing.id, idempotencyKey },
        { idempotencyKey: null },
      );
    }

    try {
      return await this.executionRepo.save(
        this.executionRepo.create({
          tenantId: wf.tenantId,
          workflowId: wf.id,
          idempotencyKey,
          temporalWorkflowId: `${PENDING_WORKFLOW_ID_PREFIX}${Date.now()}`,
          status: 'RUNNING',
          triggerSource,
          triggerPayload,
          nodeResults: {},
        }),
      );
    } catch (err: unknown) {
      if (!isUniqueConflict(err, IDEMPOTENCY_KEY_UNIQUE)) throw err;
      const raced = await this.executionRepo.findOne({ where });
      if (!raced) throw err;
      return raced;
    }
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
            triggerSource: 'event',
            triggerPayload,
            nodeResults: {},
          }),
        );
      } catch (err: unknown) {
        if (!isUniqueConflict(err, SOURCE_EVENT_UNIQUE)) throw err;
        exec = await this.executionRepo.findOne({ where });
        if (!exec) throw err;
      }
    }

    if (!exec.temporalWorkflowId.startsWith(PENDING_WORKFLOW_ID_PREFIX)) {
      return exec;
    }

    try {
      const client = await this.temporalService.getClient();
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
            triggerType: wf.triggerType,
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

  async findExecutionsPage(
    tenantId: string,
    workflowId: string,
    q: { limit?: number; cursor?: string; status?: AutomationExecutionStatus },
  ): Promise<AutomationExecutionPageDto> {
    if (q.status !== undefined && !(AUTOMATION_EXECUTION_STATUSES as readonly string[]).includes(q.status)) {
      throw new BadRequestException('Invalid status');
    }
    const cursor = q.cursor ? decodeCursor(q.cursor) : null;
    await this.findWorkflowById(tenantId, workflowId);
    const limit = Math.min(
      Math.max(
        Math.trunc(Number.isFinite(q.limit) ? (q.limit as number) : DEFAULT_PAGE_SIZE),
        1,
      ),
      MAX_PAGE_SIZE,
    );

    // Millisecond precision on both sides: the cursor round-trips through a
    // JS Date, which would otherwise skip rows that differ by microseconds.
    const started = `date_trunc('milliseconds', e."startedAt")`;
    const qb = this.executionRepo
      .createQueryBuilder('e')
      .select([
        'e.id',
        'e.workflowId',
        'e.status',
        'e.triggerSource',
        'e.startedAt',
        'e.finishedAt',
        'e.errorMessage',
      ])
      .where('e.tenantId = :tenantId AND e.workflowId = :workflowId', {
        tenantId,
        workflowId,
      });
    if (q.status) qb.andWhere('e.status = :status', { status: q.status });
    if (cursor) {
      qb.andWhere(`(${started}, e.id) < (:cursorAt, :cursorId)`, {
        cursorAt: cursor.startedAt,
        cursorId: cursor.id,
      });
    }
    const rows = await qb
      .orderBy(started, 'DESC')
      .addOrderBy('e.id', 'DESC')
      .limit(limit + 1)
      .getMany();

    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    return {
      items: page.map((r) => ({
        id: r.id,
        workflowId: r.workflowId,
        status: r.status,
        triggerSource: r.triggerSource ?? null,
        startedAt: r.startedAt.toISOString(),
        finishedAt: r.finishedAt ? r.finishedAt.toISOString() : null,
        errorMessage: r.errorMessage ?? null,
      })),
      nextCursor:
        rows.length > limit && last
          ? encodeCursor(last.startedAt, last.id)
          : null,
    };
  }

  /**
   * Straight from the database: the worker writes every step and the final
   * status there, so a run never depends on Temporal being reachable. Without
   * `canViewData` the trigger payload and each step's input and output are
   * withheld.
   */
  async findExecutionById(
    tenantId: string,
    executionId: string,
    canViewData: boolean,
  ): Promise<AutomationExecutionDto> {
    const execution = await this.findExecutionRecord(tenantId, executionId);
    const pending = await this.approvals.findPendingForExecution(
      tenantId,
      executionId,
    );

    const steps = (execution.nodeResults || {}) as Record<
      string,
      ExecutionStepResultDto
    >;
    const nodeResults: Record<string, ExecutionStepResultDto> = {};
    for (const [nodeId, step] of Object.entries(steps)) {
      if (canViewData) {
        nodeResults[nodeId] = step;
      } else {
        nodeResults[nodeId] = {
          status: step.status,
          label: step.label,
          type: step.type,
          error: step.error,
          startedAt: step.startedAt,
          finishedAt: step.finishedAt,
          durationMs: step.durationMs,
        };
      }
    }

    return {
      id: execution.id,
      tenantId: execution.tenantId,
      workflowId: execution.workflowId,
      temporalWorkflowId: execution.temporalWorkflowId,
      status: execution.status,
      triggerSource: execution.triggerSource ?? null,
      triggerPayload: canViewData ? execution.triggerPayload : {},
      nodeResults,
      dataHidden: !canViewData,
      pendingApprovals: canViewData
        ? pending
        : pending.map((a) => ({ ...a, details: {} })),
      startedAt: execution.startedAt.toISOString(),
      finishedAt: execution.finishedAt
        ? execution.finishedAt.toISOString()
        : null,
      errorMessage: execution.errorMessage ?? null,
    };
  }

  /**
   * The older per-node decision route. It goes through the same claim as the
   * approvals inbox, so the two paths can never disagree.
   */
  async signalExecution(
    tenantId: string,
    executionId: string,
    payload: {
      action: 'APPROVE' | 'REJECT';
      nodeId: string;
      reason?: string;
      comment?: string;
    },
    user: { id: string; permissions?: readonly string[] },
  ): Promise<AutomationExecutionDto> {
    const comment =
      payload.action === 'REJECT'
        ? (payload.reason ?? payload.comment)
        : payload.comment;
    await this.approvals.decideByNode(
      tenantId,
      executionId,
      payload.nodeId,
      user,
      {
        action: payload.action,
        ...(comment !== undefined ? { comment } : {}),
      },
    );
    // Same view as the detail route: approvers need not be able to see data.
    return this.findExecutionById(
      tenantId,
      executionId,
      user.permissions?.includes(PERMISSIONS.AUTOMATION_UPDATE) ?? false,
    );
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
}
