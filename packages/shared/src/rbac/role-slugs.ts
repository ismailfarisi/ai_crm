/**
 * The system role slugs, on their own with no imports.
 *
 * Split out of `roles.ts` so that permission domain files can type their role
 * grants (`grants: { admin: [...] }`) without importing `roles.ts`, which
 * itself has to import the composed permission catalog. Without this leaf
 * module the two would form an import cycle.
 */
export const SYSTEM_ROLES = {
  OWNER: 'owner',
  ADMIN: 'admin',
  MANAGER: 'manager',
  MEMBER: 'member',
  VIEWER: 'viewer',
} as const;

export type SystemRoleSlug = (typeof SYSTEM_ROLES)[keyof typeof SYSTEM_ROLES];
