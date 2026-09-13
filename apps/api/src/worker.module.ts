import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { buildConfigModule, buildTypeOrmModule } from '@/config/root-imports';
import { WORKER_FEATURE_MODULES } from '@/feature-modules';
import { RefreshToken } from '@/modules/auth/entities/refresh-token.entity';

/**
 * Slim DI context for the standalone Temporal worker process
 * (temporal-worker.ts) — deliberately excludes AuthModule, ThrottlerModule,
 * and HTTP guards. The cron-duplication risk that matters (AuthModule's
 * token-housekeeping cron, QuotesModule's invoice-overdue cron) is actually
 * gated by `ScheduleModule.forRoot()`, which only AuthModule registers —
 * since this context never imports AuthModule, no `@Cron` anywhere in this
 * graph ever fires here, regardless of which modules happen to contain one.
 *
 * Every module below is needed purely for TypeORM's relation-closure: with
 * `autoLoadEntities`, an entity's `@ManyToOne`/`@OneToMany` target must also
 * be registered via some `forFeature()` in this same DI container, or
 * TypeORM throws "Entity metadata for X was not found" at boot. Chasing
 * that closure (Role -> User -> Organization -> Customer/Invitation -> ...)
 * ends up needing nearly every feature module anyway — so this mirrors
 * AppModule's own list, minus AuthModule/HealthModule/ThrottlerModule.
 */
@Module({
  imports: [
    buildConfigModule(),
    buildTypeOrmModule(),
    TypeOrmModule.forFeature([RefreshToken]),
    ...WORKER_FEATURE_MODULES,
  ],
})
export class WorkerModule {}
