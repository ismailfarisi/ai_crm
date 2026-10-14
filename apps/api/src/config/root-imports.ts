import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { join } from 'node:path';
import { configuration, validateEnv, type AppConfig } from './configuration';
import { TenantRlsSubscriber } from '../database/tenant-rls.subscriber';
import { pgConnectionOptions } from './database-options';

/**
 * Shared by `AppModule` and `WorkerModule` so the two processes (API server,
 * Temporal worker) can never drift on config loading or DB connection setup.
 */
export function buildConfigModule() {
  return ConfigModule.forRoot({
    isGlobal: true,
    cache: true,
    load: [configuration],
    validate: validateEnv,
    envFilePath: ['.env.local', '.env'],
  });
}

export function buildTypeOrmModule() {
  return TypeOrmModule.forRootAsync({
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
        // Pool bound, statement / idle-in-transaction timeouts and TLS
        // verification, all env-configurable — see config/database-options.
        ...pgConnectionOptions(db),
        // `synchronize` is a development convenience only — production runs
        // migrations. Double-guarded so it can never be on by accident.
        synchronize:
          db.synchronize && !config.get('isProduction', { infer: true }),
        logging: db.logging,
        autoLoadEntities: true,
        subscribers: [TenantRlsSubscriber],
        migrations: [
          join(__dirname, '..', 'database', 'migrations', '*.{ts,js}'),
        ],
        migrationsRun: false,
      };
    },
  });
}
