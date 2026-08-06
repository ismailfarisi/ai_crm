import { z } from 'zod';
import { ALL_PERMISSIONS } from '../rbac/permissions';
import { emailSchema, passwordSchema } from './auth';

const permissionSchema = z.enum(ALL_PERMISSIONS as [string, ...string[]]);

export const createRoleSchema = z.object({
  name: z.string().trim().min(2, 'Role name must be at least 2 characters').max(60),
  description: z.string().trim().max(300).optional().default(''),
  permissions: z.array(permissionSchema).default([]),
});

export const updateRoleSchema = z.object({
  name: z.string().trim().min(2).max(60).optional(),
  description: z.string().trim().max(300).optional(),
  permissions: z.array(permissionSchema).optional(),
});

export const inviteUserSchema = z.object({
  email: emailSchema,
  firstName: z.string().trim().min(1, 'First name is required').max(80),
  lastName: z.string().trim().min(1, 'Last name is required').max(80),
  roleIds: z.array(z.uuid()).min(1, 'Pick at least one role'),
  /** Optional team the invitee joins on creation. */
  teamId: z.uuid().nullable().optional(),
});

/** Accepted from the invite email link; sets the invitee's initial password. */
export const acceptInviteSchema = z.object({
  token: z.string().min(1, 'Invite token is required'),
  password: passwordSchema,
});

export const assignRolesSchema = z.object({
  roleIds: z.array(z.uuid()),
});

export type CreateRoleInput = z.input<typeof createRoleSchema>;
export type UpdateRoleInput = z.input<typeof updateRoleSchema>;
export type InviteUserInput = z.input<typeof inviteUserSchema>;
export type AcceptInviteInput = z.input<typeof acceptInviteSchema>;
export type AssignRolesInput = z.input<typeof assignRolesSchema>;
