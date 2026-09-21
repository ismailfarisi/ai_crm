import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Lets an agent name the model it runs on.
 *
 * The model was only ever a property of the AI *provider*, held inside its
 * encrypted credentials and applied to every call the organisation made — the
 * skill router, receipt scanning, intent classification and the agents alike.
 * So an organisation that wanted its conversational agent on a stronger model
 * than its receipt scanner had to move all of them or none.
 *
 * Both columns are nullable, and null is the normal state: it means "use the
 * provider's model". Nothing is backfilled, because every agent that exists
 * today is running on the provider default and should carry on doing exactly
 * that — writing today's provider model onto each row would freeze them all at
 * the moment of this migration and quietly detach them from the setting they
 * are meant to follow.
 *
 * The provider keeps its model, which is what makes this additive: no call
 * site loses its model, and an agent that names nothing behaves as before.
 */
export class AddAgentModel1787400000000 implements MigrationInterface {
  name = 'AddAgentModel1787400000000';

  /** table -> column. */
  private static readonly TARGETS: [string, string][] = [
    ['ai_agents', 'model'],
    ['intent_agent_configs', 'model'],
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const [table, column] of AddAgentModel1787400000000.TARGETS) {
      await queryRunner.query(
        `ALTER TABLE "${table}" ADD COLUMN IF NOT EXISTS "${column}" character varying(120)`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const [table, column] of [
      ...AddAgentModel1787400000000.TARGETS,
    ].reverse()) {
      await queryRunner.query(
        `ALTER TABLE "${table}" DROP COLUMN IF EXISTS "${column}"`,
      );
    }
  }
}
