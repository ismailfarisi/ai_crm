import { z } from 'zod';
import { AUTOMATION_EXECUTION_STATUSES } from '@saas/shared';

/** Query of `GET /automations/:id/executions`; an unknown status is a 400. */
export const listExecutionsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).optional(),
  cursor: z.string().min(1).optional(),
  status: z.enum(AUTOMATION_EXECUTION_STATUSES).optional(),
});

export type ListExecutionsQuery = z.output<typeof listExecutionsQuerySchema>;
