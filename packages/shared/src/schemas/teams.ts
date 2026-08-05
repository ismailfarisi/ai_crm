import { z } from 'zod';

export const createTeamSchema = z.object({
  name: z.string().trim().min(2, 'Team name must be at least 2 characters').max(60),
  /** Optional initial team lead — must be a member of the same organization. */
  leadId: z.uuid().nullable().optional(),
});

export const updateTeamSchema = z.object({
  name: z.string().trim().min(2).max(60).optional(),
  leadId: z.uuid().nullable().optional(),
});

/** Assign (or clear, with null) which team a member belongs to. */
export const assignTeamSchema = z.object({
  teamId: z.uuid().nullable(),
});

export type CreateTeamInput = z.input<typeof createTeamSchema>;
export type UpdateTeamInput = z.input<typeof updateTeamSchema>;
export type AssignTeamInput = z.input<typeof assignTeamSchema>;
