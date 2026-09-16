import { PERMISSIONS, SKILL_ROUTE_MIN_CONFIDENCE } from '@saas/shared';
import type { AiService } from '../../ai/ai.service';
import { SkillRegistry } from '../skills/skill.registry';
import { SkillRouterService } from '../skills/skill-router.service';
import { replayAiService } from './replay-ai';

/**
 * The cases where the right answer is to do nothing.
 *
 * Every one of these is a way a command layer turns into an incident: a
 * sender nobody linked, a linked sender without the permission, a message the
 * model is unsure about. The assertion each time is that no skill is reached
 * — a question or a refusal is a pass, an action is not.
 */
const registry = new SkillRegistry(
  null as never,
  null as never,
  null as never,
  null as never,
);

const ACTOR = { organizationId: 'org-1', userId: 'user-1' };

describe('eval: refusal', () => {
  it('offers nothing to an unlinked sender', () => {
    // No identity means no permissions were ever resolved, so the candidate
    // list is empty and there is nothing for the model to choose from.
    expect(registry.permittedFor([])).toHaveLength(0);
  });

  it('hides a skill from someone without its permission', () => {
    const permitted = registry.permittedFor([PERMISSIONS.QUOTE_READ]);
    expect(permitted.map((s) => s.name)).not.toContain('purchase_order.create');
  });

  it('shows only what the caller may actually do', () => {
    const permitted = registry.permittedFor([
      PERMISSIONS.PURCHASE_ORDER_CREATE,
    ]);
    expect(permitted.map((s) => s.name)).toEqual(['purchase_order.create']);
  });

  it('routes nowhere when no skill is permitted, without asking the model', async () => {
    const ai = replayAiService(new Map());
    const router = new SkillRouterService(ai as AiService);
    // An empty map would throw if the model were consulted at all.
    const route = await router.route('order 500 sheets', [], ACTOR);
    expect(route.skill).toBeNull();
  });

  it('treats a low-confidence match as no match', async () => {
    const answers = new Map<string, unknown>([
      [
        'channels.route_skill::something about an order maybe',
        { skill: 'purchase_order.create', confidence: 0.3 },
      ],
    ]);
    const router = new SkillRouterService(
      replayAiService(answers) as AiService,
    );
    const candidates = registry.permittedFor([
      PERMISSIONS.PURCHASE_ORDER_CREATE,
    ]);
    const route = await router.route(
      'something about an order maybe',
      candidates,
      ACTOR,
    );
    expect(route.confidence).toBeLessThan(SKILL_ROUTE_MIN_CONFIDENCE);
  });

  it('routes nowhere when the model names a skill the caller cannot use', async () => {
    const answers = new Map<string, unknown>([
      [
        'channels.route_skill::approve QT-2026-0001',
        { skill: 'quote.approve', confidence: 0.99 },
      ],
    ]);
    const router = new SkillRouterService(
      replayAiService(answers) as AiService,
    );
    const candidates = registry.permittedFor([
      PERMISSIONS.PURCHASE_ORDER_CREATE,
    ]);
    const route = await router.route('approve QT-2026-0001', candidates, ACTOR);
    expect(route.skill).toBeNull();
  });
});
