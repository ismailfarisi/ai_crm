import { NotFoundException } from '@nestjs/common';
import type { Repository } from 'typeorm';
import type { TenantContextService } from '@/common/context/tenant-context.service';
import type { BillingService } from '@/modules/billing/billing.service';
import type { AutomationsService } from '../automations.service';
import type { AutomationWorkflow } from '../entities/automation-workflow.entity';

const DEFAULT_TIMEZONE = 'Asia/Dubai';

export interface ScheduledTickActivityDeps {
  workflows: Pick<Repository<AutomationWorkflow>, 'findOne'>;
  automations: Pick<AutomationsService, 'triggerExecution'>;
  billing: Pick<BillingService, 'restrictionFor'>;
  tenantContext: Pick<TenantContextService, 'runAsSystem' | 'runWithTenant'>;
}

export interface StartScheduledRunInput {
  tenantId: string;
  workflowId: string;
  /** ISO time of the schedule slot this tick is for. */
  scheduledAt: string;
}

export type StartScheduledRunResult =
  | { started: true; executionId: string }
  | {
      started: false;
      reason:
        'not_found' | 'not_active' | 'not_scheduled' | 'billing_restricted';
    };

export function createScheduledTickActivities(deps: ScheduledTickActivityDeps) {
  return {
    /**
     * Starts the run for one schedule tick, as the automation's owner.
     *
     * A tick can outlive what it was for: the automation may have been
     * deleted, paused or switched to another trigger since the schedule was
     * written (its schedule is removed on save, but a tick can already be in
     * flight, and a failed removal is only repaired at the next boot). Those
     * ticks return quietly instead of throwing, so Temporal does not retry
     * them in a loop. Only a failed start throws, to be retried.
     */
    async startScheduledRunActivity(
      input: StartScheduledRunInput,
    ): Promise<StartScheduledRunResult> {
      // No user and no request: this one read bypasses row-level security.
      const wf = await deps.tenantContext.runAsSystem(() =>
        deps.workflows.findOne({
          where: { id: input.workflowId, tenantId: input.tenantId },
        }),
      );
      if (!wf) return { started: false, reason: 'not_found' };
      if (wf.status !== 'ACTIVE')
        return { started: false, reason: 'not_active' };
      if (wf.triggerType !== 'SCHEDULE') {
        return { started: false, reason: 'not_scheduled' };
      }

      return deps.tenantContext.runWithTenant(
        wf.tenantId,
        async (): Promise<StartScheduledRunResult> => {
          // A lapsed organisation keeps its schedules (they resume when it
          // pays) but its ticks start nothing.
          const { restricted } = await deps.billing.restrictionFor(wf.tenantId);
          if (restricted)
            return { started: false, reason: 'billing_restricted' };

          const timezone =
            typeof wf.triggerConfig?.schedule?.timezone === 'string'
              ? wf.triggerConfig.schedule.timezone
              : DEFAULT_TIMEZONE;

          try {
            const exec = await deps.automations.triggerExecution(
              wf.tenantId,
              wf.id,
              { scheduledAt: input.scheduledAt, timezone },
              undefined,
              {
                failOnStartError: true,
                // One run per slot: a redelivered or retried tick finds the
                // execution the first one recorded (and resumes it if its
                // start failed). Webhooks use a `webhook:` prefix.
                idempotencyKey: `schedule:${input.scheduledAt}`,
              },
            );
            return { started: true, executionId: exec.id };
          } catch (err: unknown) {
            // Deleted between the lookup and the start.
            if (err instanceof NotFoundException) {
              return { started: false, reason: 'not_found' };
            }
            throw err;
          }
        },
      );
    },
  };
}
