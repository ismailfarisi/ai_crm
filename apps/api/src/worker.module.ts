import { Module } from '@nestjs/common';
import { buildConfigModule, buildTypeOrmModule } from '@/config/root-imports';
import { AiModule } from '@/modules/ai/ai.module';
import { ChannelsModule } from '@/modules/channels/channels.module';
import { QuotesModule } from '@/modules/quotes/quotes.module';
import { TemporalModule } from '@/modules/temporal/temporal.module';

/**
 * Slim DI context for the standalone Temporal worker process
 * (temporal-worker.ts) — deliberately excludes AuthModule (and its
 * ScheduleModule.forRoot()/cron jobs), ThrottlerModule, guards, and
 * MailModule. The worker only needs AiService, ChannelsService,
 * QuotesService, and AiAgentService; bootstrapping the real AppModule here
 * would double-fire the app's cron jobs in both processes.
 */
@Module({
  imports: [
    buildConfigModule(),
    buildTypeOrmModule(),
    TemporalModule,
    AiModule,
    ChannelsModule,
    QuotesModule,
  ],
})
export class WorkerModule {}
