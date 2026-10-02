import { DataSource } from 'typeorm';
import { DatabaseRoleGuard } from './database-role.guard';

describe('DatabaseRoleGuard', () => {
  it('allows a non-superuser role without BYPASSRLS', async () => {
    const dataSource = {
      query: jest.fn().mockResolvedValue([
        { current_user: 'crm_app', rolsuper: false, rolbypassrls: false },
      ]),
    } as unknown as DataSource;

    await expect(
      new DatabaseRoleGuard(dataSource).onApplicationBootstrap(),
    ).resolves.toBeUndefined();
  });

  it.each([
    { current_user: 'crm_admin', rolsuper: true, rolbypassrls: true },
    { current_user: 'crm_bypass', rolsuper: false, rolbypassrls: true },
  ])('rejects an RLS-bypassing role: %s', async (role) => {
    const dataSource = {
      query: jest.fn().mockResolvedValue([role]),
    } as unknown as DataSource;

    await expect(
      new DatabaseRoleGuard(dataSource).onApplicationBootstrap(),
    ).rejects.toThrow(/can bypass row-level security/);
  });
});