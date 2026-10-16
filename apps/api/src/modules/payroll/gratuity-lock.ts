import type { EntityManager } from 'typeorm';

/**
 * The tenant's gratuity lock, held to the end of the caller's transaction.
 * Opening posts take it so two cannot both pass "no OPENING row yet";
 * approval and void take it so they never read a balance or cut-over that
 * another of them is about to change.
 *
 * Its own file so EmployeesService can take it without importing
 * GratuityService, which depends on EmployeesService.
 */
export async function lockGratuityOpening(
  manager: EntityManager,
  tenantId: string,
): Promise<void> {
  await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
    `gratuity-opening:${tenantId}`,
  ]);
}
