import { PurchaseOrderCreateSkill } from '../skills/purchase-order-create.skill';
import { QuoteApproveSkill } from '../skills/quote-approve.skill';
import { WorkOrderLogTimeSkill } from '../skills/work-order-log-time.skill';
import type { ChannelSkill } from '../skills/skill.types';
import { EXTRACTION_CASES } from './fixtures/extraction.cases';

/**
 * Golden extractions, checked through the real slot schemas.
 *
 * The assertion is deliberately on what survives `slotSchema.parse`, not on
 * what the model said: the schema is the boundary a service sees, and a case
 * like "minus 5 boxes" is passing precisely when the model's output does
 * *not* survive it.
 */
const SKILLS: Record<string, ChannelSkill<never>> = {
  'purchase_order.create': new PurchaseOrderCreateSkill(
    null as never,
  ) as unknown as ChannelSkill<never>,
  'quote.approve': new QuoteApproveSkill(
    null as never,
    null as never,
  ) as unknown as ChannelSkill<never>,
  'work_order.log_time': new WorkOrderLogTimeSkill(
    null as never,
  ) as unknown as ChannelSkill<never>,
};

describe('eval: extraction', () => {
  it.each(
    EXTRACTION_CASES.map((c) => [`${c.skill}: ${c.message}`, c] as const),
  )('%s', (_label, testCase) => {
    const skill = SKILLS[testCase.skill];
    const parsed = skill.slotSchema.safeParse(testCase.recorded);
    expect(parsed.success ? parsed.data : {}).toEqual(testCase.slots);
  });

  it('every registered skill has a prompt version to diff against', () => {
    for (const skill of Object.values(SKILLS)) {
      expect(skill.promptVersion).toMatch(/\/\d+$/);
    }
  });
});
