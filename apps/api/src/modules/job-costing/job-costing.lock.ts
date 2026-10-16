import type { EntityManager } from 'typeorm';

/**
 * The tenant's job costing lock, held to the end of the caller's transaction.
 * Payroll approval and void take it so their absorption never interleaves
 * with a production path (stop, finish, log time, complete, cancel) or a
 * timesheet write moving the same hours.
 *
 * Lock order, always: payroll run row → lockGratuityOpening → lockJobCosting
 * → work order rows. Production paths that touch labour take it as the first
 * statement in their transaction.
 */
export async function lockJobCosting(
  manager: EntityManager,
  tenantId: string,
): Promise<void> {
  await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
    `job-costing:${tenantId}`,
  ]);
}
