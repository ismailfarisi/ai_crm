import { MigrationInterface, QueryRunner } from 'typeorm';

interface BreakdownRow {
  net: number;
  tax: number;
  [key: string]: unknown;
}

interface InvoiceRow {
  id: string;
  amount: string;
  tax_amount: string;
  tax_breakdown: BreakdownRow[] | null;
  items: Record<string, unknown>[] | null;
}

const cents = (n: unknown) => Math.round((Number(n) || 0) * 100);

/**
 * Puts right what three old sums left in stored documents. Data only, and no
 * journal entry is touched: the ledger was right throughout.
 *
 * 1. A stage's net was rounded on its own, and on a fixed deposit had the
 *    quote's discount added back, so net + tax could differ from the total:
 *    by a cent on a percentage split, by the discount on a fixed deposit
 *    (5,000 + 200 stored against a total of 4,200). The journal always
 *    credited sales with the total less the tax. The stage and its invoice
 *    are given that net, and the invoice's tax breakdown, which the tax
 *    report and the VAT return read, is scaled to it. Totals and tax, which
 *    are what the customer was charged, do not change.
 *
 * 2. An order line took its total from the quote line's `subtotal`, which a
 *    quote created outside the editor did not carry, so the line was worth
 *    nothing and the margin report gave the order no revenue. Those lines
 *    get the total their quantity, price and quoted discount give.
 */
export class StageInvoiceNetAndOrderLineTotals1792410000000 implements MigrationInterface {
  name = 'StageInvoiceNetAndOrderLineTotals1792410000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`SELECT set_config('app.bypass_rls', 'on', true)`);

    await queryRunner.query(
      `UPDATE "billing_schedule_lines"
          SET "subtotal_amount" = "total_amount" - "tax_amount"
        WHERE "subtotal_amount" + "tax_amount" <> "total_amount"`,
    );

    const invoices = (await queryRunner.query(
      `SELECT "id", "amount", "tax_amount", "tax_breakdown", "items"
         FROM "invoices"
        WHERE ("billing_schedule_line_id" IS NOT NULL OR "delivery_note_id" IS NOT NULL)
          AND "subtotal_amount" + "tax_amount" <> "amount"`,
    )) as InvoiceRow[];
    for (const invoice of invoices) {
      const tax = cents(invoice.tax_amount);
      const net = cents(invoice.amount) - tax;

      const breakdown = invoice.tax_breakdown ?? [];
      const oldNet = breakdown.reduce((sum, row) => sum + cents(row.net), 0);
      let left = net;
      const last = breakdown.length - 1;
      const scaled = breakdown.map((row, index) => {
        const share =
          index === last
            ? left
            : oldNet === 0
              ? 0
              : Math.round((cents(row.net) * net) / oldNet);
        left -= share;
        return { ...row, net: share / 100 };
      });

      // A part invoice is one line describing the stage, priced at its net.
      const items = invoice.items ?? [];
      const stageLine =
        items.length === 1 &&
        typeof items[0].id === 'string' &&
        items[0].id.startsWith('stage-');
      const fixedItems = stageLine
        ? [
            {
              ...items[0],
              unitPrice: net / 100,
              subtotal: net / 100,
              taxRate: net > 0 ? Math.round((tax / net) * 10000) / 100 : 0,
            },
          ]
        : items;

      await queryRunner.query(
        `UPDATE "invoices"
            SET "subtotal_amount" = $1, "tax_breakdown" = $2::jsonb, "items" = $3::jsonb
          WHERE "id" = $4`,
        [
          net / 100,
          invoice.tax_breakdown ? JSON.stringify(scaled) : null,
          JSON.stringify(fixedItems),
          invoice.id,
        ],
      );
    }

    await queryRunner.query(
      `UPDATE "sales_order_lines" l
          SET "line_total" = round(
                l."qty_ordered" * l."unit_price" * (1 - d."discount" / 100), 2)
         FROM "sales_orders" o
         JOIN "quotes" q ON q."id" = o."quote_id"
         CROSS JOIN LATERAL jsonb_array_elements(q."items") item
         CROSS JOIN LATERAL (
           SELECT LEAST(100, GREATEST(0,
             CASE WHEN jsonb_typeof(item->'discount') = 'number'
                  THEN (item->>'discount')::numeric ELSE 0 END)) AS "discount"
         ) d
        WHERE o."id" = l."sales_order_id"
          AND item->>'id' = l."quote_line_id"
          AND l."line_total" = 0
          AND round(l."qty_ordered" * l."unit_price" * (1 - d."discount" / 100), 2) <> 0`,
    );
  }

  /** The figures replaced were wrong and are not kept; there is nothing to restore. */
  public async down(): Promise<void> {}
}
