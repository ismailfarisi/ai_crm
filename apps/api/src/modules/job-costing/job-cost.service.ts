import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';

/**
 * The actual labour cost of jobs. Skeleton until Task 6 fills in the
 * recompute of a completed work order's `actualCost`.
 */
@Injectable()
export class JobCostService {
  /**
   * Rewrites `actualCost` (and the labour split) of the given COMPLETE work
   * orders. Callers hold `lockJobCosting` and the work order rows.
   */
  /* eslint-disable @typescript-eslint/no-unused-vars -- skeleton until Task 6 */
  async recompute(
    _manager: EntityManager,
    _tenantId: string,
    _workOrderIds: string[],
  ): Promise<void> {
    // Filled in by Task 6.
  }
  /* eslint-enable @typescript-eslint/no-unused-vars */
}
