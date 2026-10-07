import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { CustomRecordLink } from '../entities/custom-record-link.entity';
import { Customer } from '@/modules/customers/entities/customer.entity';
import { Contact } from '@/modules/contacts/entities/contact.entity';
import { Quote } from '@/modules/quotes/entities/quote.entity';
import { WorkOrder } from '@/modules/production/entities/work-order.entity';

@Injectable()
export class CoreEntityBridgeService {
  constructor(
    @InjectRepository(CustomRecordLink)
    private readonly linkRepo: Repository<CustomRecordLink>,
    @InjectRepository(Customer)
    private readonly customerRepo: Repository<Customer>,
    @InjectRepository(Contact)
    private readonly contactRepo: Repository<Contact>,
    @InjectRepository(Quote)
    private readonly quoteRepo: Repository<Quote>,
    @InjectRepository(WorkOrder)
    private readonly workOrderRepo: Repository<WorkOrder>,
  ) {}

  async link(tenantId: string, payload: any): Promise<CustomRecordLink> {
    const link = this.linkRepo.create({
      ...payload,
      tenantId,
    } as Partial<CustomRecordLink>);
    return this.linkRepo.save(link);
  }

  async unlink(tenantId: string, linkId: string): Promise<void> {
    await this.linkRepo.delete({ id: linkId, tenantId });
  }

  async getRecordLinks(tenantId: string, sourceRecordId: string): Promise<any[]> {
    const links = await this.linkRepo.find({
      where: { tenantId, sourceRecordId },
      relations: { relationship: true },
      order: { createdAt: 'ASC' },
    });

    if (!links || links.length === 0) {
      return [];
    }

    const summaryMap = new Map<string, Record<string, any>>();

    const customerIds: string[] = [];
    const contactIds: string[] = [];
    const quoteIds: string[] = [];
    const workOrderIds: string[] = [];

    for (const link of links) {
      const targetCore = link.relationship?.targetCoreEntity || (link.targetType as string);
      if (targetCore === 'customer') {
        customerIds.push(link.targetRecordId);
      } else if (targetCore === 'contact') {
        contactIds.push(link.targetRecordId);
      } else if (targetCore === 'quote') {
        quoteIds.push(link.targetRecordId);
      } else if (targetCore === 'work_order') {
        workOrderIds.push(link.targetRecordId);
      }
    }

    if (customerIds.length > 0) {
      const uniqueIds = Array.from(new Set(customerIds));
      const customers = await this.customerRepo.find({
        where: { tenantId, id: In(uniqueIds) },
      });
      for (const c of customers) {
        summaryMap.set(c.id, {
          id: c.id,
          name: (c as any).name ?? c.companyName,
          email: c.email,
        });
      }
    }

    if (contactIds.length > 0) {
      const uniqueIds = Array.from(new Set(contactIds));
      const contacts = await this.contactRepo.find({
        where: { tenantId, id: In(uniqueIds) },
      });
      for (const c of contacts) {
        summaryMap.set(c.id, {
          id: c.id,
          name: (c as any).name ?? (c.fullName || `${c.firstName ?? ''} ${c.lastName ?? ''}`.trim()),
          email: c.email,
        });
      }
    }

    if (quoteIds.length > 0) {
      const uniqueIds = Array.from(new Set(quoteIds));
      const quotes = await this.quoteRepo.find({
        where: { tenantId, id: In(uniqueIds) },
      });
      for (const q of quotes) {
        summaryMap.set(q.id, {
          id: q.id,
          name: (q as any).name ?? q.quoteNumber ?? q.title,
          quoteNumber: q.quoteNumber,
          title: q.title,
          status: q.status,
          totalAmount: q.totalAmount,
        });
      }
    }

    if (workOrderIds.length > 0) {
      const uniqueIds = Array.from(new Set(workOrderIds));
      const workOrders = await this.workOrderRepo.find({
        where: { tenantId, id: In(uniqueIds) },
      });
      for (const wo of workOrders) {
        summaryMap.set(wo.id, {
          id: wo.id,
          name: (wo as any).name ?? wo.woNumber ?? wo.description,
          woNumber: wo.woNumber,
          status: wo.status,
          description: wo.description,
        });
      }
    }

    return links.map((link) => {
      const targetSummary = summaryMap.get(link.targetRecordId);
      return {
        ...link,
        ...(targetSummary ? { targetSummary } : {}),
      };
    });
  }

  async getReverseLinksForCoreEntity(
    tenantId: string,
    targetType: string,
    targetId: string,
  ): Promise<CustomRecordLink[]> {
    const where: any = {
      tenantId,
      targetRecordId: targetId,
    };
    if (targetType) {
      where.targetType = targetType;
    }
    return this.linkRepo.find({
      where,
      relations: {
        sourceRecord: { object: true },
        relationship: true,
      },
    });
  }
}
