import type { z } from 'zod';
import type { customerQuerySchema } from '@saas/shared';

export type CustomerQueryDto = z.output<typeof customerQuerySchema>;
