import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

@Injectable()
export class DatabaseRoleGuard implements OnApplicationBootstrap {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async onApplicationBootstrap(): Promise<void> {
    const [role] = await this.dataSource.query(
      `SELECT current_user, rolsuper, rolbypassrls
       FROM pg_roles
       WHERE rolname = current_user`,
    );

    if (!role || role.rolsuper || role.rolbypassrls) {
      throw new Error(
        `Database role "${role?.current_user ?? 'unknown'}" can bypass row-level security. ` +
          'Configure DB_USERNAME/DB_PASSWORD with a non-superuser role that has NOBYPASSRLS.',
      );
    }
  }
}