import type { PermissionDomain, PermissionValues } from './domain';

/* ---------------- Document Templates ---------------- */

export const TEMPLATE_PERMISSIONS = {
  DOCUMENT_TEMPLATE_READ: 'template:read',
  DOCUMENT_TEMPLATE_MANAGE: 'template:manage',
} as const;

type TemplatePermission = PermissionValues<typeof TEMPLATE_PERMISSIONS>;

export const templateDomain: PermissionDomain<TemplatePermission> = {
  key: 'template',
  label: 'Document Templates',
  permissions: TEMPLATE_PERMISSIONS,
  descriptions: {
    [TEMPLATE_PERMISSIONS.DOCUMENT_TEMPLATE_READ]: 'View document templates',
    [TEMPLATE_PERMISSIONS.DOCUMENT_TEMPLATE_MANAGE]:
      'Create, edit, and configure document templates and defaults',
  },
  groupPermissions: [
    TEMPLATE_PERMISSIONS.DOCUMENT_TEMPLATE_READ,
    TEMPLATE_PERMISSIONS.DOCUMENT_TEMPLATE_MANAGE,
  ],
  grants: {
    admin: [
      TEMPLATE_PERMISSIONS.DOCUMENT_TEMPLATE_READ,
      TEMPLATE_PERMISSIONS.DOCUMENT_TEMPLATE_MANAGE,
    ],
    manager: [TEMPLATE_PERMISSIONS.DOCUMENT_TEMPLATE_READ],
    member: [TEMPLATE_PERMISSIONS.DOCUMENT_TEMPLATE_READ],
    viewer: [TEMPLATE_PERMISSIONS.DOCUMENT_TEMPLATE_READ],
  },
};
