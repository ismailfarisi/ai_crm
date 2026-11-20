import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AUTOMATION_TEMPLATES, buildTemplateGraph } from './templates';
import { crmEventOf, sampleTriggerFor } from './crm-events';

/**
 * The recipes as the gallery creates them, with the sample each one's event
 * sends. The API runs every one of these through the real workflow and steps
 * (`recipes.e2e.spec.ts`), so a recipe that reads a field its event does not
 * send, or uses a step the worker does not run, fails there.
 *
 * After changing a recipe: UPDATE_RECIPE_FIXTURE=1 npx vitest run src/components/automations/recipes-fixture.spec.ts
 */
const FIXTURE = resolve(__dirname, '../../../../api/src/modules/automations/workflows/recipes.fixture.json');

const teamEmail = 'owner@shop.ae';

function build() {
  return AUTOMATION_TEMPLATES.flatMap((template) =>
    (template.id === 'invoice-overdue-reminder' ? [false, true] : [false]).map((aiEmailToCustomers) => {
      const graph = buildTemplateGraph(template.id, { aiEmailToCustomers, teamEmail });
      return {
        id: template.id,
        aiEmailToCustomers,
        triggerType: graph.triggerType,
        trigger: sampleTriggerFor(crmEventOf(graph.triggerConfig)) ?? {},
        nodes: graph.nodes,
        edges: graph.edges,
      };
    }),
  );
}

describe('recipe fixture for the API', () => {
  it('matches the recipes the gallery creates', () => {
    const current = JSON.parse(JSON.stringify(build()));
    if (process.env.UPDATE_RECIPE_FIXTURE || !existsSync(FIXTURE)) {
      writeFileSync(FIXTURE, `${JSON.stringify(current, null, 2)}\n`);
    }
    expect(JSON.parse(readFileSync(FIXTURE, 'utf8'))).toEqual(current);
  });
});
