import { proxyActivities, workflowInfo } from '@temporalio/workflow';
import type { WorkflowInfo } from '@temporalio/workflow';
import type { createScheduledTickActivities } from './scheduled-tick.activities';

export interface ScheduledTickInput {
  tenantId: string;
  workflowId: string;
}

const { startScheduledRunActivity } = proxyActivities<
  ReturnType<typeof createScheduledTickActivities>
>({
  startToCloseTimeout: '1 minute',
  // Only a failed Temporal start throws; everything else returns quietly.
  // Retries stay well inside the hour, so a retrying tick never meets the
  // next one (overlap SKIP would drop it).
  retry: {
    initialInterval: '5 seconds',
    backoffCoefficient: 2,
    maximumInterval: '5 minutes',
    maximumAttempts: 8,
  },
});

/** Set by the Temporal server on every workflow a Schedule starts. */
const SCHEDULED_START_TIME = {
  name: 'TemporalScheduledStartTime',
  type: 'DATETIME',
} as const;

/**
 * The time this tick was scheduled for, as an ISO string.
 *
 * The schedule's own nominal time, not when the workflow happened to start:
 * a tick caught up after an outage, or retried, still names the slot it
 * belongs to, which is what makes it one run per slot. `startTime` is only a
 * fallback for a workflow started by hand (no schedule attached the
 * attribute); it is never used for a real schedule tick.
 */
export function scheduledTimeOf(
  info: Pick<
    WorkflowInfo,
    'startTime' | 'typedSearchAttributes' | 'searchAttributes'
  >,
): string {
  const typed = info.typedSearchAttributes?.get(SCHEDULED_START_TIME);
  if (typed instanceof Date) return typed.toISOString();

  // Older servers may send the attribute without its type metadata.
  const untyped = info.searchAttributes?.[SCHEDULED_START_TIME.name]?.[0];
  if (untyped instanceof Date || typeof untyped === 'string') {
    const at = new Date(untyped);
    if (!Number.isNaN(at.getTime())) return at.toISOString();
  }

  return info.startTime.toISOString();
}

/**
 * One tick of an automation's Temporal Schedule. Deliberately tiny: all the
 * deciding (is it still active, still on a schedule, is the organisation's
 * billing in order) happens in the activity, against the database as it is
 * now, not as it was when the schedule was written.
 */
export async function scheduledTickWorkflow(
  input: ScheduledTickInput,
): Promise<{ started: boolean; reason?: string; executionId?: string }> {
  const scheduledAt = scheduledTimeOf(workflowInfo());
  return startScheduledRunActivity({
    tenantId: input.tenantId,
    workflowId: input.workflowId,
    scheduledAt,
  });
}
