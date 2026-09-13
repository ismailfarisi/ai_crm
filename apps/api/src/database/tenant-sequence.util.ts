import type { EntityManager } from 'typeorm';

/**
 * Registry of per-tenant number sequences backed by the `tenant_sequences`
 * table (see migration 1786100000000). Deliberately not a TypeORM entity —
 * it's accessed only via raw upserts, so `migration:generate` never sees it
 * and can't propose "fixing" it.
 */
export type TenantSequenceName =
  | 'quote_number'
  | 'invoice_number'
  | 'claim_number'
  // Pre-allocated for the rest of the roadmap. Adding a name costs nothing —
  // rows are created on demand by the upsert below, so an unused name never
  // writes one — and declaring them together avoids six branches each editing
  // this same line.
  | 'purchase_order_number'
  | 'goods_receipt_number'
  | 'bill_number'
  | 'sales_order_number'
  | 'work_order_number'
  | 'credit_note_number'
  | 'delivery_note_number';

/**
 * Atomically allocates and returns the next integer for (tenantId, sequenceName).
 * Plain function (no DI) so it works from a Nest service's `repository.manager`
 * and from the DI-free Temporal activity's `AppDataSource.manager` alike.
 */
export async function allocateNextSequenceValue(
  manager: EntityManager,
  tenantId: string,
  sequenceName: TenantSequenceName,
): Promise<number> {
  const rows: Array<{ current_value: number }> = await manager.query(
    `INSERT INTO "tenant_sequences" ("tenant_id", "sequence_name", "current_value")
     VALUES ($1, $2, 1)
     ON CONFLICT ("tenant_id", "sequence_name")
     DO UPDATE SET "current_value" = "tenant_sequences"."current_value" + 1, "updated_at" = now()
     RETURNING "current_value"`,
    [tenantId, sequenceName],
  );
  return Number(rows[0].current_value);
}

/** Non-mutating "what would the next value be" — for preview-only call sites. */
export async function peekNextSequenceValue(
  manager: EntityManager,
  tenantId: string,
  sequenceName: TenantSequenceName,
): Promise<number> {
  const rows: Array<{ current_value: number }> = await manager.query(
    `SELECT "current_value" FROM "tenant_sequences" WHERE "tenant_id" = $1 AND "sequence_name" = $2`,
    [tenantId, sequenceName],
  );
  return Number(rows[0]?.current_value ?? 0) + 1;
}

export function formatSequenceNumber(
  prefix: string,
  value: number,
  pad = 4,
): string {
  const year = new Date().getFullYear();
  return `${prefix}-${year}-${String(value).padStart(pad, '0')}`;
}
