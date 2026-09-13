import { Injectable } from '@nestjs/common';
import type { ChannelSkillName, Permission } from '@saas/shared';
import { QuotesService } from '../../quotes/quotes.service';
import { InvoicesService } from '../../quotes/invoices.service';
import { PurchasingService } from '../../purchasing/purchasing.service';
import type { ChannelSkill } from './skill.types';
import { QuoteApproveSkill } from './quote-approve.skill';
import { PurchaseOrderCreateSkill } from './purchase-order-create.skill';

/**
 * The one file to touch when adding a staff chat capability.
 *
 * Mirrors `createActionHandlerRegistry` on the customer-facing side. A sprint
 * that adds a document type writes a skill file and one line here; it does
 * not add a branch to a growing service or a boolean to a growing intent
 * schema.
 */
@Injectable()
export class SkillRegistry {
  private readonly skills: ChannelSkill<never>[];

  constructor(
    quotes: QuotesService,
    invoices: InvoicesService,
    purchasing: PurchasingService,
  ) {
    this.skills = [
      new QuoteApproveSkill(quotes, invoices) as unknown as ChannelSkill<never>,
      new PurchaseOrderCreateSkill(
        purchasing,
      ) as unknown as ChannelSkill<never>,
    ];
  }

  all(): ChannelSkill<never>[] {
    return this.skills;
  }

  byName(name: ChannelSkillName): ChannelSkill<never> | undefined {
    return this.skills.find((skill) => skill.name === name);
  }

  /**
   * The skills this caller may actually use.
   *
   * The router is only ever shown this list. Filtering before the model call
   * means an unauthorised action cannot be routed to in the first place, and
   * the refusal the user eventually sees is about what they asked for rather
   * than a catalogue of what exists.
   */
  permittedFor(permissions: Permission[]): ChannelSkill<never>[] {
    return this.skills.filter((skill) =>
      skill.requiredPermissions.every((required) =>
        permissions.includes(required),
      ),
    );
  }
}
