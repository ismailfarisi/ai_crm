import { CHANNEL_SKILLS, PERMISSIONS, type Permission } from '@saas/shared';
import { SkillRegistry } from './skill.registry';
import { DeliveryDispatchSkill } from './delivery-dispatch.skill';
import { SalesOrderFromDocumentSkill } from './sales-order-from-document.skill';
import { QuoteApproveSkill } from './quote-approve.skill';
import { QuoteCreateSkill } from './quote-create.skill';
import { PurchaseOrderCreateSkill } from './purchase-order-create.skill';
import { WorkOrderLogTimeSkill } from './work-order-log-time.skill';
import { WorkOrderManageSkill } from './work-order-manage.skill';
import { WorkOrderQuerySkill } from './work-order-query.skill';

describe('SkillRegistry', () => {
  let registry: SkillRegistry;

  beforeEach(() => {
    registry = new SkillRegistry(
      {} as any, // quotes
      {} as any, // invoices
      {} as any, // purchasing
      {} as any, // production
      {} as any, // deliveryNotes
      {} as any, // orders
      {} as any, // contacts
    );
  });

  describe('all', () => {
    it('contains all 8 skills', () => {
      const skills = registry.all();
      expect(skills).toHaveLength(8);
      expect(skills.map((s) => s.name)).toEqual([
        CHANNEL_SKILLS.QUOTE_APPROVE,
        CHANNEL_SKILLS.QUOTE_CREATE,
        CHANNEL_SKILLS.PURCHASE_ORDER_CREATE,
        CHANNEL_SKILLS.WORK_ORDER_LOG_TIME,
        CHANNEL_SKILLS.WORK_ORDER_MANAGE,
        CHANNEL_SKILLS.WORK_ORDER_QUERY,
        CHANNEL_SKILLS.DELIVERY_DISPATCH,
        CHANNEL_SKILLS.SALES_ORDER_FROM_DOCUMENT,
      ]);
    });
  });

  describe('byName', () => {
    it('returns QuoteCreateSkill for quote.create', () => {
      const skill = registry.byName(CHANNEL_SKILLS.QUOTE_CREATE);
      expect(skill).toBeInstanceOf(QuoteCreateSkill);
      expect(skill?.name).toBe(CHANNEL_SKILLS.QUOTE_CREATE);
    });

    it('returns DeliveryDispatchSkill for delivery.dispatch', () => {
      const skill = registry.byName(CHANNEL_SKILLS.DELIVERY_DISPATCH);
      expect(skill).toBeInstanceOf(DeliveryDispatchSkill);
      expect(skill?.name).toBe(CHANNEL_SKILLS.DELIVERY_DISPATCH);
    });

    it('returns SalesOrderFromDocumentSkill for sales_order.from_document', () => {
      const skill = registry.byName(CHANNEL_SKILLS.SALES_ORDER_FROM_DOCUMENT);
      expect(skill).toBeInstanceOf(SalesOrderFromDocumentSkill);
      expect(skill?.name).toBe(CHANNEL_SKILLS.SALES_ORDER_FROM_DOCUMENT);
    });

    it('returns QuoteApproveSkill for quote.approve', () => {
      const skill = registry.byName(CHANNEL_SKILLS.QUOTE_APPROVE);
      expect(skill).toBeInstanceOf(QuoteApproveSkill);
    });

    it('returns PurchaseOrderCreateSkill for purchase_order.create', () => {
      const skill = registry.byName(CHANNEL_SKILLS.PURCHASE_ORDER_CREATE);
      expect(skill).toBeInstanceOf(PurchaseOrderCreateSkill);
    });

    it('returns WorkOrderLogTimeSkill for work_order.log_time', () => {
      const skill = registry.byName(CHANNEL_SKILLS.WORK_ORDER_LOG_TIME);
      expect(skill).toBeInstanceOf(WorkOrderLogTimeSkill);
    });

    it('returns WorkOrderManageSkill for work_order.manage', () => {
      const skill = registry.byName(CHANNEL_SKILLS.WORK_ORDER_MANAGE);
      expect(skill).toBeInstanceOf(WorkOrderManageSkill);
    });

    it('returns WorkOrderQuerySkill for work_order.query', () => {
      const skill = registry.byName(CHANNEL_SKILLS.WORK_ORDER_QUERY);
      expect(skill).toBeInstanceOf(WorkOrderQuerySkill);
    });

    it('returns undefined for an unknown skill name', () => {
      const skill = registry.byName('unknown.skill' as any);
      expect(skill).toBeUndefined();
    });
  });

  describe('permittedFor', () => {
    it('returns empty array when user has no permissions', () => {
      expect(registry.permittedFor([])).toEqual([]);
    });

    it('returns empty array when user permissions do not match any skill', () => {
      expect(registry.permittedFor([PERMISSIONS.QUOTE_READ])).toEqual([]);
    });

    it('returns only DeliveryDispatchSkill when user has DELIVERY_NOTE_DISPATCH permission', () => {
      const permitted = registry.permittedFor([
        PERMISSIONS.DELIVERY_NOTE_DISPATCH,
      ]);
      expect(permitted).toHaveLength(1);
      expect(permitted[0]).toBeInstanceOf(DeliveryDispatchSkill);
      expect(permitted[0].name).toBe(CHANNEL_SKILLS.DELIVERY_DISPATCH);
    });

    it('returns only SalesOrderFromDocumentSkill when user has SALES_ORDER_UPDATE permission', () => {
      const permitted = registry.permittedFor([PERMISSIONS.SALES_ORDER_UPDATE]);
      expect(permitted).toHaveLength(1);
      expect(permitted[0]).toBeInstanceOf(SalesOrderFromDocumentSkill);
      expect(permitted[0].name).toBe(CHANNEL_SKILLS.SALES_ORDER_FROM_DOCUMENT);
    });

    it('returns both newly added skills when user has both permissions', () => {
      const permitted = registry.permittedFor([
        PERMISSIONS.DELIVERY_NOTE_DISPATCH,
        PERMISSIONS.SALES_ORDER_UPDATE,
      ]);
      expect(permitted).toHaveLength(2);
      expect(permitted.map((s) => s.name)).toEqual([
        CHANNEL_SKILLS.DELIVERY_DISPATCH,
        CHANNEL_SKILLS.SALES_ORDER_FROM_DOCUMENT,
      ]);
    });

    it('returns all 8 skills when user has all required permissions', () => {
      const allPermissions: Permission[] = [
        PERMISSIONS.QUOTE_APPROVE,
        PERMISSIONS.QUOTE_CREATE,
        PERMISSIONS.PURCHASE_ORDER_CREATE,
        PERMISSIONS.WORK_ORDER_EXECUTE,
        PERMISSIONS.WORK_ORDER_READ,
        PERMISSIONS.DELIVERY_NOTE_DISPATCH,
        PERMISSIONS.SALES_ORDER_UPDATE,
      ];
      const permitted = registry.permittedFor(allPermissions);
      expect(permitted).toHaveLength(8);
      expect(permitted.map((s) => s.name)).toEqual([
        CHANNEL_SKILLS.QUOTE_APPROVE,
        CHANNEL_SKILLS.QUOTE_CREATE,
        CHANNEL_SKILLS.PURCHASE_ORDER_CREATE,
        CHANNEL_SKILLS.WORK_ORDER_LOG_TIME,
        CHANNEL_SKILLS.WORK_ORDER_MANAGE,
        CHANNEL_SKILLS.WORK_ORDER_QUERY,
        CHANNEL_SKILLS.DELIVERY_DISPATCH,
        CHANNEL_SKILLS.SALES_ORDER_FROM_DOCUMENT,
      ]);
    });
  });
});
