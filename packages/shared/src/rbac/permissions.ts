/**
 * The single source of truth for every permission in the system.
 *
 * A permission is `<subject>:<action>`. The API seeds this catalog into the
 * `permissions` table on boot, guards check against it, and the web app uses it
 * to hide UI the current user cannot act on. Add a permission here first —
 * nothing else should invent permission strings.
 */

export const PERMISSION_ACTIONS = ['create', 'read', 'update', 'delete', 'manage'] as const;
export type PermissionAction = (typeof PERMISSION_ACTIONS)[number];

export const PERMISSIONS = {
  // Organization
  ORG_READ: 'org:read',
  ORG_UPDATE: 'org:update',
  ORG_MANAGE_BILLING: 'org:manage_billing',

  // Users / members
  USER_READ: 'user:read',
  USER_CREATE: 'user:create',
  USER_UPDATE: 'user:update',
  USER_DELETE: 'user:delete',
  USER_ASSIGN_ROLE: 'user:assign_role',

  // Roles & permissions (RBAC administration)
  ROLE_READ: 'role:read',
  ROLE_CREATE: 'role:create',
  ROLE_UPDATE: 'role:update',
  ROLE_DELETE: 'role:delete',

  // Contacts
  CONTACT_READ: 'contact:read',
  CONTACT_READ_ALL: 'contact:read_all',
  CONTACT_READ_TEAM: 'contact:read_team',
  CONTACT_CREATE: 'contact:create',
  CONTACT_UPDATE: 'contact:update',
  CONTACT_DELETE: 'contact:delete',
  CONTACT_EXPORT: 'contact:export',

  // Customers
  CUSTOMER_READ: 'customer:read',
  CUSTOMER_CREATE: 'customer:create',
  CUSTOMER_UPDATE: 'customer:update',
  CUSTOMER_DELETE: 'customer:delete',

  // Quotes
  QUOTE_CREATE: 'quote:create',
  QUOTE_READ: 'quote:read',
  QUOTE_APPROVE: 'quote:approve',

  // Invoices
  INVOICE_READ: 'invoice:read',

  // Channels
  CHANNEL_MANAGE: 'channel:manage',
  CHANNEL_READ: 'channel:read',
  CHANNEL_SEND: 'channel:send',

  // Email client
  EMAIL_READ: 'email:read',
  EMAIL_READ_ALL: 'email:read_all',
  EMAIL_SEND: 'email:send',
  EMAIL_MANAGE: 'email:manage',
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const ALL_PERMISSIONS = Object.values(PERMISSIONS) as Permission[];

/** Human-readable descriptions, used to seed the catalog and label the UI. */
export const PERMISSION_DESCRIPTIONS: Record<Permission, string> = {
  [PERMISSIONS.ORG_READ]: 'View organization settings',
  [PERMISSIONS.ORG_UPDATE]: 'Edit organization settings',
  [PERMISSIONS.ORG_MANAGE_BILLING]: 'Manage subscription and billing',

  [PERMISSIONS.USER_READ]: 'View team members',
  [PERMISSIONS.USER_CREATE]: 'Invite new team members',
  [PERMISSIONS.USER_UPDATE]: 'Edit team members',
  [PERMISSIONS.USER_DELETE]: 'Deactivate team members',
  [PERMISSIONS.USER_ASSIGN_ROLE]: 'Assign roles to team members',

  [PERMISSIONS.ROLE_READ]: 'View roles and their permissions',
  [PERMISSIONS.ROLE_CREATE]: 'Create custom roles',
  [PERMISSIONS.ROLE_UPDATE]: 'Edit roles and their permissions',
  [PERMISSIONS.ROLE_DELETE]: 'Delete custom roles',

  [PERMISSIONS.CONTACT_READ]: 'View contacts they own',
  [PERMISSIONS.CONTACT_READ_ALL]: "View all of the organization's contacts",
  [PERMISSIONS.CONTACT_READ_TEAM]: 'View contacts owned by their team',
  [PERMISSIONS.CONTACT_CREATE]: 'Create contacts',
  [PERMISSIONS.CONTACT_UPDATE]: 'Edit contacts',
  [PERMISSIONS.CONTACT_DELETE]: 'Delete contacts',
  [PERMISSIONS.CONTACT_EXPORT]: 'Export contacts to CSV',

  [PERMISSIONS.CUSTOMER_READ]: 'View customers',
  [PERMISSIONS.CUSTOMER_CREATE]: 'Create customers',
  [PERMISSIONS.CUSTOMER_UPDATE]: 'Edit customers',
  [PERMISSIONS.CUSTOMER_DELETE]: 'Delete customers',

  [PERMISSIONS.QUOTE_CREATE]: 'Create quotes',
  [PERMISSIONS.QUOTE_READ]: 'View quotes',
  [PERMISSIONS.QUOTE_APPROVE]: 'Approve quotes',

  [PERMISSIONS.INVOICE_READ]: 'View invoices',

  [PERMISSIONS.CHANNEL_MANAGE]: 'Manage channel integrations',
  [PERMISSIONS.CHANNEL_READ]: 'View channels and messages',
  [PERMISSIONS.CHANNEL_SEND]: 'Send channel messages',

  [PERMISSIONS.EMAIL_READ]: 'View assigned email accounts and threads',
  [PERMISSIONS.EMAIL_READ_ALL]: 'View all organization email accounts and threads',
  [PERMISSIONS.EMAIL_SEND]: 'Compose, send, and manage email drafts',
  [PERMISSIONS.EMAIL_MANAGE]: 'Manage email accounts (IMAP/SMTP/Resend)',
};

/** Groups drive the layout of the role editor screen. */
export const PERMISSION_GROUPS: { key: string; label: string; permissions: Permission[] }[] = [
  {
    key: 'org',
    label: 'Organization',
    permissions: [PERMISSIONS.ORG_READ, PERMISSIONS.ORG_UPDATE, PERMISSIONS.ORG_MANAGE_BILLING],
  },
  {
    key: 'user',
    label: 'Team members',
    permissions: [
      PERMISSIONS.USER_READ,
      PERMISSIONS.USER_CREATE,
      PERMISSIONS.USER_UPDATE,
      PERMISSIONS.USER_DELETE,
      PERMISSIONS.USER_ASSIGN_ROLE,
    ],
  },
  {
    key: 'role',
    label: 'Roles & permissions',
    permissions: [
      PERMISSIONS.ROLE_READ,
      PERMISSIONS.ROLE_CREATE,
      PERMISSIONS.ROLE_UPDATE,
      PERMISSIONS.ROLE_DELETE,
    ],
  },
  {
    key: 'contact',
    label: 'Contacts',
    permissions: [
      PERMISSIONS.CONTACT_READ,
      PERMISSIONS.CONTACT_READ_ALL,
      PERMISSIONS.CONTACT_CREATE,
      PERMISSIONS.CONTACT_UPDATE,
      PERMISSIONS.CONTACT_DELETE,
      PERMISSIONS.CONTACT_EXPORT,
    ],
  },
  {
    key: 'customer',
    label: 'Customers',
    permissions: [
      PERMISSIONS.CUSTOMER_READ,
      PERMISSIONS.CUSTOMER_CREATE,
      PERMISSIONS.CUSTOMER_UPDATE,
      PERMISSIONS.CUSTOMER_DELETE,
    ],
  },
  {
    key: 'quote',
    label: 'Quotes',
    permissions: [PERMISSIONS.QUOTE_READ, PERMISSIONS.QUOTE_CREATE, PERMISSIONS.QUOTE_APPROVE],
  },
  {
    key: 'invoice',
    label: 'Invoices',
    permissions: [PERMISSIONS.INVOICE_READ],
  },
  {
    key: 'channel',
    label: 'Channels',
    permissions: [PERMISSIONS.CHANNEL_MANAGE, PERMISSIONS.CHANNEL_READ, PERMISSIONS.CHANNEL_SEND],
  },
  {
    key: 'email',
    label: 'Email client',
    permissions: [
      PERMISSIONS.EMAIL_READ,
      PERMISSIONS.EMAIL_READ_ALL,
      PERMISSIONS.EMAIL_SEND,
      PERMISSIONS.EMAIL_MANAGE,
    ],
  },
];

export function splitPermission(permission: Permission): { subject: string; action: string } {
  const [subject, action] = permission.split(':');
  return { subject, action };
}
