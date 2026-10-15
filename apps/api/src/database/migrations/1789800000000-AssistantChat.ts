import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Tables behind the in-app assistant chat.
 *
 * `assistant_conversations` is one user's private chat (owner = tenant + user).
 * `assistant_turns` is one agent workflow run started by one user message; a
 * partial unique index allows at most one RUNNING / AWAITING_APPROVAL turn per
 * conversation. `assistant_messages` is both the transcript and the stream of
 * events, ordered by the BIGSERIAL `seq` (the SSE event id) and deduplicated
 * per turn by `event_key`.
 *
 * Foreign keys and CHECK constraints live here rather than on the entities
 * (the drift check ignores them). All three tables are tenant-isolated by RLS
 * like every other tenant table.
 */
export class AssistantChat1789800000000 implements MigrationInterface {
  name = 'AssistantChat1789800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "assistant_conversations" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "user_id" uuid NOT NULL,
        "title" character varying(200) NOT NULL DEFAULT 'New chat',
        "context" jsonb,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "archived_at" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "PK_assistant_conversations_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_assistant_conversations_tenant" FOREIGN KEY ("tenant_id") REFERENCES "organizations"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_assistant_conversations_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_assistant_conversations_owner_recent" ON "assistant_conversations" ("tenant_id", "user_id", "updated_at")`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "assistant_turns" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "conversation_id" uuid NOT NULL,
        "user_message_id" uuid,
        "workflow_id" character varying(200) NOT NULL,
        "status" character varying(20) NOT NULL DEFAULT 'RUNNING',
        "pending_action" jsonb,
        "steps" integer NOT NULL DEFAULT 0,
        "model" character varying(100),
        "error" text,
        "last_progress_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "finished_at" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "PK_assistant_turns_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_assistant_turns_tenant" FOREIGN KEY ("tenant_id") REFERENCES "organizations"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_assistant_turns_conversation" FOREIGN KEY ("conversation_id") REFERENCES "assistant_conversations"("id") ON DELETE CASCADE,
        CONSTRAINT "chk_assistant_turns_status" CHECK ("status" IN ('RUNNING','AWAITING_APPROVAL','COMPLETED','REJECTED','TIMED_OUT','FAILED','CANCELLED'))
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "uq_assistant_turns_one_active_per_conversation" ON "assistant_turns" ("conversation_id") WHERE "status" IN ('RUNNING', 'AWAITING_APPROVAL')`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "assistant_messages" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "conversation_id" uuid NOT NULL,
        "turn_id" uuid,
        "event_key" character varying(200),
        "seq" BIGSERIAL NOT NULL,
        "role" character varying(16) NOT NULL,
        "content" text NOT NULL,
        "tool_name" character varying(120),
        "payload" jsonb,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_assistant_messages_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_assistant_messages_tenant" FOREIGN KEY ("tenant_id") REFERENCES "organizations"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_assistant_messages_conversation" FOREIGN KEY ("conversation_id") REFERENCES "assistant_conversations"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_assistant_messages_turn" FOREIGN KEY ("turn_id") REFERENCES "assistant_turns"("id") ON DELETE CASCADE,
        CONSTRAINT "chk_assistant_messages_role" CHECK ("role" IN ('user','assistant','step','tool_call','tool_result','approval','status'))
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_assistant_messages_conversation_seq" ON "assistant_messages" ("conversation_id", "seq")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "uq_assistant_messages_turn_event" ON "assistant_messages" ("turn_id", "event_key")`,
    );

    for (const table of ['assistant_conversations', 'assistant_turns', 'assistant_messages']) {
      await queryRunner.query(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`);
      await queryRunner.query(`ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY`);
      await queryRunner.query(`DROP POLICY IF EXISTS tenant_isolation_policy ON "${table}"`);
      await queryRunner.query(
        `CREATE POLICY tenant_isolation_policy ON "${table}" FOR ALL ` +
          `USING (current_setting('app.bypass_rls', true) = 'on' OR "tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid) ` +
          `WITH CHECK (current_setting('app.bypass_rls', true) = 'on' OR "tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "assistant_messages"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "assistant_turns"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "assistant_conversations"`);
  }
}
