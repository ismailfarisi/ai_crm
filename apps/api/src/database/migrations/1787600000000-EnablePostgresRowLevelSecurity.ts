import { MigrationInterface, QueryRunner } from 'typeorm';

const TENANT_TABLES = [
  'attachments',
  'audit_logs',
  'bill_payments',
  'billing_events',
  'billing_schedule_lines',
  'catalog_items',
  'catalog_materials',
  'catalog_tooling',
  'catalog_work_centers',
  'contacts',
  'costing_policies',
  'credit_note_lines',
  'credit_note_refunds',
  'credit_notes',
  'customers',
  'delivery_note_lines',
  'delivery_notes',
  'document_templates',
  'fx_rates',
  'goods_receipt_lines',
  'goods_receipts',
  'invitations',
  'invoice_payments',
  'invoices',
  'ledger_accounts',
  'notifications',
  'product_templates',
  'purchase_order_lines',
  'purchase_orders',
  'purchase_policies',
  'quotes',
  'roles',
  'sales_order_lines',
  'sales_orders',
  'stock_items',
  'stock_locations',
  'stock_movements',
  'subscription_items',
  'subscriptions',
  'supplier_bill_lines',
  'supplier_bills',
  'supplier_materials',
  'suppliers',
  'tax_codes',
  'tax_rules',
  'teams',
  'tenant_sequences',
  'users',
  'work_order_materials',
  'work_order_operations',
  'work_orders',
];

export class EnablePostgresRowLevelSecurity1787600000000 implements MigrationInterface {
  name = 'EnablePostgresRowLevelSecurity1787600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const table of TENANT_TABLES) {
      await queryRunner.query(
        `ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY;`,
      );
      await queryRunner.query(
        `ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY;`,
      );
      await queryRunner.query(
        `DROP POLICY IF EXISTS tenant_isolation_policy ON "${table}";`,
      );
      await queryRunner.query(
        `CREATE POLICY tenant_isolation_policy ON "${table}" FOR ALL ` +
          `USING (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid) ` +
          `WITH CHECK (current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const table of [...TENANT_TABLES].reverse()) {
      await queryRunner.query(
        `DROP POLICY IF EXISTS tenant_isolation_policy ON "${table}";`,
      );
      await queryRunner.query(
        `ALTER TABLE "${table}" NO FORCE ROW LEVEL SECURITY;`,
      );
      await queryRunner.query(
        `ALTER TABLE "${table}" DISABLE ROW LEVEL SECURITY;`,
      );
    }
  }
}
