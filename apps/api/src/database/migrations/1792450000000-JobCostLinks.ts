import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Bought-in costs on the job, and the over-budget warning.
 *
 * `sales_order_id` on purchase orders, supplier bills and expense claims says
 * which order the cost is for. It is management costing only: nothing posts
 * differently because of it. `costing_policies.over_budget_alert_pct` is how
 * far past the quoted cost a job may go before it is flagged (0.10 = 10%), and
 * `sales_orders.over_budget_alerted_at` stops the same job alerting twice.
 */
export class JobCostLinks1792450000000 implements MigrationInterface {
  name = 'JobCostLinks1792450000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "purchase_orders" ADD "sales_order_id" uuid`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_purchase_orders_sales_order" ON "purchase_orders" ("sales_order_id") `,
    );
    await queryRunner.query(
      `ALTER TABLE "supplier_bills" ADD "sales_order_id" uuid`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_supplier_bills_sales_order" ON "supplier_bills" ("sales_order_id") `,
    );
    await queryRunner.query(
      `ALTER TABLE "expense_claims" ADD "salesOrderId" uuid`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_expense_claims_sales_order" ON "expense_claims" ("salesOrderId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "costing_policies" ADD "over_budget_alert_pct" numeric(5,4) NOT NULL DEFAULT 0.1`,
    );
    await queryRunner.query(
      `ALTER TABLE "costing_policies" ADD CONSTRAINT "chk_costing_policies_over_budget_alert_pct" CHECK ("over_budget_alert_pct" >= 0 AND "over_budget_alert_pct" <= 5)`,
    );
    await queryRunner.query(
      `ALTER TABLE "sales_orders" ADD "over_budget_alerted_at" TIMESTAMP WITH TIME ZONE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "sales_orders" DROP COLUMN "over_budget_alerted_at"`,
    );
    await queryRunner.query(
      `ALTER TABLE "costing_policies" DROP CONSTRAINT "chk_costing_policies_over_budget_alert_pct"`,
    );
    await queryRunner.query(
      `ALTER TABLE "costing_policies" DROP COLUMN "over_budget_alert_pct"`,
    );
    await queryRunner.query(`DROP INDEX "idx_expense_claims_sales_order"`);
    await queryRunner.query(
      `ALTER TABLE "expense_claims" DROP COLUMN "salesOrderId"`,
    );
    await queryRunner.query(`DROP INDEX "idx_supplier_bills_sales_order"`);
    await queryRunner.query(
      `ALTER TABLE "supplier_bills" DROP COLUMN "sales_order_id"`,
    );
    await queryRunner.query(`DROP INDEX "idx_purchase_orders_sales_order"`);
    await queryRunner.query(
      `ALTER TABLE "purchase_orders" DROP COLUMN "sales_order_id"`,
    );
  }
}
