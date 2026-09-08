import 'reflect-metadata';
import { Worker, NativeConnection } from '@temporalio/worker';
import * as expenseActivities from './modules/finance/workflows/activities/expense.activities';
import * as quoteActivities from './modules/quotes/workflows/quote.activities';
import * as automationActivities from './modules/automations/workflows/automation.activities';

/**
 * Standalone Temporal worker process — separate from the NestJS API server.
 * Registers one Worker per task queue used by `client.workflow.start()` calls
 * across the app (finance, quotes, automations). Activities are plain
 * DI-free functions, so this file has no NestJS dependency.
 */
async function run(): Promise<void> {
  const address = process.env.TEMPORAL_ADDRESS || 'localhost:7233';
  const connection = await NativeConnection.connect({ address });

  try {
    const workers = await Promise.all([
      Worker.create({
        connection,
        taskQueue: 'finance-queue',
        workflowsPath:
          require.resolve('./modules/finance/workflows/expense-approval.workflow'),
        activities: expenseActivities,
      }),
      Worker.create({
        connection,
        taskQueue: 'quotes-queue',
        workflowsPath:
          require.resolve('./modules/quotes/workflows/quote.workflow'),
        activities: quoteActivities,
      }),
      Worker.create({
        connection,
        taskQueue: 'automations-queue',
        workflowsPath:
          require.resolve('./modules/automations/workflows/dynamic-dag.workflow'),
        activities: automationActivities,
      }),
    ]);

    console.log(
      'Temporal worker(s) started: finance-queue, quotes-queue, automations-queue',
    );

    await Promise.all(workers.map((w) => w.run()));
  } finally {
    await connection.close();
  }
}

run().catch((err) => {
  console.error('Temporal worker failed to start:', err);
  process.exit(1);
});
