import 'reflect-metadata';
// Resolve the `@/` alias used by the entity files before anything imports them.
import 'tsconfig-paths/register';
import { config as loadEnv } from 'dotenv';
import { Client } from 'pg';
import { AppDataSource } from '../src/database/data-source';

/**
 * E2E setup: ensure a dedicated `crm_test` database exists and is migrated.
 * Runs once before the whole suite, so specs can assume a clean schema.
 */
export default async function globalSetup(): Promise<void> {
  loadEnv();

  const adminClient = new Client({
    host: process.env.DB_HOST ?? 'localhost',
    port: Number(process.env.DB_PORT ?? 5433),
    user: process.env.DB_USERNAME ?? 'crm',
    password: process.env.DB_PASSWORD ?? 'crm_dev_password',
    database: 'postgres',
  });

  const testDb = process.env.DB_NAME ?? 'crm_test';

  await adminClient.connect();
  const { rowCount } = await adminClient.query(
    `SELECT 1 FROM pg_database WHERE datname = $1`,
    [testDb],
  );
  if (!rowCount) {
    await adminClient.query(`CREATE DATABASE "${testDb}"`);
  }
  await adminClient.end();

  // Migrate the test DB so it matches the entity schema exactly.
  await AppDataSource.initialize();
  await AppDataSource.runMigrations();
  await AppDataSource.destroy();
}
