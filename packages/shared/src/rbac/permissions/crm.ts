import type { PermissionDomain, PermissionValues } from './domain';

/* ---------------- Contacts ---------------- */

export const CONTACT_PERMISSIONS = {
  CONTACT_READ: 'contact:read',
  CONTACT_READ_ALL: 'contact:read_all',
  CONTACT_READ_TEAM: 'contact:read_team',
  CONTACT_CREATE: 'contact:create',
  CONTACT_UPDATE: 'contact:update',
  CONTACT_DELETE: 'contact:delete',
  CONTACT_EXPORT: 'contact:export',
} as const;

type ContactPermission = PermissionValues<typeof CONTACT_PERMISSIONS>;

export const contactsDomain: PermissionDomain<ContactPermission> = {
  key: 'contact',
  label: 'Contacts',
  permissions: CONTACT_PERMISSIONS,
  descriptions: {
    [CONTACT_PERMISSIONS.CONTACT_READ]: 'View contacts they own',
    [CONTACT_PERMISSIONS.CONTACT_READ_ALL]: "View all of the organization's contacts",
    [CONTACT_PERMISSIONS.CONTACT_READ_TEAM]: 'View contacts owned by their team',
    [CONTACT_PERMISSIONS.CONTACT_CREATE]: 'Create contacts',
    [CONTACT_PERMISSIONS.CONTACT_UPDATE]: 'Edit contacts',
    [CONTACT_PERMISSIONS.CONTACT_DELETE]: 'Delete contacts',
    [CONTACT_PERMISSIONS.CONTACT_EXPORT]: 'Export contacts to CSV',
  },
  // `contact:read_team` is intentionally absent: it is granted to the manager
  // role directly and is not offered as a checkbox in the role editor.
  groupPermissions: [
    CONTACT_PERMISSIONS.CONTACT_READ,
    CONTACT_PERMISSIONS.CONTACT_READ_ALL,
    CONTACT_PERMISSIONS.CONTACT_CREATE,
    CONTACT_PERMISSIONS.CONTACT_UPDATE,
    CONTACT_PERMISSIONS.CONTACT_DELETE,
    CONTACT_PERMISSIONS.CONTACT_EXPORT,
  ],
  grants: {
    admin: [
      CONTACT_PERMISSIONS.CONTACT_READ,
      CONTACT_PERMISSIONS.CONTACT_READ_ALL,
      CONTACT_PERMISSIONS.CONTACT_CREATE,
      CONTACT_PERMISSIONS.CONTACT_UPDATE,
      CONTACT_PERMISSIONS.CONTACT_DELETE,
      CONTACT_PERMISSIONS.CONTACT_EXPORT,
    ],
    manager: [
      CONTACT_PERMISSIONS.CONTACT_READ,
      CONTACT_PERMISSIONS.CONTACT_READ_TEAM,
      CONTACT_PERMISSIONS.CONTACT_CREATE,
      CONTACT_PERMISSIONS.CONTACT_UPDATE,
      CONTACT_PERMISSIONS.CONTACT_DELETE,
      CONTACT_PERMISSIONS.CONTACT_EXPORT,
    ],
    member: [
      CONTACT_PERMISSIONS.CONTACT_READ,
      CONTACT_PERMISSIONS.CONTACT_CREATE,
      CONTACT_PERMISSIONS.CONTACT_UPDATE,
    ],
    viewer: [CONTACT_PERMISSIONS.CONTACT_READ],
  },
};

/* ---------------- Customers ---------------- */

export const CUSTOMER_PERMISSIONS = {
  CUSTOMER_READ: 'customer:read',
  CUSTOMER_CREATE: 'customer:create',
  CUSTOMER_UPDATE: 'customer:update',
  CUSTOMER_DELETE: 'customer:delete',
} as const;

type CustomerPermission = PermissionValues<typeof CUSTOMER_PERMISSIONS>;

export const customersDomain: PermissionDomain<CustomerPermission> = {
  key: 'customer',
  label: 'Customers',
  permissions: CUSTOMER_PERMISSIONS,
  descriptions: {
    [CUSTOMER_PERMISSIONS.CUSTOMER_READ]: 'View customers',
    [CUSTOMER_PERMISSIONS.CUSTOMER_CREATE]: 'Create customers',
    [CUSTOMER_PERMISSIONS.CUSTOMER_UPDATE]: 'Edit customers',
    [CUSTOMER_PERMISSIONS.CUSTOMER_DELETE]: 'Delete customers',
  },
  groupPermissions: [
    CUSTOMER_PERMISSIONS.CUSTOMER_READ,
    CUSTOMER_PERMISSIONS.CUSTOMER_CREATE,
    CUSTOMER_PERMISSIONS.CUSTOMER_UPDATE,
    CUSTOMER_PERMISSIONS.CUSTOMER_DELETE,
  ],
  grants: {
    admin: [
      CUSTOMER_PERMISSIONS.CUSTOMER_READ,
      CUSTOMER_PERMISSIONS.CUSTOMER_CREATE,
      CUSTOMER_PERMISSIONS.CUSTOMER_UPDATE,
      CUSTOMER_PERMISSIONS.CUSTOMER_DELETE,
    ],
    manager: [
      CUSTOMER_PERMISSIONS.CUSTOMER_READ,
      CUSTOMER_PERMISSIONS.CUSTOMER_CREATE,
      CUSTOMER_PERMISSIONS.CUSTOMER_UPDATE,
      CUSTOMER_PERMISSIONS.CUSTOMER_DELETE,
    ],
    member: [
      CUSTOMER_PERMISSIONS.CUSTOMER_READ,
      CUSTOMER_PERMISSIONS.CUSTOMER_CREATE,
      CUSTOMER_PERMISSIONS.CUSTOMER_UPDATE,
    ],
    viewer: [CUSTOMER_PERMISSIONS.CUSTOMER_READ],
  },
};
