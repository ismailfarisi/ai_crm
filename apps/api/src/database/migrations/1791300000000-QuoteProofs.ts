import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Artwork proofs and customer responses on the public quote link.
 *
 * `quote_proofs` versions the proof files (ordinary quote attachments) a
 * customer is asked to approve. The quote gains the customer's last response
 * short of accepting, and whether accepting waits for an approved proof,
 * defaulted from the organisation.
 */
export class QuoteProofs1791300000000 implements MigrationInterface {
  name = 'QuoteProofs1791300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "quote_proofs" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "quote_id" uuid NOT NULL,
        "attachment_id" uuid NOT NULL,
        "version" integer NOT NULL,
        "status" character varying(30) NOT NULL DEFAULT 'PENDING',
        "staff_note" text,
        "uploaded_by_id" uuid,
        "responded_at" TIMESTAMP WITH TIME ZONE,
        "responded_by_name" character varying(255),
        "response_comment" text,
        "responded_ip" character varying(64),
        "superseded_at" TIMESTAMP WITH TIME ZONE,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_quote_proofs_id" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_quote_proofs_status" CHECK ("status" IN ('PENDING', 'APPROVED', 'CHANGES_REQUESTED')),
        CONSTRAINT "FK_quote_proofs_tenant" FOREIGN KEY ("tenant_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT "FK_quote_proofs_quote" FOREIGN KEY ("quote_id") REFERENCES "quotes"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT "FK_quote_proofs_attachment" FOREIGN KEY ("attachment_id") REFERENCES "attachments"("id") ON DELETE CASCADE ON UPDATE NO ACTION
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_quote_proofs_version" ON "quote_proofs" ("quote_id", "version")`,
    );
    await queryRunner.query(`ALTER TABLE "quote_proofs" ENABLE ROW LEVEL SECURITY`);
    await queryRunner.query(`ALTER TABLE "quote_proofs" FORCE ROW LEVEL SECURITY`);
    await queryRunner.query(
      `CREATE POLICY tenant_isolation_policy ON "quote_proofs" FOR ALL ` +
        `USING (current_setting('app.bypass_rls', true) = 'on' OR "tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid) ` +
        `WITH CHECK (current_setting('app.bypass_rls', true) = 'on' OR "tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)`,
    );

    await queryRunner.query(`
      ALTER TABLE "quotes"
        ADD COLUMN "proof_required" boolean,
        ADD COLUMN "customer_response" character varying(30),
        ADD COLUMN "customer_response_note" text,
        ADD COLUMN "customer_responded_at" TIMESTAMP WITH TIME ZONE,
        ADD COLUMN "customer_responded_by_name" character varying(255),
        ADD CONSTRAINT "CHK_quotes_customer_response" CHECK ("customer_response" IS NULL OR "customer_response" IN ('DECLINED', 'CHANGES_REQUESTED'))
    `);
    await queryRunner.query(
      `ALTER TABLE "organizations" ADD COLUMN "quote_proof_required_default" boolean NOT NULL DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "organizations" DROP COLUMN "quote_proof_required_default"`,
    );
    await queryRunner.query(`
      ALTER TABLE "quotes"
        DROP CONSTRAINT "CHK_quotes_customer_response",
        DROP COLUMN "customer_responded_by_name",
        DROP COLUMN "customer_responded_at",
        DROP COLUMN "customer_response_note",
        DROP COLUMN "customer_response",
        DROP COLUMN "proof_required"
    `);
    await queryRunner.query(`DROP TABLE "quote_proofs"`);
  }
}
