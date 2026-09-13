import { permissionsForSystemRole, type Permission } from './permissions';
import { SYSTEM_ROLES, type SystemRoleSlug } from './role-slugs';

export { SYSTEM_ROLES, type SystemRoleSlug };

/**
 * System roles are created for every organization at signup and cannot be
 * deleted or renamed. Their permission sets can only be edited on `admin` and
 * below — `owner` is always all-permissions and is not editable.
 *
 * The permission lists are not written here. Each feature area declares which
 * system roles get its permissions, next to the permissions themselves (see
 * `permissions/domain.ts`), and `permissionsForSystemRole` collects them. That
 * keeps a new feature from having to edit five arrays in this file — which is
 * where concurrent branches used to collide.
 */
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
    permissions: permissionsForSystemRole(SYSTEM_ROLES.ADMIN),
    level: 10,
  },
  {
    slug: SYSTEM_ROLES.MANAGER,
    name: 'Manager',
    description: "Leads a team. Sees their team's contacts and pipeline, but not the whole organization.",
    permissions: permissionsForSystemRole(SYSTEM_ROLES.MANAGER),
    level: 20,
  },
  {
    slug: SYSTEM_ROLES.MEMBER,
    name: 'Member',
    description: 'Works their own book of business — only contacts assigned to them.',
    permissions: permissionsForSystemRole(SYSTEM_ROLES.MEMBER),
    level: 30,
  },
  {
    slug: SYSTEM_ROLES.VIEWER,
    name: 'Viewer',
    description: 'Read-only access to the contacts assigned to them.',
    permissions: permissionsForSystemRole(SYSTEM_ROLES.VIEWER),
    level: 40,
  },
];

export const SYSTEM_ROLE_SLUGS = SYSTEM_ROLE_DEFINITIONS.map((r) => r.slug);

export function isSystemRole(slug: string): slug is SystemRoleSlug {
  return (SYSTEM_ROLE_SLUGS as string[]).includes(slug);
}

/** Custom roles sit below every system role for escalation checks. */
export const CUSTOM_ROLE_LEVEL = 100;
