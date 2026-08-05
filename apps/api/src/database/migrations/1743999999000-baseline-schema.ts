import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Baseline: the complete pre-existing schema.
 *
 * Before this migration, every table was created by TypeORM `synchronize` in
 * development (see `app.module.ts`) and there were no migrations at all. That
 * left production with no path from an empty database to a working schema.
 *
 * This file captures the schema as the entities define it today:
 *   - organizations, users, roles, permissions, contacts, refresh_tokens
 *   - the `role_permissions` / `user_roles` join tables
 *   - the `contact_status` / `contact_source` enum types
 *   - indexes and foreign keys
 *
 * It must run BEFORE the feature migrations (teams etc.) on a fresh database.
 *
 * Names here are explicit and stable (e.g. `organizations_pkey`) rather than
 * TypeORM's SHA-1 truncated hashes, because these tables are only ever created
 * by migrations from now on.
 *
 * If an existing database was previously created by `synchronize`, it already
 * has these tables. On first deploy, mark this baseline as applied WITHOUT
 * running its SQL by inserting its row into the `migrations` table:
 *
 *   INSERT INTO "migrations" ("id", "timestamp", "name")
 *   VALUES (1, 1743999999000, 'BaselineSchema1743999999000');
 *
 * then run `migration:run` — only the feature migrations (teams etc.) execute.
 */
export class BaselineSchema1743999999000 implements MigrationInterface {
  name = 'BaselineSchema1743999999000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // uuid PKs use `uuid_generate_v4()`, which lives in the uuid-ossp extension.
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);

    // ─── Enums ────────────────────────────────────────────────────────────────
    await queryRunner.query(
      `CREATE TYPE "contacts_status_enum" AS ENUM ('lead', 'qualified', 'customer', 'churned', 'archived')`,
    );
    await queryRunner.query(
      `CREATE TYPE "contacts_source_enum" AS ENUM ('website', 'referral', 'outbound', 'event', 'partner', 'other')`,
    );

    // ─── organizations ────────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE "organizations" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        "name" varchar(120) NOT NULL,
        "slug" varchar(140) NOT NULL,
        CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_organizations_slug" ON "organizations" ("slug")`,
    );

    // ─── users ────────────────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE "users" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        "organizationId" uuid NOT NULL,
        "email" varchar(255) NOT NULL,
        "passwordHash" varchar(255) NOT NULL,
        "firstName" varchar(80) NOT NULL,
        "lastName" varchar(80) NOT NULL,
        "isActive" boolean NOT NULL DEFAULT true,
        "lastLoginAt" timestamptz,
        "credentialsChangedAt" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "users_pkey" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`CREATE UNIQUE INDEX "uq_users_email" ON "users" ("email")`);

    // ─── permissions (global catalog) ─────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE "permissions" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        "key" varchar(100) NOT NULL,
        "subject" varchar(50) NOT NULL,
        "action" varchar(50) NOT NULL,
        "description" varchar(255) NOT NULL DEFAULT '',
        CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`CREATE UNIQUE INDEX "uq_permissions_key" ON "permissions" ("key")`);

    // ─── roles (per-organization) ─────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE "roles" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        "organizationId" uuid NOT NULL,
        "name" varchar(60) NOT NULL,
        "slug" varchar(60) NOT NULL,
        "description" varchar(300) NOT NULL DEFAULT '',
        "isSystem" boolean NOT NULL DEFAULT false,
        "level" int NOT NULL DEFAULT 100,
        "grantsAllPermissions" boolean NOT NULL DEFAULT false,
        CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_roles_org_slug" ON "roles" ("organizationId", "slug")`,
    );

    // ─── contacts ─────────────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE "contacts" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        "deletedAt" timestamptz,
        "organizationId" uuid NOT NULL,
        "firstName" varchar(80) NOT NULL,
        "lastName" varchar(80) NOT NULL,
        "email" varchar(255),
        "phone" varchar(40),
        "company" varchar(120),
        "jobTitle" varchar(120),
        "status" "contacts_status_enum" NOT NULL DEFAULT 'lead',
        "source" "contacts_source_enum" NOT NULL DEFAULT 'other',
        "notes" text,
        "ownerId" uuid,
        CONSTRAINT "contacts_pkey" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_contacts_org_created" ON "contacts" ("organizationId", "createdAt")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_contacts_org_owner" ON "contacts" ("organizationId", "ownerId")`,
    );

    // ─── refresh_tokens ───────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE "refresh_tokens" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        "userId" uuid NOT NULL,
        "tokenHash" varchar(128) NOT NULL,
        "familyId" uuid NOT NULL,
        "expiresAt" timestamptz NOT NULL,
        "revokedAt" timestamptz,
        "userAgent" varchar(255),
        "ipAddress" varchar(64),
        CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`CREATE INDEX "idx_refresh_tokens_user" ON "refresh_tokens" ("userId")`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_refresh_tokens_hash" ON "refresh_tokens" ("tokenHash")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_refresh_tokens_family" ON "refresh_tokens" ("familyId")`,
    );

    // ─── Join tables ──────────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE "role_permissions" (
        "roleId" uuid NOT NULL,
        "permissionId" uuid NOT NULL,
        CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("roleId", "permissionId")
      )
    `);
    await queryRunner.query(`
      CREATE TABLE "user_roles" (
        "userId" uuid NOT NULL,
        "roleId" uuid NOT NULL,
        CONSTRAINT "user_roles_pkey" PRIMARY KEY ("userId", "roleId")
      )
    `);

    // ─── Foreign keys ─────────────────────────────────────────────────────────
    await queryRunner.query(`
      ALTER TABLE "users" ADD CONSTRAINT "users_organizationId_fk"
        FOREIGN KEY ("organizationId") REFERENCES "organizations" ("id") ON DELETE CASCADE
    `);

    await queryRunner.query(`
      ALTER TABLE "roles" ADD CONSTRAINT "roles_organizationId_fk"
        FOREIGN KEY ("organizationId") REFERENCES "organizations" ("id") ON DELETE CASCADE
    `);

    await queryRunner.query(`
      ALTER TABLE "contacts" ADD CONSTRAINT "contacts_organizationId_fk"
        FOREIGN KEY ("organizationId") REFERENCES "organizations" ("id") ON DELETE CASCADE
    `);
    await queryRunner.query(`
      ALTER TABLE "contacts" ADD CONSTRAINT "contacts_ownerId_fk"
        FOREIGN KEY ("ownerId") REFERENCES "users" ("id") ON DELETE SET NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_userId_fk"
        FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE
    `);

    await queryRunner.query(`
      ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_roleId_fk"
        FOREIGN KEY ("roleId") REFERENCES "roles" ("id") ON DELETE CASCADE
    `);
    await queryRunner.query(`
      ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permissionId_fk"
        FOREIGN KEY ("permissionId") REFERENCES "permissions" ("id") ON DELETE CASCADE
    `);

    await queryRunner.query(`
      ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_userId_fk"
        FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE
    `);
    await queryRunner.query(`
      ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_roleId_fk"
        FOREIGN KEY ("roleId") REFERENCES "roles" ("id") ON DELETE CASCADE
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop FK constraints, then tables, then enums/extension. Order matters.
    await queryRunner.query(`ALTER TABLE "user_roles" DROP CONSTRAINT "user_roles_roleId_fk"`);
    await queryRunner.query(`ALTER TABLE "user_roles" DROP CONSTRAINT "user_roles_userId_fk"`);
    await queryRunner.query(`ALTER TABLE "role_permissions" DROP CONSTRAINT "role_permissions_permissionId_fk"`);
    await queryRunner.query(`ALTER TABLE "role_permissions" DROP CONSTRAINT "role_permissions_roleId_fk"`);
    await queryRunner.query(`ALTER TABLE "refresh_tokens" DROP CONSTRAINT "refresh_tokens_userId_fk"`);
    await queryRunner.query(`ALTER TABLE "contacts" DROP CONSTRAINT "contacts_ownerId_fk"`);
    await queryRunner.query(`ALTER TABLE "contacts" DROP CONSTRAINT "contacts_organizationId_fk"`);
    await queryRunner.query(`ALTER TABLE "roles" DROP CONSTRAINT "roles_organizationId_fk"`);
    await queryRunner.query(`ALTER TABLE "users" DROP CONSTRAINT "users_organizationId_fk"`);

    await queryRunner.query(`DROP TABLE "user_roles"`);
    await queryRunner.query(`DROP TABLE "role_permissions"`);
    await queryRunner.query(`DROP TABLE "refresh_tokens"`);
    await queryRunner.query(`DROP TABLE "contacts"`);
    await queryRunner.query(`DROP TABLE "roles"`);
    await queryRunner.query(`DROP TABLE "permissions"`);
    await queryRunner.query(`DROP TABLE "users"`);
    await queryRunner.query(`DROP TABLE "organizations"`);

    await queryRunner.query(`DROP TYPE "contacts_source_enum"`);
    await queryRunner.query(`DROP TYPE "contacts_status_enum"`);
  }
}
