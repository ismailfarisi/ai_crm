import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { AppDataSource } from './data-source';
import { validateEnv } from '@/config/configuration';

const env = validateEnv(process.env);

export const MigrationDataSource = new DataSource({
  type: 'postgres',
  host: env.DB_HOST,
  port: env.DB_PORT,
  username: env.DB_ADMIN_USERNAME ?? env.DB_USERNAME,
  password: env.DB_ADMIN_PASSWORD ?? env.DB_PASSWORD,
  database: env.DB_NAME,
  ssl: env.DB_SSL ? { rejectUnauthorized: false } : false,
  synchronize: false,
  logging: env.DB_LOGGING,
  entities: AppDataSource.options.entities,
  migrations: AppDataSource.options.migrations,
});