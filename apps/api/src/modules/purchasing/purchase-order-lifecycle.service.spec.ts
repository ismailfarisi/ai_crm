import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PERMISSIONS, type PurchaseOrderStatus } from '@saas/shared';
import { PurchaseOrderLifecycleService } from './purchase-order-lifecycle.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

const tenantId = '11111111-1111-1111-1111-111111111111';
const raiser = 'user-raiser';
const approver = 'user-approver';

const ALL = [
  PERMISSIONS.PURCHASE_ORDER_CREATE,
  PERMISSIONS.PURCHASE_ORDER_UPDATE,
  PERMISSIONS.PURCHASE_ORDER_APPROVE,
  PERMISSIONS.PURCHASE_ORDER_APPROVE_ABOVE_THRESHOLD,
];
const APPROVER_ONLY = [PERMISSIONS.PURCHASE_ORDER_APPROVE];

function makeService(seed: {
  order?: Partial<{ status: PurchaseOrderStatus; totalAmount: number; submittedById: string | null }>;
  policy?: any;
  preferred?: any[];
} = {}) {
  const order: any = {
    id: 'po-1',
    tenantId,
    poNumber: 'PO-2026-0042',
    supplierId: 'sup-1',
    status: 'DRAFT' as PurchaseOrderStatus,
    totalAmount: 210,
    submittedById: null,
    deletedAt: null,
    lines: [
      {
        id: 'line-1',
        description: '350gsm board SRA2',
        qtyOrdered: 500,
        unitCost: 0.42,
        lineTotal: 210,
        materialId: 'mat-1',
      },
    ],
    ...seed.order,
  };

  const orders = {
    findOne: jest.fn(async ({ where }: any) =>
      where.id === order.id && where.tenantId === tenantId ? order : null,
    ),
    save: jest.fn(async (o: any) => o),
  };
  const policies = {
    findOne: jest.fn(async () => seed.policy ?? null),
    create: jest.fn((dto: any) => dto),
    save: jest.fn(async (p: any) => p),
  };
  const supplierMaterials = { find: jest.fn(async () => seed.preferred ?? []) };

  const service = new PurchaseOrderLifecycleService(
    orders as any,
    policies as any,
    supplierMaterials as any,
  );
  return { service, order, orders, policies };
}

const enforcedPolicy = {
  approvalThreshold: 500,
  requirePreferredSupplier: false,
  varianceTolerancePct: 0.05,
  enforce: true,
};

describe('PurchaseOrderLifecycleService', () => {
  describe('getPolicy', () => {
    it('falls back to an unenforced default when no row exists', async () => {
      const { service } = makeService();
      const policy = await service.getPolicy(tenantId);

      // Absence means "not configured", which must not mean "blocked".
      expect(policy.enforce).toBe(false);
      expect(policy.approvalThreshold).toBe(500);
    });
  });

  describe('submit', () => {
    it('moves a draft to awaiting approval', async () => {
      const { service, order } = makeService();

      const saved = await service.submit(tenantId, 'po-1', { userId: raiser, permissions: ALL });

      expect(saved.status).toBe('AWAITING_APPROVAL');
      expect(saved.submittedById).toBe(raiser);
      expect(order.submittedAt).toBeInstanceOf(Date);
    });

    it('lets an over-threshold order through to approval', async () => {
      // The threshold is a question for the approver, not a reason to stop
      // the person raising it.
      const { service } = makeService({
        order: { totalAmount: 900 },
        policy: enforcedPolicy,
      });

      const saved = await service.submit(tenantId, 'po-1', { userId: raiser, permissions: ALL });
      expect(saved.status).toBe('AWAITING_APPROVAL');
    });

    it('refuses an order with no lines, enforced or not', async () => {
      const { service, order } = makeService();
      order.lines = [];
      order.totalAmount = 0;

      // NO_LINES is not overridable: an order with nothing on it cannot be
      // sent to anybody, whatever permissions the sender holds.
      await expect(
        service.submit(tenantId, 'po-1', { userId: raiser, permissions: ALL }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('refuses a zero-value order', async () => {
      const { service, order } = makeService();
      order.totalAmount = 0;
      order.lines = [{ ...order.lines[0], lineTotal: 0, unitCost: 0 }];

      await expect(
        service.submit(tenantId, 'po-1', { userId: raiser, permissions: ALL }),
      ).rejects.toThrow(/totals zero/);
    });

    it('will not submit an order that is already approved', async () => {
      const { service } = makeService({ order: { status: 'APPROVED' } });

      await expect(
        service.submit(tenantId, 'po-1', { userId: raiser, permissions: ALL }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('will not touch another tenant’s order', async () => {
      const { service } = makeService();
      await expect(
        service.submit('22222222-2222-2222-2222-222222222222', 'po-1', {
          userId: raiser,
          permissions: ALL,
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('approve', () => {
    const awaiting = { status: 'AWAITING_APPROVAL' as PurchaseOrderStatus, submittedById: raiser };

    it('approves an order under the threshold with only the base permission', async () => {
      const { service } = makeService({ order: awaiting, policy: enforcedPolicy });

      const saved = await service.approve(tenantId, 'po-1', {
        userId: approver,
        permissions: APPROVER_ONLY,
      });

      expect(saved.status).toBe('APPROVED');
      expect(saved.approvedById).toBe(approver);
    });

    it('refuses above the threshold without the escalated permission', async () => {
      const { service } = makeService({
        order: { ...awaiting, totalAmount: 900 },
        policy: enforcedPolicy,
      });

      await expect(
        service.approve(tenantId, 'po-1', { userId: approver, permissions: APPROVER_ONLY }),
      ).rejects.toThrow(/900.00.*500.00/);
    });

    it('allows it with the escalated permission', async () => {
      const { service } = makeService({
        order: { ...awaiting, totalAmount: 900 },
        policy: enforcedPolicy,
      });

      const saved = await service.approve(tenantId, 'po-1', {
        userId: approver,
        permissions: ALL,
      });
      expect(saved.status).toBe('APPROVED');
    });

    it('ignores the threshold entirely while the policy is unenforced', async () => {
      const { service } = makeService({ order: { ...awaiting, totalAmount: 9999 } });

      const saved = await service.approve(tenantId, 'po-1', {
        userId: approver,
        permissions: APPROVER_ONLY,
      });
      expect(saved.status).toBe('APPROVED');
    });

    it('refuses without the approve permission at all', async () => {
      const { service } = makeService({ order: awaiting });

      await expect(
        service.approve(tenantId, 'po-1', {
          userId: approver,
          permissions: [PERMISSIONS.PURCHASE_ORDER_UPDATE],
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('stops someone approving their own over-threshold order', async () => {
      // Separation of duties is the entire point of a threshold.
      const { service } = makeService({
        order: { ...awaiting, submittedById: approver, totalAmount: 900 },
        policy: enforcedPolicy,
      });

      await expect(
        service.approve(tenantId, 'po-1', { userId: approver, permissions: APPROVER_ONLY }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('lets someone approve their own order below the threshold', async () => {
      const { service } = makeService({
        order: { ...awaiting, submittedById: approver, totalAmount: 100 },
        policy: enforcedPolicy,
      });

      const saved = await service.approve(tenantId, 'po-1', {
        userId: approver,
        permissions: APPROVER_ONLY,
      });
      expect(saved.status).toBe('APPROVED');
    });

    it('will not approve a draft that was never submitted', async () => {
      const { service } = makeService({ order: { status: 'DRAFT' } });

      await expect(
        service.approve(tenantId, 'po-1', { userId: approver, permissions: ALL }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('cancel', () => {
    it('cancels an order that has not been received', async () => {
      const { service } = makeService({ order: { status: 'SENT' } });

      const saved = await service.cancel(
        tenantId,
        'po-1',
        { userId: approver, permissions: ALL },
        'Supplier out of stock',
      );

      expect(saved.status).toBe('CANCELLED');
      expect(saved.cancelReason).toBe('Supplier out of stock');
    });

    it('refuses once goods have arrived', async () => {
      // Cancelling would strand stock that was already received.
      const { service } = makeService({ order: { status: 'PARTIALLY_RECEIVED' } });

      await expect(
        service.cancel(tenantId, 'po-1', { userId: approver, permissions: ALL }, null),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('markSent', () => {
    it('only sends an approved order', async () => {
      const { service } = makeService({ order: { status: 'AWAITING_APPROVAL' } });
      await expect(service.markSent(tenantId, 'po-1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('stamps sentAt on an approved order', async () => {
      const { service } = makeService({ order: { status: 'APPROVED' } });
      const saved = await service.markSent(tenantId, 'po-1');

      expect(saved.status).toBe('SENT');
      expect(saved.sentAt).toBeInstanceOf(Date);
    });
  });
});
