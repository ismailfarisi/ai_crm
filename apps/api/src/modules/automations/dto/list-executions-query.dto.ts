import { z } from 'zod';
import type { AutomationExecutionStatus } from '@saas/shared';

/** Query of `GET /automations/:id/executions`; an unknown status is a 400. */
export const listExecutionsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).optional(),
  cursor: z.string().min(1).optional(),
  status: z
    .enum([
      'RUNNING',
      'WAITING_APPROVAL',
      'COMPLETED',
      'FAILED',
      'CANCELLED',
      'UNKNOWN',
    ])
    .optional() satisfies z.ZodType<AutomationExecutionStatus | undefined>,
});

export type ListExecutionsQuery = z.output<typeof listExecutionsQuerySchema>;
