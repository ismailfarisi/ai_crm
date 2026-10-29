import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { WorkflowNotFoundError } from '@temporalio/client';
import type {
  ApprovalAlreadyDecidedBody,
  ApprovalDecisionPayload,
  AutomationApprovalDto,
} from '@saas/shared';
import { AutomationApproval } from '../entities/automation-approval.entity';
import { AutomationExecution } from '../entities/automation-execution.entity';
import { User } from '../../users/entities/user.entity';
import { TemporalService } from '../../temporal/temporal.service';
import {
  approveNodeSignal,
  getExecutionStateQuery,
  rejectNodeSignal,
  type WorkflowExecutionState,
} from '../workflows/interfaces';

const DELIVERY_FAILED =
  'Unable to deliver the approval decision to the workflow';
const ALREADY_DECIDED = 'Already decided';
const NO_LONGER_PENDING = 'No longer pending';
const INBOX_LIMIT = 200;
const UNKNOWN_USER = 'Unknown user';

type Decider = { id: string; name: string };

/** `UPDATE … RETURNING` through `Repository.query` answers `[rows, rowCount]`. */
function returnedRows(result: unknown): AutomationApproval[] {
  if (Array.isArray(result) && Array.isArray(result[0])) {
    return result[0] as AutomationApproval[];
  }
  return Array.isArray(result) ? (result as AutomationApproval[]) : [];
}

function iso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  return new Date(value).toISOString();
}

function recordName(record: unknown): string | null {
  if (!record || typeof record !== 'object') return null;
  const r = record as Record<string, unknown>;
  const text = (v: unknown) =>
    typeof v === 'string' && v.trim() ? v.trim() : null;
  const name = text(r.name);
  if (name) return name;
  const full = [text(r.firstName), text(r.lastName)].filter(Boolean).join(' ');
  if (full) return full;
  return text(r.title);
}

function scheduleTime(scheduledAt: unknown, timezone: string): string | null {
  if (typeof scheduledAt !== 'string') return null;
  const at = new Date(scheduledAt);
  if (Number.isNaN(at.getTime())) return null;
  const format = (timeZone: string) =>
    new Intl.DateTimeFormat('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
      timeZone,
    }).format(at);
  try {
    return format(timezone);
  } catch {
    return format('UTC');
  }
}

/**
 * The approvals inbox: what is waiting, and deciding it. A decision is claimed
 * on the row first (one conditional UPDATE), so of two people deciding at once
 * exactly one reaches the workflow and the other is told who did.
 */
@Injectable()
export class AutomationApprovalsService {
  private readonly logger = new Logger(AutomationApprovalsService.name);

  constructor(
    @InjectRepository(AutomationApproval)
    private readonly approvals: Repository<AutomationApproval>,
    @InjectRepository(AutomationExecution)
    private readonly executions: Repository<AutomationExecution>,
    @InjectRepository(User)
    private readonly users: Repository<User>,
    private readonly temporalService: TemporalService,
  ) {}

  async listPending(tenantId: string): Promise<AutomationApprovalDto[]> {
    const rows = await this.approvals.find({
      where: { tenantId, status: 'PENDING' },
      relations: { execution: { workflow: true } },
      order: { requestedAt: 'ASC' },
      take: INBOX_LIMIT,
    });
    return this.toDtos(tenantId, rows);
  }

  async countPending(tenantId: string): Promise<number> {
    return this.approvals.count({ where: { tenantId, status: 'PENDING' } });
  }

  async findPendingForExecution(
    tenantId: string,
    executionId: string,
  ): Promise<AutomationApprovalDto[]> {
    const rows = await this.approvals.find({
      where: { tenantId, executionId, status: 'PENDING' },
      relations: { execution: { workflow: true } },
      order: { requestedAt: 'ASC' },
    });
    return this.toDtos(tenantId, rows);
  }

  async decideByNode(
    tenantId: string,
    executionId: string,
    nodeId: string,
    user: { id: string },
    payload: ApprovalDecisionPayload,
  ): Promise<AutomationApprovalDto> {
    const pending = await this.approvals.findOne({
      where: { tenantId, executionId, nodeId, status: 'PENDING' },
    });
    if (pending) return this.decide(tenantId, pending.id, user, payload);

    const exec = await this.executions.findOne({
      where: { id: executionId, tenantId },
    });
    if (!exec)
      throw new NotFoundException(`Execution ${executionId} not found`);

    const latest = await this.approvals.findOne({
      where: { tenantId, executionId, nodeId },
      order: { requestedAt: 'DESC' },
    });
    if (latest) throw await this.conflict(tenantId, latest);
    throw new BadRequestException(`Node '${nodeId}' has no pending approval`);
  }

  async decide(
    tenantId: string,
    approvalId: string,
    user: { id: string },
    payload: ApprovalDecisionPayload,
  ): Promise<AutomationApprovalDto> {
    const row = await this.approvals.findOne({
      where: { id: approvalId, tenantId },
      relations: { execution: { workflow: true } },
    });
    if (!row || !row.execution) {
      throw new NotFoundException(`Approval ${approvalId} not found`);
    }
    if (row.status !== 'PENDING') throw await this.conflict(tenantId, row);
    const exec = row.execution;

    const state = await this.liveState(exec);
    if (!state?.pendingApprovals?.[row.nodeId]) {
      throw await this.close(tenantId, row);
    }

    const status = payload.action === 'APPROVE' ? 'APPROVED' : 'REJECTED';
    const comment = payload.comment ?? null;
    const claimed = returnedRows(
      await this.approvals.query(
        `UPDATE automation_approvals
            SET status = $1, "decidedByUserId" = $2, "decidedAt" = now(), comment = $3
          WHERE id = $4 AND "tenantId" = $5 AND status = 'PENDING'
        RETURNING *`,
        [status, user.id, comment, row.id, tenantId],
      ),
    )[0];
    if (!claimed) throw await this.conflict(tenantId, await this.reload(row));

    try {
      const client = await this.temporalService.getClient();
      const handle = client.workflow.getHandle(exec.temporalWorkflowId);
      if (payload.action === 'APPROVE') {
        await handle.signal(approveNodeSignal, {
          nodeId: row.nodeId,
          approvedBy: user.id,
          comment: payload.comment,
        });
      } else {
        await handle.signal(rejectNodeSignal, {
          nodeId: row.nodeId,
          rejectedBy: user.id,
          reason: payload.comment,
        });
      }
    } catch (err: unknown) {
      this.logger.warn(
        `Temporal signal for approval ${row.id} failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      await this.unclaim(tenantId, row.id, status, user.id);
      throw new ServiceUnavailableException(DELIVERY_FAILED);
    }

    await this.resumeRunIfNothingPending(tenantId, exec.id);

    const [dto] = await this.toDtos(tenantId, [
      { ...claimed, execution: exec },
    ]);
    return dto;
  }

  /** One line on what started the run, for the inbox. */
  triggerSummary(exec: AutomationExecution): string {
    const payload = exec.triggerPayload ?? {};
    switch (exec.triggerSource) {
      case 'event': {
        const eventType =
          typeof payload.eventType === 'string' && payload.eventType
            ? payload.eventType
            : 'Event';
        const name = recordName(payload.payload);
        return name ? `${eventType} — ${name}` : eventType;
      }
      case 'webhook':
        return 'Webhook';
      case 'schedule': {
        const timezone =
          typeof payload.timezone === 'string' && payload.timezone
            ? payload.timezone
            : 'UTC';
        const time = scheduleTime(payload.scheduledAt, timezone);
        return time ? `Schedule, ${time} ${timezone}` : 'Schedule';
      }
      case 'test':
        return 'Test run';
      default:
        return '—';
    }
  }

  private async liveState(
    exec: AutomationExecution,
  ): Promise<WorkflowExecutionState | null> {
    try {
      const client = await this.temporalService.getClient();
      return await client.workflow
        .getHandle(exec.temporalWorkflowId)
        .query(getExecutionStateQuery);
    } catch (err: unknown) {
      // The run is gone: nothing is waiting any more.
      if (err instanceof WorkflowNotFoundError) return null;
      this.logger.warn(
        `Temporal state query failed for execution ${exec.id}: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw new ServiceUnavailableException(DELIVERY_FAILED);
    }
  }

  /**
   * The workflow no longer waits on this node: close the row (EXPIRED once
   * its deadline has passed, else CANCELLED) and answer the 409.
   */
  private async close(
    tenantId: string,
    row: AutomationApproval,
  ): Promise<ConflictException> {
    const closed = returnedRows(
      await this.approvals.query(
        `UPDATE automation_approvals
            SET status = CASE WHEN "expiresAt" IS NOT NULL AND "expiresAt" <= now()
                              THEN 'EXPIRED' ELSE 'CANCELLED' END
          WHERE id = $1 AND "tenantId" = $2 AND status = 'PENDING'
        RETURNING *`,
        [row.id, tenantId],
      ),
    )[0];
    return this.conflict(tenantId, closed ?? (await this.reload(row)));
  }

  private async unclaim(
    tenantId: string,
    id: string,
    claimedStatus: 'APPROVED' | 'REJECTED',
    userId: string,
  ): Promise<void> {
    try {
      await this.approvals.query(
        `UPDATE automation_approvals
            SET status = 'PENDING', "decidedByUserId" = NULL, "decidedAt" = NULL, comment = NULL
          WHERE id = $1 AND "tenantId" = $2 AND status = $3 AND "decidedByUserId" = $4`,
        [id, tenantId, claimedStatus, userId],
      );
    } catch (err: unknown) {
      this.logger.error(
        `Could not put approval ${id} back to PENDING after a failed signal: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /** The workflow's next step record confirms this; it only shows sooner. */
  private async resumeRunIfNothingPending(
    tenantId: string,
    executionId: string,
  ): Promise<void> {
    try {
      await this.executions.query(
        `UPDATE automation_executions
            SET status = 'RUNNING'
          WHERE id = $1 AND "tenantId" = $2 AND status = 'WAITING_APPROVAL'
            AND NOT EXISTS (
              SELECT 1 FROM automation_approvals
               WHERE "executionId" = $1 AND "tenantId" = $2 AND status = 'PENDING')`,
        [executionId, tenantId],
      );
    } catch (err: unknown) {
      this.logger.warn(
        `Could not mark execution ${executionId} running again: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private async reload(row: AutomationApproval): Promise<AutomationApproval> {
    return (
      (await this.approvals.findOne({
        where: { id: row.id, tenantId: row.tenantId },
      })) ?? row
    );
  }

  private async conflict(
    tenantId: string,
    row: AutomationApproval,
  ): Promise<ConflictException> {
    const decided = row.status === 'APPROVED' || row.status === 'REJECTED';
    const names = await this.deciderNames(tenantId, [row]);
    const body: ApprovalAlreadyDecidedBody = {
      message: decided ? ALREADY_DECIDED : NO_LONGER_PENDING,
      status: row.status,
      decidedBy: this.decider(row, names),
      decidedAt: iso(row.decidedAt),
    };
    return new ConflictException(body);
  }

  private async deciderNames(
    tenantId: string,
    rows: AutomationApproval[],
  ): Promise<Map<string, string>> {
    const ids = [
      ...new Set(
        rows.map((r) => r.decidedByUserId).filter((id): id is string => !!id),
      ),
    ];
    if (!ids.length) return new Map();
    const users = await this.users.find({
      where: { id: In(ids), tenantId },
      select: { id: true, firstName: true, lastName: true },
    });
    return new Map(
      users.map((u) => [
        u.id,
        `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() || UNKNOWN_USER,
      ]),
    );
  }

  private decider(
    row: AutomationApproval,
    names: Map<string, string>,
  ): Decider | null {
    if (!row.decidedByUserId) return null;
    return {
      id: row.decidedByUserId,
      name: names.get(row.decidedByUserId) ?? UNKNOWN_USER,
    };
  }

  private async toDtos(
    tenantId: string,
    rows: AutomationApproval[],
  ): Promise<AutomationApprovalDto[]> {
    const names = await this.deciderNames(tenantId, rows);
    return rows.map((row) => {
      const exec = row.execution;
      return {
        id: row.id,
        executionId: row.executionId,
        workflowId: row.workflowId,
        nodeId: row.nodeId,
        kind: row.kind,
        title: row.title,
        details: row.details ?? {},
        status: row.status,
        requestedAt: iso(row.requestedAt) ?? '',
        expiresAt: iso(row.expiresAt),
        decidedBy: this.decider(row, names),
        decidedAt: iso(row.decidedAt),
        comment: row.comment ?? null,
        workflowName: exec?.workflow?.name ?? '',
        triggerSource: exec?.triggerSource ?? null,
        triggerSummary: exec ? this.triggerSummary(exec) : '—',
      };
    });
  }
}
