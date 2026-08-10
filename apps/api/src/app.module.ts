import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { TypeOrmModule } from '@nestjs/typeorm';
import { join } from 'node:path';
import { AllExceptionsFilter } from '@/common/filters/all-exceptions.filter';
import {
  configuration,
  validateEnv,
  type AppConfig,
} from '@/config/configuration';
import { AuthModule } from '@/modules/auth/auth.module';
import { JwtAuthGuard } from '@/modules/auth/guards/jwt-auth.guard';
import { ChannelsModule } from '@/modules/channels/channels.module';
import { ContactsModule } from '@/modules/contacts/contacts.module';
import { CustomersModule } from '@/modules/customers/customers.module';
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
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      load: [configuration],
      validate: validateEnv,
      envFilePath: ['.env.local', '.env'],
    }),

    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfig, true>) => {
        const db = config.get('database', { infer: true });
        return {
          type: 'postgres' as const,
          host: db.host,
          port: db.port,
          username: db.username,
          password: db.password,
          database: db.database,
          ssl: db.ssl ? { rejectUnauthorized: false } : false,
          // `synchronize` is a development convenience only — production runs
          // migrations. Double-guarded so it can never be on by accident.
          synchronize:
            db.synchronize && !config.get('isProduction', { infer: true }),
          logging: db.logging,
          autoLoadEntities: true,
          migrations: [join(__dirname, 'database', 'migrations', '*.{ts,js}')],
          migrationsRun: false,
        };
      },
    }),

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
