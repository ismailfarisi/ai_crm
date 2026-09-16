import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { CREDENTIAL_ROUTE_KEY } from '@/common/decorators';
import { AllExceptionsFilter } from '@/common/filters/all-exceptions.filter';
import type { AppConfig } from '@/config/configuration';
import { buildConfigModule, buildTypeOrmModule } from '@/config/root-imports';
import { FEATURE_MODULES } from '@/feature-modules';
import { JwtAuthGuard } from '@/modules/auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '@/modules/rbac/guards/permissions.guard';
import { BillingGuard } from '@/modules/billing/billing.guard';

@Module({
  imports: [
    buildConfigModule(),

    buildTypeOrmModule(),

    ThrottlerModule.forRootAsync({
      inject: [ConfigService, Reflector],
      useFactory: (
        config: ConfigService<AppConfig, true>,
        reflector: Reflector,
      ) => {
        const throttle = config.get('throttle', { infer: true });
        return {
          throttlers: [
            { name: 'default', ttl: throttle.ttl, limit: throttle.limit },
            {
              // Every named throttler applies to every route unless it skips,
              // so this one has to skip everything it is not for. Without the
              // skip it caps the entire API at the login limit.
              name: 'auth',
              ttl: throttle.ttl,
              limit: throttle.authLimit,
              skipIf: (context) =>
                !reflector.getAllAndOverride<boolean>(CREDENTIAL_ROUTE_KEY, [
                  context.getHandler(),
                  context.getClass(),
                ]),
            },
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
    // Last: a lapsed subscription stops writes only for people who could otherwise make them.
    { provide: APP_GUARD, useExisting: BillingGuard },
  ],
})
export class AppModule {}
