import { PERMISSIONS, type Permission } from './permissions';

/**
 * System roles are created for every organization at signup and cannot be
 * deleted or renamed. Their permission sets can only be edited on `admin` and
 * below — `owner` is always all-permissions and is not editable.
 */
export const SYSTEM_ROLES = {
  OWNER: 'owner',
  ADMIN: 'admin',
  MANAGER: 'manager',
  MEMBER: 'member',
  VIEWER: 'viewer',
} as const;

export type SystemRoleSlug = (typeof SYSTEM_ROLES)[keyof typeof SYSTEM_ROLES];

export interface SystemRoleDefinition {
  slug: SystemRoleSlug;
  name: string;
  description: string;
  /** `null` means "every permission, including ones added in the future". */
  permissions: Permission[] | null;
  /** Lower number = more powerful. Used to stop privilege escalation. */
  level: number;
}

export const SYSTEM_ROLE_DEFINITIONS: SystemRoleDefinition[] = [
  {
    slug: SYSTEM_ROLES.OWNER,
    name: 'Owner',
    description: 'Full access to everything, including billing. Cannot be modified or removed.',
    permissions: null,
    level: 0,
  },
  {
    slug: SYSTEM_ROLES.ADMIN,
    name: 'Admin',
    description: 'Manages the team, roles and all CRM data. No billing access.',
    permissions: [
      PERMISSIONS.ORG_READ,
      PERMISSIONS.ORG_UPDATE,
      PERMISSIONS.USER_READ,
      PERMISSIONS.USER_CREATE,
      PERMISSIONS.USER_UPDATE,
      PERMISSIONS.USER_DELETE,
      PERMISSIONS.USER_ASSIGN_ROLE,
      PERMISSIONS.ROLE_READ,
      PERMISSIONS.ROLE_CREATE,
      PERMISSIONS.ROLE_UPDATE,
      PERMISSIONS.ROLE_DELETE,
      PERMISSIONS.CONTACT_READ,
      PERMISSIONS.CONTACT_READ_ALL,
      PERMISSIONS.CONTACT_CREATE,
      PERMISSIONS.CONTACT_UPDATE,
      PERMISSIONS.CONTACT_DELETE,
      PERMISSIONS.CONTACT_EXPORT,
    ],
    level: 10,
  },
  {
    slug: SYSTEM_ROLES.MANAGER,
    name: 'Manager',
    description: 'Leads a team. Sees their team\'s contacts and pipeline, but not the whole organization.',
    permissions: [
      PERMISSIONS.ORG_READ,
      PERMISSIONS.USER_READ,
      PERMISSIONS.ROLE_READ,
      PERMISSIONS.CONTACT_READ,
      PERMISSIONS.CONTACT_READ_TEAM,
      PERMISSIONS.CONTACT_CREATE,
      PERMISSIONS.CONTACT_UPDATE,
      PERMISSIONS.CONTACT_DELETE,
      PERMISSIONS.CONTACT_EXPORT,
    ],
    level: 20,
  },
  {
    slug: SYSTEM_ROLES.MEMBER,
    name: 'Member',
    description: 'Works their own book of business — only contacts assigned to them.',
    permissions: [
      PERMISSIONS.ORG_READ,
      PERMISSIONS.USER_READ,
      PERMISSIONS.CONTACT_READ,
      PERMISSIONS.CONTACT_CREATE,
      PERMISSIONS.CONTACT_UPDATE,
    ],
    level: 30,
  },
  {
    slug: SYSTEM_ROLES.VIEWER,
    name: 'Viewer',
    description: 'Read-only access to the contacts assigned to them.',
    permissions: [PERMISSIONS.ORG_READ, PERMISSIONS.CONTACT_READ],
    level: 40,
  },
];

export const SYSTEM_ROLE_SLUGS = SYSTEM_ROLE_DEFINITIONS.map((r) => r.slug);

export function isSystemRole(slug: string): slug is SystemRoleSlug {
  return (SYSTEM_ROLE_SLUGS as string[]).includes(slug);
}

/** Custom roles sit below every system role for escalation checks. */
export const CUSTOM_ROLE_LEVEL = 100;
