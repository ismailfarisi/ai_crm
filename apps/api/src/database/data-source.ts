import 'reflect-metadata';
import { config as loadEnv } from 'dotenv';
import { DataSource } from 'typeorm';
import { join } from 'node:path';
import { validateEnv } from '@/config/configuration';
import { pgConnectionOptions } from '@/config/database-options';
import { TenantRlsSubscriber } from './tenant-rls.subscriber';

loadEnv();

const env = validateEnv(process.env);

/**
 * Used by Temporal activities that run outside Nest's DI container. Migration
 * commands use `migration-data-source.ts` with separate admin credentials.
 */
export const AppDataSource = new DataSource({
  type: 'postgres',
  host: env.DB_HOST,
  port: env.DB_PORT,
  username: env.DB_USERNAME,
  password: env.DB_PASSWORD,
  database: env.DB_NAME,
  // Same pool bound and timeouts as the Nest connection. The migration data
  // source copies only credentials and entities, so migrations stay exempt.
  ...pgConnectionOptions({
    ssl: env.DB_SSL,
    sslRejectUnauthorized: env.DB_SSL_REJECT_UNAUTHORIZED,
    poolMax: env.DB_POOL_MAX,
    statementTimeoutMs: env.DB_STATEMENT_TIMEOUT_MS,
    idleInTransactionTimeoutMs: env.DB_IDLE_IN_TRANSACTION_TIMEOUT_MS,
  }),
  synchronize: false,
  logging: env.DB_LOGGING,
  subscribers: [TenantRlsSubscriber],
  entities: [
    join(__dirname, '..', 'modules', '**', 'entities', '*.entity.{ts,js}'),
  ],
  migrations: [join(__dirname, 'migrations', '*.{ts,js}')],
});
