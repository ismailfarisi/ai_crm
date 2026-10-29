import { z } from 'zod';
import type { ApprovalDecisionPayload } from '@saas/shared';

/**
 * Body of `POST /automation-approvals/:approvalId/decision`. A zod schema
 * behind `zodBody`, the API's validation pattern (it has no class-validator).
 */
export const approvalDecisionSchema = z.object({
  action: z.enum(['APPROVE', 'REJECT']),
  comment: z.string().max(1000).optional(),
}) satisfies z.ZodType<ApprovalDecisionPayload>;

export type ApprovalDecisionDto = z.output<typeof approvalDecisionSchema>;
