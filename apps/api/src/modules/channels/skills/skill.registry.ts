import { Injectable } from '@nestjs/common';
import type { ChannelSkillName, Permission } from '@saas/shared';
import { QuotesService } from '../../quotes/quotes.service';
import { InvoicesService } from '../../quotes/invoices.service';
import { PurchasingService } from '../../purchasing/purchasing.service';
import { ProductionService } from '../../production/production.service';
import { DeliveryNotesService } from '../../orders/delivery-notes.service';
import { OrdersService } from '../../orders/orders.service';
import type { ChannelSkill, SkillSurface } from './skill.types';
import { QuoteApproveSkill } from './quote-approve.skill';
import { QuoteCreateSkill } from './quote-create.skill';
import { PurchaseOrderCreateSkill } from './purchase-order-create.skill';
import { WorkOrderLogTimeSkill } from './work-order-log-time.skill';
import { DeliveryDispatchSkill } from './delivery-dispatch.skill';
import { SalesOrderFromDocumentSkill } from './sales-order-from-document.skill';
import { WorkOrderManageSkill } from './work-order-manage.skill';
import { WorkOrderQuerySkill } from './work-order-query.skill';
import { ContactsService } from '../../contacts/contacts.service';
import { ModuleRef } from '@nestjs/core';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
import { ChannelMessage } from '../entities/channel-message.entity';
import type { ChannelsService } from '../channels.service';
import { CHANNEL_SENDER } from './channel-sender.token';
import { SkillActorService } from '../services/skill-actor.service';
import { ChannelThreadReadSkill } from './channel-thread-read.skill';
import { ChannelMessageSendSkill } from './channel-message-send.skill';
import { BillFromDocumentSkill } from './bill-from-document.skill';
import { BillCaptureService } from '../../payables/bill-capture.service';
import { PayablesService } from '../../payables/payables.service';
import { AttachmentsService } from '../../storage/attachments.service';

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
    production: ProductionService,
    deliveryNotes: DeliveryNotesService,
    orders: OrdersService,
    contacts: ContactsService,
    actors: SkillActorService,
    @InjectRepository(ChannelMessage) channelMessages: Repository<ChannelMessage>,
    moduleRef: ModuleRef,
    billCapture: BillCaptureService,
    payables: PayablesService,
    attachments: AttachmentsService,
  ) {
    // ChannelsService depends (via ChannelCommandService) on this registry, so
    // it is looked up when a send executes, never at construction.
    const channels = () =>
      moduleRef.get<ChannelsService>(CHANNEL_SENDER, { strict: false });
    this.skills = [
      new QuoteApproveSkill(quotes, invoices) as unknown as ChannelSkill<never>,
      new QuoteCreateSkill(quotes, contacts) as unknown as ChannelSkill<never>,
      new PurchaseOrderCreateSkill(
        purchasing,
      ) as unknown as ChannelSkill<never>,
      new WorkOrderLogTimeSkill(production) as unknown as ChannelSkill<never>,
      new WorkOrderManageSkill(
        production,
      ) as unknown as ChannelSkill<never>,
      new WorkOrderQuerySkill(
        production,
      ) as unknown as ChannelSkill<never>,
      new DeliveryDispatchSkill(
        deliveryNotes,
        orders,
      ) as unknown as ChannelSkill<never>,
      new SalesOrderFromDocumentSkill(
        quotes,
        orders,
      ) as unknown as ChannelSkill<never>,
      new ChannelThreadReadSkill(contacts, actors, channelMessages) as unknown as ChannelSkill<never>,
      new ChannelMessageSendSkill(contacts, actors, channelMessages, channels) as unknown as ChannelSkill<never>,
      new BillFromDocumentSkill(
        billCapture,
        payables,
        attachments,
        actors,
        channels,
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
   *
   * `surface` narrows the list to skills offered there (a skill without
   * `surfaces` is offered everywhere). Omitting it skips that filter.
   */
  permittedFor(
    permissions: Permission[],
    surface?: SkillSurface,
  ): ChannelSkill<never>[] {
    return this.skills.filter(
      (skill) =>
        (!surface || !skill.surfaces || skill.surfaces.includes(surface)) &&
        skill.requiredPermissions.every((required) =>
          permissions.includes(required),
        ),
    );
  }
}
