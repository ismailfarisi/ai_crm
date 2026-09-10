import 'reflect-metadata';
import { Worker, NativeConnection } from '@temporalio/worker';
import { NestFactory } from '@nestjs/core';
import * as expenseActivities from './modules/finance/workflows/activities/expense.activities';
import * as quoteActivities from './modules/quotes/workflows/quote.activities';
import * as automationActivities from './modules/automations/workflows/automation.activities';
import { createChannelAiActivities } from './modules/channels/workflows/activities/channel-ai.activities';
import { WorkerModule } from './worker.module';
import { AiService } from './modules/ai/ai.service';
import { ChannelsService } from './modules/channels/channels.service';
import { QuotesService } from './modules/quotes/quotes.service';
import { AiAgentService } from './modules/channels/services/ai-agent.service';

/**
 * Standalone Temporal worker process — separate from the NestJS API server.
 * Registers one Worker per task queue used by `client.workflow.start()` calls
 * across the app (finance, quotes, automations, channel AI). Most activities
 * are plain DI-free functions; the channel-ai-queue is the first to need
 * real, DI-resolved services (AiService, ChannelsService, QuotesService,
 * AiAgentService), so this process also bootstraps a slim NestJS application
 * context (WorkerModule) just for that — never the real AppModule, which
 * would double-fire its cron jobs in both processes.
 */
async function run(): Promise<void> {
  const address = process.env.TEMPORAL_ADDRESS || 'localhost:7233';
  const connection = await NativeConnection.connect({ address });
  const appContext = await NestFactory.createApplicationContext(WorkerModule, {
    logger: ['error', 'warn'],
  });

  try {
    const channelAiActivities = createChannelAiActivities({
      aiService: appContext.get(AiService),
      channelsService: appContext.get(ChannelsService),
      quotesService: appContext.get(QuotesService),
      aiAgentService: appContext.get(AiAgentService),
    });

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
      Worker.create({
        connection,
        taskQueue: 'channel-ai-queue',
        workflowsPath:
          require.resolve('./modules/channels/workflows/channel-ai.workflow'),
        activities: channelAiActivities,
      }),
    ]);

    console.log(
      'Temporal worker(s) started: finance-queue, quotes-queue, automations-queue, channel-ai-queue',
    );

    await Promise.all(workers.map((w) => w.run()));
  } finally {
    await appContext.close();
    await connection.close();
  }
}

run().catch((err) => {
  console.error('Temporal worker failed to start:', err);
  process.exit(1);
});
