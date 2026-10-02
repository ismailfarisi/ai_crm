import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { AppDataSource } from './data-source';
import { validateEnv } from '@/config/configuration';

const env = validateEnv(process.env);

export const MigrationDataSource = new DataSource({
  ...AppDataSource.options,
  username: env.DB_ADMIN_USERNAME ?? env.DB_USERNAME,
  password: env.DB_ADMIN_PASSWORD ?? env.DB_PASSWORD,
  subscribers: [],
});