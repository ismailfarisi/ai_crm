import { describe, expect, it } from 'vitest';
import { PERMISSIONS, PERMISSION_DOMAINS, permissionsForSystemRole } from './index';

describe('timesheet permissions', () => {
  it('registers read and manage', () => {
    expect(PERMISSIONS.TIMESHEET_READ).toBe('timesheet:read');
    expect(PERMISSIONS.TIMESHEET_MANAGE).toBe('timesheet:manage');
    expect(PERMISSION_DOMAINS.some((d) => d.key === 'timesheet')).toBe(true);
  });

  it('admins and managers manage; members read; viewers nothing', () => {
    for (const slug of ['admin', 'manager'] as const) {
      expect(permissionsForSystemRole(slug)).toEqual(expect.arrayContaining(['timesheet:read', 'timesheet:manage']));
    }
    const member = permissionsForSystemRole('member') ?? [];
    expect(member).toContain('timesheet:read');
    expect(member).not.toContain('timesheet:manage');
    expect((permissionsForSystemRole('viewer') ?? []).filter((p) => p.startsWith('timesheet:'))).toEqual([]);
  });
});
