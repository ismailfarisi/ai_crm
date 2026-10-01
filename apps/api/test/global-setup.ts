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

  const testUser = process.env.DB_APP_USERNAME ?? 'crm_test_app';
  const testPassword = process.env.DB_APP_PASSWORD ?? 'crm_dev_password';

  await adminClient.connect();
  const { rowCount } = await adminClient.query(
    `SELECT 1 FROM pg_database WHERE datname = $1`,
    [testDb],
  );
  if (!rowCount) {
    await adminClient.query(`CREATE DATABASE "${testDb}"`);
  }

  // Ensure non-superuser role exists without BYPASSRLS for strict RLS enforcement
  await adminClient.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${testUser}') THEN
        CREATE ROLE ${testUser} WITH LOGIN PASSWORD '${testPassword}' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
      ELSE
        ALTER ROLE ${testUser} WITH NOSUPERUSER NOBYPASSRLS LOGIN PASSWORD '${testPassword}';
      END IF;
    END $$;
  `);
  await adminClient.end();

  // Migrate the test DB so it matches the entity schema exactly.
  await AppDataSource.initialize();
  await AppDataSource.runMigrations();
  await AppDataSource.destroy();

  // Grant permissions to the application role on all migrated tables and sequences
  const testDbClient = new Client({
    host: process.env.DB_HOST ?? 'localhost',
    port: Number(process.env.DB_PORT ?? 5433),
    user: process.env.DB_USERNAME ?? 'crm',
    password: process.env.DB_PASSWORD ?? 'crm_dev_password',
    database: testDb,
  });
  await testDbClient.connect();
  await testDbClient.query(`
    GRANT CONNECT ON DATABASE "${testDb}" TO ${testUser};
    GRANT USAGE, CREATE ON SCHEMA public TO ${testUser};
    GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO ${testUser};
    GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO ${testUser};
    GRANT ALL PRIVILEGES ON ALL ROUTINES IN SCHEMA public TO ${testUser};
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL PRIVILEGES ON TABLES TO ${testUser};
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL PRIVILEGES ON SEQUENCES TO ${testUser};
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL PRIVILEGES ON ROUTINES TO ${testUser};
  `);
  await testDbClient.end();
}
