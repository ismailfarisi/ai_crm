import type { PermissionDomain, PermissionValues } from './domain';

/* ---------------- Channels ---------------- */

export const CHANNEL_PERMISSIONS = {
  CHANNEL_MANAGE: 'channel:manage',
  CHANNEL_READ: 'channel:read',
  CHANNEL_SEND: 'channel:send',
} as const;

type ChannelPermission = PermissionValues<typeof CHANNEL_PERMISSIONS>;

export const channelsDomain: PermissionDomain<ChannelPermission> = {
  key: 'channel',
  label: 'Channels',
  permissions: CHANNEL_PERMISSIONS,
  descriptions: {
    [CHANNEL_PERMISSIONS.CHANNEL_MANAGE]: 'Manage channel integrations',
    [CHANNEL_PERMISSIONS.CHANNEL_READ]: 'View channels and messages',
    [CHANNEL_PERMISSIONS.CHANNEL_SEND]: 'Send channel messages',
  },
  groupPermissions: [
    CHANNEL_PERMISSIONS.CHANNEL_MANAGE,
    CHANNEL_PERMISSIONS.CHANNEL_READ,
    CHANNEL_PERMISSIONS.CHANNEL_SEND,
  ],
  grants: {
    admin: [
      CHANNEL_PERMISSIONS.CHANNEL_MANAGE,
      CHANNEL_PERMISSIONS.CHANNEL_READ,
      CHANNEL_PERMISSIONS.CHANNEL_SEND,
    ],
    manager: [CHANNEL_PERMISSIONS.CHANNEL_READ, CHANNEL_PERMISSIONS.CHANNEL_SEND],
    member: [CHANNEL_PERMISSIONS.CHANNEL_READ, CHANNEL_PERMISSIONS.CHANNEL_SEND],
    viewer: [CHANNEL_PERMISSIONS.CHANNEL_READ],
  },
};

/* ---------------- Email client ---------------- */

export const EMAIL_PERMISSIONS = {
  EMAIL_READ: 'email:read',
  EMAIL_READ_ALL: 'email:read_all',
  EMAIL_SEND: 'email:send',
  EMAIL_MANAGE: 'email:manage',
} as const;

type EmailPermission = PermissionValues<typeof EMAIL_PERMISSIONS>;

export const emailDomain: PermissionDomain<EmailPermission> = {
  key: 'email',
  label: 'Email client',
  permissions: EMAIL_PERMISSIONS,
  descriptions: {
    [EMAIL_PERMISSIONS.EMAIL_READ]: 'View own and shared email accounts and threads',
    [EMAIL_PERMISSIONS.EMAIL_READ_ALL]: 'View all organization email accounts and threads',
    [EMAIL_PERMISSIONS.EMAIL_SEND]: 'Connect a mailbox and compose and send email',
    [EMAIL_PERMISSIONS.EMAIL_MANAGE]: 'Manage any email account (connect, share, disconnect)',
  },
  groupPermissions: [
    EMAIL_PERMISSIONS.EMAIL_READ,
    EMAIL_PERMISSIONS.EMAIL_READ_ALL,
    EMAIL_PERMISSIONS.EMAIL_SEND,
    EMAIL_PERMISSIONS.EMAIL_MANAGE,
  ],
  // Everyone who can read mail can connect their own mailbox; org-wide
  // visibility and managing other people's accounts stay with admins.
  grants: {
    admin: [
      EMAIL_PERMISSIONS.EMAIL_READ,
      EMAIL_PERMISSIONS.EMAIL_READ_ALL,
      EMAIL_PERMISSIONS.EMAIL_SEND,
      EMAIL_PERMISSIONS.EMAIL_MANAGE,
    ],
    manager: [
      EMAIL_PERMISSIONS.EMAIL_READ,
      EMAIL_PERMISSIONS.EMAIL_SEND,
    ],
    member: [
      EMAIL_PERMISSIONS.EMAIL_READ,
      EMAIL_PERMISSIONS.EMAIL_SEND,
    ],
    viewer: [EMAIL_PERMISSIONS.EMAIL_READ],
  },
};
