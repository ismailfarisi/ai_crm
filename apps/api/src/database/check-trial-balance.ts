import 'reflect-metadata';
import { AppDataSource } from './data-source';

/**
 * The cheapest detector for a sprint that posted an unbalanced journal entry.
 *
 * Every tenant's debits must equal its credits. Checked at the merge gate
 * rather than at month end, because by month end nobody remembers which
 * change did it.
 */
async function main(): Promise<void> {
  await AppDataSource.initialize();
  try {
    const rows = await AppDataSource.query<
      { tenant_id: string; name: string; difference: string }[]
    >(`
      SELECT j."tenantId" AS tenant_id,
             o."name" AS name,
             ROUND(SUM((line->>'debit')::numeric - (line->>'credit')::numeric), 2) AS difference
      FROM "journal_entries" j
      CROSS JOIN LATERAL jsonb_array_elements(j."lines") AS line
      LEFT JOIN "organizations" o ON o."id" = j."tenantId"
      GROUP BY j."tenantId", o."name"
      ORDER BY o."name"
    `);

    if (rows.length === 0) {
      console.log('No journal entries to check.');
      return;
    }

    const unbalanced = rows.filter((r) => Number(r.difference) !== 0);
    for (const row of rows) {
      const label = `${row.name ?? row.tenant_id}: ${row.difference}`;
      console.log(
        Number(row.difference) === 0 ? `  ok   ${label}` : `  FAIL ${label}`,
      );
    }
    if (unbalanced.length) {
      console.error(
        `\n${unbalanced.length} tenant(s) have a trial balance that does not sum to zero.`,
      );
      process.exitCode = 1;
      return;
    }
    console.log(`\nTrial balance sums to zero for ${rows.length} tenant(s).`);
  } finally {
    await AppDataSource.destroy();
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
