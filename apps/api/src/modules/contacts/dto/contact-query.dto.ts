import type { z } from 'zod';
import type { contactQuerySchema } from '@saas/shared';

/** The *parsed* query — defaults applied, page/limit already coerced to numbers. */
export type ContactQueryDto = z.output<typeof contactQuerySchema>;
