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
  | 'delivery_note_number'
  | 'employee_number'
  | 'payroll_run_number'
  | 'settlement_number'
  | 'journal_number';

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

/**
 * Renders a tenant's custom number pattern (tenant_sequences.number_pattern,
 * migration 1791700000000). Tokens: `{Y}` = current 4-digit year, `{N}` =
 * raw value, `{N:k}` = value zero-padded to k digits. Everything else is
 * literal. `INV{N:4}` → `INV1035`; `{N:5}` → `00723`.
 */
export function renderNumberPattern(pattern: string, value: number): string {
  return pattern
    .replace(/\{Y\}/g, String(new Date().getFullYear()))
    .replace(/\{N(?::(\d+))?\}/g, (_m, p) =>
      p ? String(value).padStart(Number(p), '0') : String(value),
    );
}

/**
 * Formats an allocated sequence value with the tenant's `number_pattern`
 * when the sequence row carries one, otherwise the default
 * `PREFIX-YYYY-NNNN` shape. Identical to formatSequenceNumber for every
 * sequence that has no pattern set, so existing tenants are unaffected.
 */
export async function formatTenantSequenceNumber(
  manager: EntityManager,
  tenantId: string,
  sequenceName: TenantSequenceName,
  fallbackPrefix: string,
  value: number,
  pad = 4,
): Promise<string> {
  const rows: Array<{ number_pattern: string | null }> = await manager.query(
    `SELECT "number_pattern" FROM "tenant_sequences" WHERE "tenant_id" = $1 AND "sequence_name" = $2`,
    [tenantId, sequenceName],
  );
  const pattern = rows[0]?.number_pattern;
  return pattern
    ? renderNumberPattern(pattern, value)
    : formatSequenceNumber(fallbackPrefix, value, pad);
}
