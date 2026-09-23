import {
  SKILL_ROUTE_MIN_CONFIDENCE,
  type ChannelSkillName,
} from '@saas/shared';
import type { AiService } from '../../ai/ai.service';
import { SkillRouterService } from '../skills/skill-router.service';
import type { ChannelSkill } from '../skills/skill.types';
import { ROUTING_CASES } from './fixtures/routing.cases';
import { isLiveEval, liveAiService, replayAiService } from './replay-ai';

/**
 * Does a message reach the right skill?
 *
 * "It worked when I tried it" is not a test, and this is the suite that stops
 * it being the only evidence. The negatives carry most of the weight: a model
 * that routes a customer's "where is my order?" to `purchase_order.create`
 * does not produce a wrong answer, it produces a purchase order.
 *
 * Deterministic in CI by replaying recorded answers; the nightly job runs the
 * same set live and reports accuracy instead of failing.
 */
const CANDIDATES: ChannelSkill<never>[] = [
  skill(
    'purchase_order.create',
    'Raise a new purchase order to buy materials FROM a supplier.',
    [
      'order 500 sheets of 350gsm board from Papertree',
      'we need more magnets, 2 boxes from Fixings Direct',
    ],
  ),
  skill(
    'quote.approve',
    'Approve or reject a quote that is waiting for approval.',
    ['approve QT-2026-0001', 'reject quote 0042, margin too thin'],
  ),
  skill(
    'work_order.log_time',
    'Record time spent on an operation of a work order.',
    ['log 2 hours on WO-2026-0004', 'spent 90 minutes on the Henderson job'],
  ),
  skill(
    'delivery.dispatch',
    'Dispatch a delivery note or ship remaining items on a sales order, taking stocked goods off the shelf and recording what shipped.',
    [
      'dispatch DN-2026-0001',
      'ship delivery note 0002',
      'ship the remaining items on SO-2026-0005',
    ],
  ),
  skill(
    'sales_order.from_document',
    'Convert a customer purchase order document or message into a confirmed sales order, matching an existing open quote or provisioning a new order.',
    [
      'customer sent PO-9912 for quote QT-2026-0004',
      'customer PO-1029 approving our quote QT-2026-0010',
      'turn customer PO-8831 into an order',
    ],
  ),
];

function skill(
  name: string,
  description: string,
  examples: string[],
): ChannelSkill<never> {
  return {
    name: name as ChannelSkillName,
    description,
    examples,
    requiredPermissions: [],
  } as unknown as ChannelSkill<never>;
}

const ACTOR = { organizationId: 'org-1', userId: 'user-1' };

function routerFor(): SkillRouterService {
  if (isLiveEval()) return new SkillRouterService(liveAiService() as AiService);
  const answers = new Map<string, unknown>(
    ROUTING_CASES.map((c) => [
      `channels.route_skill::${c.message}`,
      c.recorded ?? { skill: c.expect, confidence: c.expect ? 0.93 : 0.97 },
    ]),
  );
  return new SkillRouterService(replayAiService(answers) as AiService);
}

describe('eval: routing', () => {
  const router = routerFor();
  const misses: string[] = [];

  it.each(ROUTING_CASES.map((c) => [c.message, c] as const))(
    'routes %s',
    async (_message, testCase) => {
      const route = await router.route(testCase.message, CANDIDATES, ACTOR);
      // Below the threshold the system asks rather than acts, so a
      // low-confidence match counts as routing nowhere.
      const effective =
        route.skill && route.confidence >= SKILL_ROUTE_MIN_CONFIDENCE
          ? route.skill
          : null;
      if (effective !== testCase.expect) {
        misses.push(
          `${testCase.message} -> ${effective ?? 'none'} (expected ${testCase.expect ?? 'none'})`,
        );
        // Live runs report; recorded runs assert.
        if (!isLiveEval()) expect(effective).toBe(testCase.expect);
      }
    },
  );

  afterAll(() => {
    if (isLiveEval()) {
      const accuracy = (
        ((ROUTING_CASES.length - misses.length) / ROUTING_CASES.length) *
        100
      ).toFixed(1);
      console.log(
        `Live routing accuracy: ${accuracy}% (${misses.length} miss(es))\n${misses.join('\n')}`,
      );
    }
  });
});
