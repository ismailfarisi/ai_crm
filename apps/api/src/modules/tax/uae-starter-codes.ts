import type { EntityManager } from 'typeorm';
import {
  UAE_STARTER_CODES,
  UAE_STARTER_RULES,
  treatmentIsReverseCharge,
} from '@saas/shared';

/**
 * Why a UAE tenant with a TRN is still not in UAE VAT mode when its base
 * currency is not dirhams. Shared by the organization update, which refuses
 * the change, and the VAT status, which lists it as a problem.
 */
export const uaeBaseCurrencyProblem = (baseCurrency: string): string =>
  `Your base currency is ${baseCurrency}. UAE VAT returns are in AED, and the base currency cannot change once anything is posted.`;

/**
 * Gives a tenant the UAE starter tax codes and the rules that pick them.
 *
 * A plain function rather than a service method so the organizations module
 * can call it inside its own transaction without importing the tax module.
 *
 * Safe to run more than once: a code the tenant already has (same kind and
 * code) is left exactly as it is, and so is a rule for the same match. Rules
 * resolve their code by `(kind, code)`, so they point at whichever row holds
 * that code, seeded now or before.
 *
 * The one thing it does change: the 0% `ZERO` codes every tenant is given at
 * signup carry no treatment, and UAE VAT mode refuses to save a code without
 * one. They are what they say — zero-rated — so they are marked so here.
 */
export async function seedUaeStarterCodes(
  manager: EntityManager,
  tenantId: string,
): Promise<void> {
  const codeParams: unknown[] = [tenantId];
  const codeRows = UAE_STARTER_CODES.map((c) => {
    const at = codeParams.length;
    codeParams.push(
      c.code,
      c.name,
      c.rate,
      c.kind,
      treatmentIsReverseCharge(c.treatment),
      c.treatment,
    );
    const p = (n: number) => `$${at + n}`;
    return `($1, ${p(1)}, ${p(2)}, ${p(3)}, ${p(4)}, ${p(5)}, ${p(6)})`;
  });
  await manager.query(
    `INSERT INTO "tax_codes" ("tenant_id", "code", "name", "rate", "kind", "is_reverse_charge", "treatment")
     VALUES ${codeRows.join(', ')}
     ON CONFLICT ("tenant_id", "kind", "code") DO NOTHING`,
    codeParams,
  );

  const ruleParams: unknown[] = [tenantId];
  const ruleRows = UAE_STARTER_RULES.map((r) => {
    const at = ruleParams.length;
    ruleParams.push(r.kind, r.country, r.code);
    return `($${at + 1}, $${at + 2}, $${at + 3})`;
  });
  await manager.query(
    `INSERT INTO "tax_rules" ("tenant_id", "kind", "country", "requires_tax_id", "tax_code_id")
     SELECT $1::uuid, r.kind, r.country, false, c."id"
     FROM (VALUES ${ruleRows.join(', ')}) AS r(kind, country, code)
     JOIN "tax_codes" c
       ON c."tenant_id" = $1::uuid AND c."kind" = r.kind AND c."code" = r.code
     ON CONFLICT ("tenant_id", "kind", "country", "requires_tax_id") DO NOTHING`,
    ruleParams,
  );

  await manager.query(
    `UPDATE "tax_codes" SET "treatment" = 'ZERO_RATED'
     WHERE "tenant_id" = $1 AND "code" = 'ZERO' AND "rate" = 0
       AND "is_reverse_charge" = false AND "treatment" IS NULL`,
    [tenantId],
  );
}
