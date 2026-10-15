import { describe, expect, it } from 'vitest';
import { PERMISSIONS, PERMISSION_DOMAINS, permissionsForSystemRole } from './index';

describe('payroll permissions', () => {
  it('registers the six permissions', () => {
    expect(PERMISSIONS.EMPLOYEE_READ).toBe('employee:read');
    expect(PERMISSIONS.EMPLOYEE_MANAGE).toBe('employee:manage');
    expect(PERMISSIONS.PAYROLL_READ).toBe('payroll:read');
    expect(PERMISSIONS.PAYROLL_MANAGE).toBe('payroll:manage');
    expect(PERMISSIONS.PAYROLL_APPROVE).toBe('payroll:approve');
    expect(PERMISSIONS.PAYROLL_PAY).toBe('payroll:pay');
    expect(PERMISSION_DOMAINS.some((d) => d.key === 'payroll')).toBe(true);
  });

  it('gives managers the directory only, and members/viewers nothing', () => {
    const manager = permissionsForSystemRole('manager') ?? [];
    expect(manager).toContain('employee:read');
    expect(manager.filter((p) => p.startsWith('payroll:'))).toEqual([]);
    for (const slug of ['member', 'viewer'] as const) {
      const perms = permissionsForSystemRole(slug) ?? [];
      expect(perms.filter((p) => p.startsWith('employee:') || p.startsWith('payroll:'))).toEqual([]);
    }
  });
});
