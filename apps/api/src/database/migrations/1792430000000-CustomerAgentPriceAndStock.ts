import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Price and stock answers for customer agents.
 *
 * `catalog_items.show_price_to_customers` marks the items whose list price a
 * customer agent may give; every existing item starts unmarked.
 * `channel_agents.showStockQuantity` lets an agent give how many are in stock
 * rather than only in stock / low / out; every existing agent starts without.
 */
export class CustomerAgentPriceAndStock1792430000000
  implements MigrationInterface
{
  name = 'CustomerAgentPriceAndStock1792430000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "catalog_items" ADD "show_price_to_customers" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "channel_agents" ADD "showStockQuantity" boolean NOT NULL DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "channel_agents" DROP COLUMN "showStockQuantity"`,
    );
    await queryRunner.query(
      `ALTER TABLE "catalog_items" DROP COLUMN "show_price_to_customers"`,
    );
  }
}
