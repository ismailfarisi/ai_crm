import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * What each job was planned with, so the costing review can tell how far
 * the catalog's allowances were off.
 *
 * A job's planned quantities already include the material's waste allowance
 * and the work centre's time allowance as they stood when the job was
 * created. Recording those two numbers beside the plan lets the review
 * measure against them rather than against today's catalog — otherwise
 * accepting a correction would make the same jobs propose it again.
 *
 * Jobs created before this have no baseline (null) and are left out of the
 * waste and time review; their prices still count.
 */
export class CostingPlanBaseline1791000000000 implements MigrationInterface {
  name = 'CostingPlanBaseline1791000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "work_order_materials" ADD COLUMN "planned_waste_pct" numeric(5,4)`,
    );
    await queryRunner.query(
      `ALTER TABLE "work_order_operations" ADD COLUMN "planned_scrap_pct" numeric(5,4)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "work_order_operations" DROP COLUMN "planned_scrap_pct"`,
    );
    await queryRunner.query(
      `ALTER TABLE "work_order_materials" DROP COLUMN "planned_waste_pct"`,
    );
  }
}
