import type { PermissionDomain, PermissionValues } from './domain';

/* ---------------- Audit trail ---------------- */

/**
 * Reading the trail is its own permission, and a narrow one. It exposes the
 * before-and-after of every record in the tenant, which makes it a way around
 * the ownership filters everywhere else — `contact:read` versus
 * `contact:read_all` stops meaning much if anyone can read the audit row.
 *
 * Attachments deliberately have no permissions here: they inherit from the
 * record they hang off.
 */
export const AUDIT_PERMISSIONS = {
  AUDIT_READ: 'audit:read',
} as const;

type AuditPermission = PermissionValues<typeof AUDIT_PERMISSIONS>;

export const auditDomain: PermissionDomain<AuditPermission> = {
  key: 'audit',
  label: 'Audit trail',
  permissions: AUDIT_PERMISSIONS,
  descriptions: {
    [AUDIT_PERMISSIONS.AUDIT_READ]:
      'View the audit trail: who changed what, and what it was before',
  },
  groupPermissions: [AUDIT_PERMISSIONS.AUDIT_READ],
  grants: {
    admin: [AUDIT_PERMISSIONS.AUDIT_READ],
  },
};
