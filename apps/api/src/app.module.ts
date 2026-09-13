import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AllExceptionsFilter } from '@/common/filters/all-exceptions.filter';
import type { AppConfig } from '@/config/configuration';
import { buildConfigModule, buildTypeOrmModule } from '@/config/root-imports';
import { FEATURE_MODULES } from '@/feature-modules';
import { JwtAuthGuard } from '@/modules/auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '@/modules/rbac/guards/permissions.guard';

@Module({
  imports: [
    buildConfigModule(),

    buildTypeOrmModule(),

    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfig, true>) => {
        const throttle = config.get('throttle', { infer: true });
        return {
          throttlers: [
            { name: 'default', ttl: throttle.ttl, limit: throttle.limit },
            // Named separately so auth routes can tighten it with @Throttle.
            { name: 'auth', ttl: throttle.ttl, limit: throttle.authLimit },
          ],
        };
      },
    }),

    ...FEATURE_MODULES,
  ],
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    // Order matters: throttle → authenticate → authorize.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class AppModule {}
