import 'reflect-metadata';
import { config as loadEnv } from 'dotenv';
import { DataSource } from 'typeorm';
import { join } from 'node:path';
import { validateEnv } from '@/config/configuration';
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
  ssl: env.DB_SSL ? { rejectUnauthorized: false } : false,
  synchronize: false,
  logging: env.DB_LOGGING,
  subscribers: [TenantRlsSubscriber],
  entities: [
    join(__dirname, '..', 'modules', '**', 'entities', '*.entity.{ts,js}'),
  ],
  migrations: [join(__dirname, 'migrations', '*.{ts,js}')],
});
