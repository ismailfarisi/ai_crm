import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Team hierarchy: a `teams` table and `teamId`/`managerId` columns on `users`.
 *
 * The `teams` table is NOT a join table — it is a first-class entity so a team
 * can have a lead and a name, and so `users.teamId` points at it directly.
 *
 * Runs AFTER the baseline migration. Names match what TypeORM generates from
 * the entities (SHA-1 FK names, index on `organizationId` only — the `@Index`
 * decorator on the column ignores its column list), so a fresh migrated
 * database has zero drift from the entities.
 */
export class AddTeamsAndManagerRelation1744000000000 implements MigrationInterface {
  name = 'AddTeamsAndManagerRelation1744000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "teams" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        "deletedAt" timestamptz,
        "organizationId" uuid NOT NULL,
        "name" varchar(80) NOT NULL,
        "leadId" uuid,
        CONSTRAINT "teams_pkey" PRIMARY KEY ("id")
      )
    `);

    // Matches what TypeORM actually creates from `@Index('idx_teams_org_name', ...)`.
    await queryRunner.query(
      `CREATE UNIQUE INDEX "idx_teams_org_name" ON "teams" ("organizationId")`,
    );

    // The reporting columns on users.
    await queryRunner.query(`ALTER TABLE "users" ADD COLUMN "teamId" uuid`);
    await queryRunner.query(`ALTER TABLE "users" ADD COLUMN "managerId" uuid`);

    await queryRunner.query(
      `CREATE INDEX "idx_users_team" ON "users" ("teamId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_users_manager" ON "users" ("managerId")`,
    );

    // FK: teams.organizationId → organizations.id (cascade delete)
    await queryRunner.query(`
      ALTER TABLE "teams" ADD CONSTRAINT "FK_858389ddeb0bd6c6bf4e323f91e"
        FOREIGN KEY ("organizationId") REFERENCES "organizations" ("id") ON DELETE CASCADE
    `);

    // FK: teams.leadId → users.id (SET NULL on user deletion)
    await queryRunner.query(`
      ALTER TABLE "teams" ADD CONSTRAINT "FK_57df8ae026047892351083299d3"
        FOREIGN KEY ("leadId") REFERENCES "users" ("id") ON DELETE SET NULL
    `);

    // FK: users.teamId → teams.id (SET NULL on team deletion)
    await queryRunner.query(`
      ALTER TABLE "users" ADD CONSTRAINT "FK_d1803064187c8f38e57a9c4984c"
        FOREIGN KEY ("teamId") REFERENCES "teams" ("id") ON DELETE SET NULL
    `);

    // FK: users.managerId → users.id (self-referential, SET NULL)
    await queryRunner.query(`
      ALTER TABLE "users" ADD CONSTRAINT "FK_874662e039ab7d31a71450eb501"
        FOREIGN KEY ("managerId") REFERENCES "users" ("id") ON DELETE SET NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop FKs first, then indexes, then columns, then the table.
    await queryRunner.query(
      `ALTER TABLE "users" DROP CONSTRAINT "FK_874662e039ab7d31a71450eb501"`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" DROP CONSTRAINT "FK_d1803064187c8f38e57a9c4984c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "teams" DROP CONSTRAINT "FK_57df8ae026047892351083299d3"`,
    );
    await queryRunner.query(
      `ALTER TABLE "teams" DROP CONSTRAINT "FK_858389ddeb0bd6c6bf4e323f91e"`,
    );

    await queryRunner.query(`DROP INDEX "idx_users_manager"`);
    await queryRunner.query(`DROP INDEX "idx_users_team"`);
    await queryRunner.query(`DROP INDEX "idx_teams_org_name"`);

    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "teamId"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "managerId"`);

    await queryRunner.query(`DROP TABLE "teams"`);
  }
}
