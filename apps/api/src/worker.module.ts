import { Module } from '@nestjs/common';
import { buildConfigModule, buildTypeOrmModule } from '@/config/root-imports';
import { AiModule } from '@/modules/ai/ai.module';
import { ChannelsModule } from '@/modules/channels/channels.module';
import { QuotesModule } from '@/modules/quotes/quotes.module';
import { RbacModule } from '@/modules/rbac/rbac.module';
import { TemporalModule } from '@/modules/temporal/temporal.module';

/**
 * Slim DI context for the standalone Temporal worker process
 * (temporal-worker.ts) — deliberately excludes AuthModule (and its
 * ScheduleModule.forRoot()/cron jobs), ThrottlerModule, guards (as HTTP
 * guards — irrelevant with no HTTP adapter here), and MailModule.
 *
 * RbacModule IS needed despite being `@Global()` elsewhere: `@Global()`
 * only broadcasts within the DI container it's registered in, and this
 * `createApplicationContext` is a separate container from the main API's
 * — ChannelCommandService (pulled in via ChannelsModule) injects
 * RbacService, so RbacModule must be imported here too, even though no
 * guard in this process ever calls it.
 */
@Module({
  imports: [
    buildConfigModule(),
    buildTypeOrmModule(),
    TemporalModule,
    RbacModule,
    AiModule,
    ChannelsModule,
    QuotesModule,
  ],
})
export class WorkerModule {}
