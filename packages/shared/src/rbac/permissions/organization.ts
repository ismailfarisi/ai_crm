import type { PermissionDomain, PermissionValues } from './domain';

/* ---------------- Organization ---------------- */

export const ORG_PERMISSIONS = {
  ORG_READ: 'org:read',
  ORG_UPDATE: 'org:update',
  ORG_MANAGE_BILLING: 'org:manage_billing',
} as const;

type OrgPermission = PermissionValues<typeof ORG_PERMISSIONS>;

export const orgDomain: PermissionDomain<OrgPermission> = {
  key: 'org',
  label: 'Organization',
  permissions: ORG_PERMISSIONS,
  descriptions: {
    [ORG_PERMISSIONS.ORG_READ]: 'View organization settings',
    [ORG_PERMISSIONS.ORG_UPDATE]: 'Edit organization settings',
    [ORG_PERMISSIONS.ORG_MANAGE_BILLING]: 'Manage subscription and billing',
  },
  groupPermissions: [
    ORG_PERMISSIONS.ORG_READ,
    ORG_PERMISSIONS.ORG_UPDATE,
    ORG_PERMISSIONS.ORG_MANAGE_BILLING,
  ],
  grants: {
    admin: [ORG_PERMISSIONS.ORG_READ, ORG_PERMISSIONS.ORG_UPDATE],
    manager: [ORG_PERMISSIONS.ORG_READ],
    member: [ORG_PERMISSIONS.ORG_READ],
    viewer: [ORG_PERMISSIONS.ORG_READ],
  },
};

/* ---------------- Users / members ---------------- */

export const USER_PERMISSIONS = {
  USER_READ: 'user:read',
  USER_CREATE: 'user:create',
  USER_UPDATE: 'user:update',
  USER_DELETE: 'user:delete',
  USER_ASSIGN_ROLE: 'user:assign_role',
} as const;

type UserPermission = PermissionValues<typeof USER_PERMISSIONS>;

export const usersDomain: PermissionDomain<UserPermission> = {
  key: 'user',
  label: 'Team members',
  permissions: USER_PERMISSIONS,
  descriptions: {
    [USER_PERMISSIONS.USER_READ]: 'View team members',
    [USER_PERMISSIONS.USER_CREATE]: 'Invite new team members',
    [USER_PERMISSIONS.USER_UPDATE]: 'Edit team members',
    [USER_PERMISSIONS.USER_DELETE]: 'Deactivate team members',
    [USER_PERMISSIONS.USER_ASSIGN_ROLE]: 'Assign roles to team members',
  },
  groupPermissions: [
    USER_PERMISSIONS.USER_READ,
    USER_PERMISSIONS.USER_CREATE,
    USER_PERMISSIONS.USER_UPDATE,
    USER_PERMISSIONS.USER_DELETE,
    USER_PERMISSIONS.USER_ASSIGN_ROLE,
  ],
  grants: {
    admin: [
      USER_PERMISSIONS.USER_READ,
      USER_PERMISSIONS.USER_CREATE,
      USER_PERMISSIONS.USER_UPDATE,
      USER_PERMISSIONS.USER_DELETE,
      USER_PERMISSIONS.USER_ASSIGN_ROLE,
    ],
    manager: [USER_PERMISSIONS.USER_READ],
    member: [USER_PERMISSIONS.USER_READ],
  },
};

/* ---------------- Roles & permissions (RBAC administration) ---------------- */

export const ROLE_PERMISSIONS = {
  ROLE_READ: 'role:read',
  ROLE_CREATE: 'role:create',
  ROLE_UPDATE: 'role:update',
  ROLE_DELETE: 'role:delete',
} as const;

type RolePermission = PermissionValues<typeof ROLE_PERMISSIONS>;

export const rolesDomain: PermissionDomain<RolePermission> = {
  key: 'role',
  label: 'Roles & permissions',
  permissions: ROLE_PERMISSIONS,
  descriptions: {
    [ROLE_PERMISSIONS.ROLE_READ]: 'View roles and their permissions',
    [ROLE_PERMISSIONS.ROLE_CREATE]: 'Create custom roles',
    [ROLE_PERMISSIONS.ROLE_UPDATE]: 'Edit roles and their permissions',
    [ROLE_PERMISSIONS.ROLE_DELETE]: 'Delete custom roles',
  },
  groupPermissions: [
    ROLE_PERMISSIONS.ROLE_READ,
    ROLE_PERMISSIONS.ROLE_CREATE,
    ROLE_PERMISSIONS.ROLE_UPDATE,
    ROLE_PERMISSIONS.ROLE_DELETE,
  ],
  grants: {
    admin: [
      ROLE_PERMISSIONS.ROLE_READ,
      ROLE_PERMISSIONS.ROLE_CREATE,
      ROLE_PERMISSIONS.ROLE_UPDATE,
      ROLE_PERMISSIONS.ROLE_DELETE,
    ],
    manager: [ROLE_PERMISSIONS.ROLE_READ],
  },
};
