import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, IsNull, Repository } from 'typeorm';
import {
  blockingViolations,
  canTransition,
  DEFAULT_PURCHASE_POLICY,
  evaluatePurchaseGuardrails,
  PERMISSIONS,
  type Permission,
  type PurchaseGuardrailViolation,
  type PurchaseOrderStatus,
  type PurchasePolicy,
} from '@saas/shared';
import { PurchaseOrder } from './entities/purchase-order.entity';
import { PurchaseOrderLine } from './entities/purchase-order-line.entity';
import { lockPurchaseOrder } from './purchase-order-lock';
import { InventoryService } from '../inventory/inventory.service';
import { PurchasePolicyEntity } from './entities/purchase-policy.entity';
import { SupplierMaterial } from './entities/supplier-material.entity';

export interface Actor {
  userId: string;
  /** The actor's own resolved effective permissions, never a role. */
  permissions: Permission[];
}

/**
 * Moving a purchase order through its life.
 *
 * Kept apart from `PurchasingService` because this is where the rules live,
 * and rules are worth being able to read in one sitting. Two of them are
 * load-bearing:
 *
 * - every transition is checked against `PURCHASE_ORDER_TRANSITIONS`, so an
 *   order cannot skip approval by any route, including the chat layer;
 * - the threshold is compared against the *actor's own* effective
 *   permissions, the same rule `assertActorCanGrant` follows in RBAC. Never
 *   against a role, which would sweep in more powerful roles the actor does
 *   not hold.
 */
@Injectable()
export class PurchaseOrderLifecycleService {
  constructor(
    @InjectRepository(PurchaseOrder)
    private readonly orders: Repository<PurchaseOrder>,
    @InjectRepository(PurchasePolicyEntity)
    private readonly policies: Repository<PurchasePolicyEntity>,
    @InjectRepository(SupplierMaterial)
    private readonly supplierMaterials: Repository<SupplierMaterial>,
    @InjectRepository(PurchaseOrderLine)
    private readonly orderLines: Repository<PurchaseOrderLine>,
    private readonly inventory: InventoryService,
  ) {}

  /** Absence of a row means "not configured", which means not enforced. */
  async getPolicy(tenantId: string): Promise<PurchasePolicy> {
    const row = await this.policies.findOne({ where: { tenantId } });
    if (!row) return { ...DEFAULT_PURCHASE_POLICY };
    return {
      approvalThreshold: row.approvalThreshold,
      requirePreferredSupplier: row.requirePreferredSupplier,
      varianceTolerancePct: row.varianceTolerancePct,
      enforce: row.enforce,
    };
  }

  async updatePolicy(
    tenantId: string,
    input: Partial<PurchasePolicy>,
  ): Promise<PurchasePolicy> {
    const existing = await this.policies.findOne({ where: { tenantId } });
    const row =
      existing ??
      this.policies.create({ tenantId, ...DEFAULT_PURCHASE_POLICY });
    Object.assign(row, input);
    await this.policies.save(row);
    return this.getPolicy(tenantId);
  }

  /**
   * What the policy says about this order as it stands.
   *
   * Exposed on its own so the editor can show the same warnings the API will
   * enforce, before anyone clicks submit.
   */
  async check(
    tenantId: string,
    orderId: string,
  ): Promise<PurchaseGuardrailViolation[]> {
    const order = await this.load(tenantId, orderId);
    return this.evaluate(tenantId, order);
  }

  private async evaluate(
    tenantId: string,
    order: PurchaseOrder,
  ): Promise<PurchaseGuardrailViolation[]> {
    const policy = await this.getPolicy(tenantId);

    let preferredSupplierByMaterial: Record<string, string> | undefined;
    if (policy.enforce && policy.requirePreferredSupplier) {
      const materialIds = (order.lines ?? [])
        .map((l) => l.materialId)
        .filter((id): id is string => Boolean(id));
      if (materialIds.length > 0) {
        const preferred = await this.supplierMaterials.find({
          where: { tenantId, isPreferred: true },
        });
        preferredSupplierByMaterial = Object.fromEntries(
          preferred
            .filter((p) => materialIds.includes(p.materialId))
            .map((p) => [p.materialId, p.supplierId]),
        );
      }
    }

    return evaluatePurchaseGuardrails(
      (order.lines ?? []).map((l) => ({
        id: l.id,
        description: l.description,
        qtyOrdered: l.qtyOrdered,
        unitCost: l.unitCost,
        lineTotal: l.lineTotal,
        materialId: l.materialId,
      })),
      order.totalAmount,
      policy,
      { supplierId: order.supplierId, preferredSupplierByMaterial },
    );
  }

  /* ------------------------------------------------------------------ *
   * Transitions
   *
   * Each one runs in a single transaction that starts by locking the order
   * and its lines (`lockPurchaseOrder`: order, then lines, then any stock
   * rows - the same order a goods receipt takes them in). The transition is
   * checked against the locked row, so two concurrent approvals cannot both
   * pass `assertTransition` and both add to `qty_on_order`, and the status
   * change and the on-order adjustment commit or roll back together.
   * ------------------------------------------------------------------ */

  /**
   * Send a draft for approval.
   *
   * Guardrails run here rather than at approval so the person who raised the
   * order finds out it is over threshold while they can still change it.
   */
  async submit(
    tenantId: string,
    orderId: string,
    actor: Actor,
  ): Promise<PurchaseOrder> {
    return this.inTransaction(tenantId, orderId, async (order, manager) => {
      this.assertTransition(order.status, 'AWAITING_APPROVAL', order.poNumber);

      const violations = await this.evaluate(tenantId, order);
      const hard = violations.filter((v) => !v.overridable);
      if (hard.length > 0) {
        throw new BadRequestException(hard.map((v) => v.message).join(' '));
      }

      order.status = 'AWAITING_APPROVAL';
      order.submittedAt = new Date();
      order.submittedById = actor.userId;
      return manager.getRepository(PurchaseOrder).save(order);
    });
  }

  /** Back to draft for changes. Only from awaiting approval. */
  async reopen(tenantId: string, orderId: string): Promise<PurchaseOrder> {
    return this.inTransaction(tenantId, orderId, async (order, manager) => {
      this.assertTransition(order.status, 'DRAFT', order.poNumber);

      order.status = 'DRAFT';
      order.submittedAt = null;
      order.submittedById = null;
      return manager.getRepository(PurchaseOrder).save(order);
    });
  }

  async approve(
    tenantId: string,
    orderId: string,
    actor: Actor,
  ): Promise<PurchaseOrder> {
    return this.inTransaction(tenantId, orderId, async (order, manager) => {
      this.assertTransition(order.status, 'APPROVED', order.poNumber);

      if (!actor.permissions.includes(PERMISSIONS.PURCHASE_ORDER_APPROVE)) {
        throw new ForbiddenException(
          'You do not have permission to approve purchase orders.',
        );
      }

      // Compared against what this actor actually holds. Checking a role here
      // instead would let anyone who happens to share a role name approve
      // beyond their own authority.
      const canOverride = actor.permissions.includes(
        PERMISSIONS.PURCHASE_ORDER_APPROVE_ABOVE_THRESHOLD,
      );
      const violations = await this.evaluate(tenantId, order);
      const blocking = blockingViolations(violations, canOverride);

      if (blocking.length > 0) {
        // Name the limit and the actual figure — a refusal that does not say
        // which number was wrong just sends someone hunting.
        throw new ForbiddenException(blocking.map((v) => v.message).join(' '));
      }

      // An approver cannot wave through their own order unless they could have
      // approved it above threshold anyway; separation of duties is the whole
      // point of a threshold.
      if (order.submittedById === actor.userId && !canOverride) {
        const policy = await this.getPolicy(tenantId);
        if (policy.enforce && order.totalAmount > policy.approvalThreshold) {
          throw new ForbiddenException(
            'You cannot approve an order you submitted yourself when it is above the threshold.',
          );
        }
      }

      order.status = 'APPROVED';
      order.approvedAt = new Date();
      order.approvedById = actor.userId;
      const saved = await manager.getRepository(PurchaseOrder).save(order);

      // From here the shortage has been dealt with, so the reorder check must
      // stop suggesting it. Counted at approval rather than at sending: that is
      // when the organisation committed to the purchase.
      await this.inventory.adjustOnOrder(
        tenantId,
        order.lines.map((line) => ({
          materialId: line.materialId,
          qty: Math.max(0, line.qtyOrdered - line.qtyReceived),
        })),
        manager,
      );

      return saved;
    });
  }

  /**
   * Accepts that the rest of a delivery is not coming, and closes the order.
   *
   * Without this a partially-received order has no exit: it cannot be
   * cancelled (goods have already arrived and cancelling would strand them)
   * and it cannot complete (the balance will never turn up). It would sit at
   * `PARTIALLY_RECEIVED` forever with its outstanding quantity still counted
   * as on order — permanently inflating that figure and suppressing the very
   * reorder suggestions it exists to inform.
   *
   * Called "closing short" in purchasing, and it is a decision rather than a
   * state change, so it records who made it and why.
   */
  async closeShort(
    tenantId: string,
    orderId: string,
    actor: Actor,
    reason: string | null,
  ): Promise<PurchaseOrder> {
    return this.inTransaction(tenantId, orderId, async (order, manager) => {
      this.assertTransition(order.status, 'RECEIVED', order.poNumber);

      // From the locked lines: a receipt that committed while this waited has
      // already released its own quantity, and must not be released twice.
      const outstanding = order.lines.map((line) => ({
        materialId: line.materialId,
        qty: -Math.max(0, line.qtyOrdered - line.qtyReceived),
      }));

      order.status = 'RECEIVED';
      order.notes = [
        order.notes,
        reason ? `Closed short: ${reason}` : 'Closed short',
      ]
        .filter(Boolean)
        .join('\n');
      const saved = await manager.getRepository(PurchaseOrder).save(order);

      // The balance is never arriving, so it must stop counting as on order.
      await this.inventory.adjustOnOrder(tenantId, outstanding, manager);

      return saved;
    });
  }

  /**
   * Marks an approved order as sent. Emailing it is the caller's job.
   *
   * Under the lock this is also a claim: of two concurrent calls, exactly one
   * moves the order to SENT and the other fails `assertTransition`. That is
   * what `PurchasingService.sendToSupplier` relies on to email only once.
   */
  async markSent(tenantId: string, orderId: string): Promise<PurchaseOrder> {
    return this.inTransaction(tenantId, orderId, async (order, manager) => {
      this.assertTransition(order.status, 'SENT', order.poNumber);

      order.status = 'SENT';
      order.sentAt = new Date();
      return manager.getRepository(PurchaseOrder).save(order);
    });
  }

  /**
   * Undoes a `markSent` whose email then failed, so the order can be sent
   * again rather than claiming a delivery the supplier never received.
   *
   * Only while the claim still stands: the order is still SENT with the
   * `sentAt` this caller stamped. If anything has moved it on since - goods
   * booked in against it, a cancellation, another send - that later state is
   * the truth and is left alone.
   */
  async revertSent(
    tenantId: string,
    orderId: string,
    claimedSentAt: Date | null,
  ): Promise<void> {
    await this.inTransaction(tenantId, orderId, async (order, manager) => {
      const stillOurs =
        order.status === 'SENT' &&
        claimedSentAt !== null &&
        order.sentAt?.getTime() === claimedSentAt.getTime();
      if (!stillOurs) return;
      await manager
        .getRepository(PurchaseOrder)
        .update(
          { id: order.id, tenantId },
          { status: 'APPROVED', sentAt: null },
        );
      order.status = 'APPROVED';
      order.sentAt = null;
    });
  }

  async cancel(
    tenantId: string,
    orderId: string,
    actor: Actor,
    reason: string | null,
  ): Promise<PurchaseOrder> {
    return this.inTransaction(tenantId, orderId, async (order, manager) => {
      this.assertTransition(order.status, 'CANCELLED', order.poNumber);

      // Only release what was actually committed: a draft never counted as on
      // order, so subtracting here would push the figure negative.
      const wasCommitted = ['APPROVED', 'SENT', 'PARTIALLY_RECEIVED'].includes(
        order.status,
      );

      order.status = 'CANCELLED';
      order.cancelledAt = new Date();
      order.cancelledById = actor.userId;
      order.cancelReason = reason;
      const saved = await manager.getRepository(PurchaseOrder).save(order);

      if (wasCommitted) {
        await this.inventory.adjustOnOrder(
          tenantId,
          order.lines.map((line) => ({
            materialId: line.materialId,
            qty: -Math.max(0, line.qtyOrdered - line.qtyReceived),
          })),
          manager,
        );
      }

      return saved;
    });
  }

  /* ------------------------------------------------------------------ */

  /** Runs `work` in one transaction, against the order locked for update. */
  private inTransaction<T>(
    tenantId: string,
    orderId: string,
    work: (order: PurchaseOrder, manager: EntityManager) => Promise<T>,
  ): Promise<T> {
    return this.orders.manager.transaction(async (manager) => {
      const order = await lockPurchaseOrder(manager, tenantId, orderId);
      return work(order, manager);
    });
  }

  private async load(
    tenantId: string,
    orderId: string,
  ): Promise<PurchaseOrder> {
    const order = await this.orders.findOne({
      where: { id: orderId, tenantId, deletedAt: IsNull() },
    });
    if (!order)
      throw new NotFoundException(`Purchase order ${orderId} not found`);
    return order;
  }

  private assertTransition(
    from: PurchaseOrderStatus,
    to: PurchaseOrderStatus,
    poNumber: string,
  ): void {
    if (canTransition(from, to)) return;
    throw new BadRequestException(
      `${poNumber} is ${from.toLowerCase().replace(/_/g, ' ')} and cannot be ${to
        .toLowerCase()
        .replace(/_/g, ' ')}.`,
    );
  }
}
