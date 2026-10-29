import type { Repository } from 'typeorm';
import type { TenantContextService } from '@/common/context/tenant-context.service';
import type { AutomationExecution } from '../entities/automation-execution.entity';
import type {
  RecordNodeResultParams,
  RecordNodeResultResult,
  RecordRunFinishedParams,
} from './interfaces';

// Activity-side only: workflow code must import this type-only, never at runtime.

const MAX_STORED_CHARS = 16384;
const PREVIEW_CHARS = 4096;

export interface RunRecordActivityDeps {
  executions: Repository<AutomationExecution>;
  tenantContext: Pick<TenantContextService, 'runWithTenant'>;
}

/** Keeps a step's input/output from bloating the run row. */
export function capForStorage(value: unknown): unknown {
  if (value === undefined) return undefined;
  const json = JSON.stringify(value);
  if (json === undefined || json.length <= MAX_STORED_CHARS) return value;
  return {
    truncated: true,
    size: json.length,
    preview: json.slice(0, PREVIEW_CHARS),
  };
}

// A pending approval whose deadline has passed ends EXPIRED, otherwise CANCELLED.
const CLOSE_STATUS = `CASE WHEN "expiresAt" IS NOT NULL AND "expiresAt" <= now() THEN 'EXPIRED' ELSE 'CANCELLED' END`;

export function createRunRecordActivities(deps: RunRecordActivityDeps) {
  const { executions, tenantContext } = deps;

  return {
    async recordNodeResultActivity(
      p: RecordNodeResultParams,
    ): Promise<RecordNodeResultResult> {
      const tenantId = p.tenantId;
      if (!tenantId) {
        throw new Error('recordNodeResultActivity requires a tenantId');
      }
      if (p.status === 'WAITING' && p.approval && !p.workflowId) {
        throw new Error(
          'recordNodeResultActivity requires a workflowId with an approval',
        );
      }
      if (p.status === 'WAITING' && p.approval && !p.workflowId) {
        throw new Error(
          'recordNodeResultActivity requires a workflowId with an approval',
        );
      }
      const result = {
        status: p.status,
        label: p.label,
        type: p.nodeType,
        input: capForStorage(p.input),
        output: capForStorage(p.output),
        error: p.error,
        startedAt: p.startedAt,
        finishedAt: p.finishedAt,
        durationMs: p.durationMs,
      };

      await tenantContext.runWithTenant(tenantId, () =>
        executions.manager.transaction(async (m) => {
          await m.query(
            `UPDATE automation_executions
                SET "nodeResults" = "nodeResults" || jsonb_build_object($1::text, $2::jsonb)
              WHERE id = $3 AND "tenantId" = $4`,
            [p.nodeId, JSON.stringify(result), p.executionId, tenantId],
          );

          if (p.status === 'WAITING' && p.approval) {
            await m.query(
              `UPDATE automation_approvals
                  SET status = 'CANCELLED'
                WHERE "executionId" = $1 AND "nodeId" = $2 AND "tenantId" = $3
                  AND status = 'PENDING' AND id <> $4`,
              [p.executionId, p.nodeId, tenantId, p.approval.id],
            );
            await m.query(
              `INSERT INTO automation_approvals
                 (id, "tenantId", "executionId", "workflowId", "nodeId", kind, title, details, status, "requestedAt", "expiresAt")
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, 'PENDING', $9, $10)
               ON CONFLICT (id) DO NOTHING`,
              [
                p.approval.id,
                tenantId,
                p.executionId,
                p.workflowId,
                p.nodeId,
                p.approval.kind,
                p.approval.title,
                JSON.stringify(p.approval.details ?? {}),
                p.approval.requestedAt,
                p.approval.expiresAt,
              ],
            );
          } else if (p.status !== 'WAITING') {
            await m.query(
              `UPDATE automation_approvals
                  SET status = ${CLOSE_STATUS}
                WHERE "executionId" = $1 AND "nodeId" = $2 AND "tenantId" = $3
                  AND status = 'PENDING'`,
              [p.executionId, p.nodeId, tenantId],
            );
          }

          await m.query(
            `UPDATE automation_executions
                SET status = (CASE WHEN EXISTS (
                      SELECT 1 FROM automation_approvals
                       WHERE "executionId" = $1 AND "tenantId" = $2 AND status = 'PENDING')
                    THEN 'WAITING_APPROVAL' ELSE 'RUNNING' END)::automation_executions_status_enum
              WHERE id = $1 AND "tenantId" = $2
                AND status IN ('RUNNING', 'WAITING_APPROVAL', 'UNKNOWN')`,
            [p.executionId, tenantId],
          );
        }),
      );

      return { recorded: true, executionId: p.executionId, nodeId: p.nodeId };
    },

    async recordRunFinishedActivity(p: RecordRunFinishedParams): Promise<void> {
      await tenantContext.runWithTenant(p.tenantId, () =>
        executions.manager.transaction(async (m) => {
          await m.query(
            `UPDATE automation_executions
                SET status = $1, "errorMessage" = $2, "finishedAt" = $3
              WHERE id = $4 AND "tenantId" = $5
                AND status NOT IN ('COMPLETED', 'FAILED', 'CANCELLED')`,
            [
              p.status,
              p.errorMessage ?? null,
              p.finishedAt,
              p.executionId,
              p.tenantId,
            ],
          );
          await m.query(
            `UPDATE automation_approvals
                SET status = ${CLOSE_STATUS}
              WHERE "executionId" = $1 AND "tenantId" = $2 AND status = 'PENDING'`,
            [p.executionId, p.tenantId],
          );
        }),
      );
    },
  };
}
