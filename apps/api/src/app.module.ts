import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AllExceptionsFilter } from '@/common/filters/all-exceptions.filter';
import type { AppConfig } from '@/config/configuration';
import { buildConfigModule, buildTypeOrmModule } from '@/config/root-imports';
import { AiModule } from '@/modules/ai/ai.module';
import { AuthModule } from '@/modules/auth/auth.module';
import { JwtAuthGuard } from '@/modules/auth/guards/jwt-auth.guard';
import { AutomationsModule } from '@/modules/automations/automations.module';
import { ChannelsModule } from '@/modules/channels/channels.module';
import { ContactsModule } from '@/modules/contacts/contacts.module';
import { CustomersModule } from '@/modules/customers/customers.module';
import { FinanceModule } from '@/modules/finance/finance.module';
import { HealthModule } from '@/modules/health/health.module';
import { InvitationsModule } from '@/modules/invitations/invitations.module';
import { MailModule } from '@/modules/mail/mail.module';
import { PermissionsGuard } from '@/modules/rbac/guards/permissions.guard';
import { QuotesModule } from '@/modules/quotes/quotes.module';
import { RbacModule } from '@/modules/rbac/rbac.module';
import { TeamsModule } from '@/modules/teams/teams.module';
import { TemporalModule } from '@/modules/temporal/temporal.module';
import { UsersModule } from '@/modules/users/users.module';

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

    AiModule,
    RbacModule,
    UsersModule,
    AuthModule,
    ContactsModule,
    CustomersModule,
    TeamsModule,
    InvitationsModule,
    MailModule,
    HealthModule,
    TemporalModule,
    QuotesModule,
    ChannelsModule,
    AutomationsModule,
    FinanceModule,
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
