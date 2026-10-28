/**
 * The workflows the `automations-queue` worker runs: its `workflowsPath`.
 *
 * Only workflow code belongs here. Everything this file reaches is bundled
 * into Temporal's deterministic sandbox, so never re-export activities or
 * anything Node-side (that is why this is not `./index.ts`), and import
 * `@saas/shared` from narrow subpaths only.
 */
export { dynamicDagWorkflow } from './dynamic-dag.workflow';
export { scheduledTickWorkflow } from './scheduled-tick.workflow';
