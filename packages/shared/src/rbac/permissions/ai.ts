import type { PermissionDomain, PermissionValues } from './domain';

export const AI_PERMISSIONS = {
  AI_USE: 'ai:use',
  AI_MANAGE: 'ai:manage',
  ASSISTANT_USE: 'assistant:use',
} as const;

type AiPermission = PermissionValues<typeof AI_PERMISSIONS>;

export const aiDomain: PermissionDomain<AiPermission> = {
  key: 'ai',
  label: 'AI',
  permissions: AI_PERMISSIONS,
  descriptions: {
    [AI_PERMISSIONS.AI_USE]:
      'Use AI-powered features (receipt scanning, automation AI steps, quote drafting)',
    [AI_PERMISSIONS.AI_MANAGE]:
      'Configure AI providers and budgets, and view AI usage across the organization',
    [AI_PERMISSIONS.ASSISTANT_USE]:
      'Chat with the in-app assistant, which can read and (with your approval) change records you already have access to',
  },
  groupPermissions: [AI_PERMISSIONS.AI_USE, AI_PERMISSIONS.AI_MANAGE, AI_PERMISSIONS.ASSISTANT_USE],
  grants: {
    admin: [AI_PERMISSIONS.AI_USE, AI_PERMISSIONS.AI_MANAGE, AI_PERMISSIONS.ASSISTANT_USE],
    manager: [AI_PERMISSIONS.AI_USE, AI_PERMISSIONS.ASSISTANT_USE],
    member: [AI_PERMISSIONS.AI_USE, AI_PERMISSIONS.ASSISTANT_USE],
  },
};
