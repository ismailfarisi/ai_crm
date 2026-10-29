import type { createRunRecordActivities } from './run-record.activities';

type RunRecordActivities = ReturnType<typeof createRunRecordActivities>;

/**
 * The activity set registered on the automations-queue worker. Kept apart
 * from the worker bootstrap so a test can check the run-record activities
 * are really registered (a missing one fails every run).
 */
export function buildAutomationsQueueActivities<
  T extends Record<string, unknown>,
>(parts: {
  automationActivities: T;
  automationActions: Record<string, unknown>;
  agentReactActivities: Record<string, unknown>;
  scheduledTickActivities: Record<string, unknown>;
  runRecordActivities: RunRecordActivities;
}) {
  return {
    ...parts.automationActivities,
    ...parts.automationActions,
    ...parts.agentReactActivities,
    ...parts.scheduledTickActivities,
    ...parts.runRecordActivities,
  };
}
