/**
 * The workflows the `automations-queue` worker runs: its `workflowsPath`.
 * Temporal registers them by these export names.
 *
 * Only workflow code belongs here. Everything this file reaches is bundled
 * into Temporal's deterministic sandbox, so never re-export activities or
 * anything Node-side (that is why this is not `./index.ts`), and import
 * `@saas/shared` from narrow subpaths only.
 */
export { dynamicDagWorkflow } from './dynamic-dag.workflow';
export { scheduledTickWorkflow } from './scheduled-tick.workflow';
// An AI agent step starts this as a child workflow without a task queue, so
// it runs on this queue and must be registered here (it is also registered
// on assistant-queue for the in-app assistant).
export { agentReActWorkflow } from '../../channels/workflows/agent-react.workflow';
