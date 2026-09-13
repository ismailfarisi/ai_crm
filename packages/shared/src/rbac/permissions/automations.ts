import type { PermissionDomain, PermissionValues } from './domain';

export const AUTOMATION_PERMISSIONS = {
  AUTOMATION_READ: 'automation:read',
  AUTOMATION_CREATE: 'automation:create',
  AUTOMATION_UPDATE: 'automation:update',
  AUTOMATION_DELETE: 'automation:delete',
  AUTOMATION_EXECUTE: 'automation:execute',
  AUTOMATION_APPROVE: 'automation:approve',
} as const;

type AutomationPermission = PermissionValues<typeof AUTOMATION_PERMISSIONS>;

export const automationsDomain: PermissionDomain<AutomationPermission> = {
  key: 'automation',
  label: 'Automations',
  permissions: AUTOMATION_PERMISSIONS,
  descriptions: {
    [AUTOMATION_PERMISSIONS.AUTOMATION_READ]: 'View automation workflows and executions',
    [AUTOMATION_PERMISSIONS.AUTOMATION_CREATE]: 'Create automation workflows',
    [AUTOMATION_PERMISSIONS.AUTOMATION_UPDATE]: 'Edit automation workflows',
    [AUTOMATION_PERMISSIONS.AUTOMATION_DELETE]: 'Delete automation workflows',
    [AUTOMATION_PERMISSIONS.AUTOMATION_EXECUTE]: 'Execute and trigger automation workflows',
    [AUTOMATION_PERMISSIONS.AUTOMATION_APPROVE]:
      'Approve or reject automation workflow approval nodes',
  },
  groupPermissions: [
    AUTOMATION_PERMISSIONS.AUTOMATION_READ,
    AUTOMATION_PERMISSIONS.AUTOMATION_CREATE,
    AUTOMATION_PERMISSIONS.AUTOMATION_UPDATE,
    AUTOMATION_PERMISSIONS.AUTOMATION_DELETE,
    AUTOMATION_PERMISSIONS.AUTOMATION_EXECUTE,
    AUTOMATION_PERMISSIONS.AUTOMATION_APPROVE,
  ],
  grants: {
    admin: [
      AUTOMATION_PERMISSIONS.AUTOMATION_READ,
      AUTOMATION_PERMISSIONS.AUTOMATION_CREATE,
      AUTOMATION_PERMISSIONS.AUTOMATION_UPDATE,
      AUTOMATION_PERMISSIONS.AUTOMATION_DELETE,
      AUTOMATION_PERMISSIONS.AUTOMATION_EXECUTE,
      AUTOMATION_PERMISSIONS.AUTOMATION_APPROVE,
    ],
    manager: [
      AUTOMATION_PERMISSIONS.AUTOMATION_READ,
      AUTOMATION_PERMISSIONS.AUTOMATION_EXECUTE,
      AUTOMATION_PERMISSIONS.AUTOMATION_APPROVE,
    ],
    member: [AUTOMATION_PERMISSIONS.AUTOMATION_READ],
    viewer: [AUTOMATION_PERMISSIONS.AUTOMATION_READ],
  },
};
