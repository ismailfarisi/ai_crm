import {
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DataSource, In, IsNull, Not, type EntityManager } from 'typeorm';
import {
  calculateQuoteTotals,
  DEFAULT_COSTING_POLICY,
  PERMISSIONS,
  summariseJobCost,
  type JobCostSourceDto,
  type OrderJobCostDto,
} from '@saas/shared';
import { TenantContextService } from '@/common/context/tenant-context.service';
import { ShopEventsService } from '@/common/events/shop-events.service';
import { CostingPolicy } from '../catalog/entities/costing-policy.entity';
import { DeliveryNote } from '../credits/entities/credit-note.entity';
import { ExpenseClaim } from '../finance/entities/expense-claim.entity';
import { baseCurrencyFor, fxRateFor } from '../finance/fx';
import { StockMovement } from '../inventory/entities/stock-movement.entity';
import { JobCostService } from '../job-costing/job-cost.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  SupplierBill,
  SupplierBillLine,
} from '../payables/entities/supplier-bill.entity';
import {
  WorkOrder,
  WorkOrderMaterial,
  WorkOrderOperation,
} from '../production/entities/work-order.entity';
import { PurchaseOrderLine } from '../purchasing/entities/purchase-order-line.entity';
import { PurchaseOrder } from '../purchasing/entities/purchase-order.entity';
import { Quote } from '../quotes/entities/quote.entity';
import { TaxCode } from '../tax/entities/tax.entity';
import { SalesOrder } from './entities/sales-order.entity';

/** A bill is a cost once it is approved; a draft or a cancelled one is not. */
const POSTED_BILLS = ['APPROVED', 'PARTIALLY_PAID', 'PAID'] as const;
const POSTED_CLAIMS = ['APPROVED', 'PAID'] as const;
/** A purchase order counts as committed once someone approved it. */
const COMMITTED_POS = [
  'APPROVED',
  'SENT',
  'PARTIALLY_RECEIVED',
  'RECEIVED',
] as const;
/** Orders still worth watching; a closed or cancelled one has stopped spending. */
const WATCHED_ORDERS = ['OPEN', 'IN_PRODUCTION', 'FULFILLED'] as const;

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * Quoted against actual cost for a customer order, and the over-budget alert.
 *
 * Read-only over the books: linking a bill or a claim to a job is management
 * costing, so nothing here posts. Each cost is counted from one place only:
 *
 * - Stock (a PO line for a stock material) counts when it is issued to one of
 *   the order's work orders or dispatched on its delivery, at moving average.
 *   Its purchase order and bill are never counted again.
 * - A free-text PO line (outsourced print, an installer) counts once: the
 *   billed quantity at the bill's price, and anything received but not yet
 *   billed at the received value. Ordered and not yet received is shown as
 *   "on order", not as cost.
 * - A bill with no purchase order, or a bill's extra lines that match no order
 *   line, count at their net amount, plus VAT only when it is blocked.
 * - An expense claim counts at its amount less the VAT claimed back.
 */
@Injectable()
export class OrderCostService {
  private readonly logger = new Logger(OrderCostService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly jobCost: JobCostService,
    private readonly notifications: NotificationsService,
    private readonly tenantContext: TenantContextService,
    @Optional()
    private readonly shopEvents?: ShopEventsService,
  ) {}

  async forOrder(tenantId: string, orderId: string): Promise<OrderJobCostDto> {
    const dto = await this.compute(this.dataSource.manager, tenantId, orderId);
    await this.alertIfOverBudget(tenantId, orderId, dto);
    return dto;
  }

  async compute(
    manager: EntityManager,
    tenantId: string,
    orderId: string,
  ): Promise<OrderJobCostDto> {
    const order = await manager
      .getRepository(SalesOrder)
      .findOne({ where: { id: orderId, tenantId } });
    if (!order) throw new NotFoundException('Sales order not found');

    const [currency, policy, quote] = await Promise.all([
      baseCurrencyFor(manager, tenantId),
      manager.getRepository(CostingPolicy).findOne({ where: { tenantId } }),
      manager
        .getRepository(Quote)
        .findOne({ where: { id: order.quoteId, tenantId } }),
    ]);

    let priceRate = 1;
    let priceRateMissing = false;
    try {
      priceRate = await fxRateFor(
        manager,
        tenantId,
        order.currency,
        order.createdAt,
      );
    } catch {
      priceRateMissing = true;
    }
    const price = r2(Number(order.subtotalAmount) * priceRate);

    const totals = quote ? calculateQuoteTotals(quote.items ?? []) : null;
    // Quote lines are costed in the quote's currency, like its prices.
    const quotedCost =
      totals && totals.costAmount > 0
        ? r2(totals.costAmount * priceRate)
        : null;

    const production = await this.productionCost(manager, tenantId, order.id);
    const delivered = await this.deliveredStock(manager, tenantId, order.id);
    const bought = await this.boughtIn(manager, tenantId, order.id);
    const alertPct =
      policy?.overBudgetAlertPct ??
      DEFAULT_COSTING_POLICY.overBudgetAlertPct ??
      0.1;

    const summary = summariseJobCost({
      price,
      quotedCost,
      material: production.material + delivered,
      labour: production.labour,
      machineAndOverhead: production.machineAndOverhead,
      boughtIn: bought.counted,
      alertPct,
    });
    return {
      orderId: order.id,
      currency,
      price,
      quotedCost,
      quotedCostComplete: totals?.hasCompleteCost ?? false,
      ...summary,
      onOrder: bought.onOrder,
      alertPct,
      workOrders: production.count,
      sources: bought.sources,
      ...(priceRateMissing ? { priceRateMissing } : {}),
    };
  }

  /**
   * Work orders: a finished one by the cost written at completion (kept up to
   * date when payroll lands), a live one by the same sum run on what it has
   * used so far.
   */
  private async productionCost(
    manager: EntityManager,
    tenantId: string,
    orderId: string,
  ): Promise<{
    material: number;
    labour: number;
    machineAndOverhead: number;
    count: number;
  }> {
    const wos = await manager.getRepository(WorkOrder).find({
      where: { tenantId, salesOrderId: orderId, status: Not('CANCELLED') },
    });
    let material = 0;
    let labour = 0;
    let other = 0;
    for (const wo of wos) {
      let cost = wo.status === 'COMPLETE' ? wo.actualCost : null;
      if (!cost) {
        const [ops, mats] = await Promise.all([
          manager
            .getRepository(WorkOrderOperation)
            .find({ where: { workOrderId: wo.id, tenantId } }),
          manager
            .getRepository(WorkOrderMaterial)
            .find({ where: { workOrderId: wo.id, tenantId } }),
        ]);
        const materialValue = r2(
          mats.reduce((s, m) => s + Number(m.valueIssued), 0),
        );
        ({ cost } = await this.jobCost.costFor(
          manager,
          tenantId,
          wo,
          ops,
          materialValue,
          wo.qtyCompleted || wo.qty,
        ));
      }
      material += cost.material;
      labour += cost.labor;
      other += cost.machine + cost.tooling + cost.overhead;
    }
    return {
      material: r2(material),
      labour: r2(labour),
      machineAndOverhead: r2(other),
      count: wos.length,
    };
  }

  /** Stock that left on the order's delivery notes, at the average it left at. */
  private async deliveredStock(
    manager: EntityManager,
    tenantId: string,
    orderId: string,
  ): Promise<number> {
    const notes = await manager.getRepository(DeliveryNote).find({
      where: { tenantId, salesOrderId: orderId },
      select: { id: true },
    });
    if (!notes.length) return 0;
    const moves = await manager.getRepository(StockMovement).find({
      where: {
        tenantId,
        referenceType: 'DELIVERY_NOTE',
        referenceId: In(notes.map((n) => n.id)),
      },
    });
    return r2(
      moves.reduce(
        (s, m) =>
          s +
          (m.qtyDelta < 0
            ? -m.qtyDelta * Number(m.avgUnitCostAfter)
            : -m.qtyDelta * Number(m.unitCost)),
        0,
      ),
    );
  }

  private async boughtIn(
    manager: EntityManager,
    tenantId: string,
    orderId: string,
  ): Promise<{
    counted: number;
    onOrder: number;
    sources: JobCostSourceDto[];
  }> {
    const sources: JobCostSourceDto[] = [];

    const pos = await manager.getRepository(PurchaseOrder).find({
      where: {
        tenantId,
        salesOrderId: orderId,
        status: In([...COMMITTED_POS]),
      },
    });
    const poIds = pos.map((p) => p.id);
    const bills = await manager.getRepository(SupplierBill).find({
      where: [
        ...(poIds.length
          ? [
              {
                tenantId,
                purchaseOrderId: In(poIds),
                status: In([...POSTED_BILLS]),
              },
            ]
          : []),
        {
          tenantId,
          purchaseOrderId: IsNull(),
          salesOrderId: orderId,
          status: In([...POSTED_BILLS]),
        },
      ],
    });
    const billLines = bills.length
      ? await manager
          .getRepository(SupplierBillLine)
          .find({ where: { tenantId, billId: In(bills.map((b) => b.id)) } })
      : [];
    const billById = new Map(bills.map((b) => [b.id, b]));

    // Billed quantity and value per order line, from posted bills only.
    const billed = new Map<string, { qty: number; value: number }>();
    for (const line of billLines) {
      if (!line.purchaseOrderLineId) continue;
      const bill = billById.get(line.billId)!;
      const prev = billed.get(line.purchaseOrderLineId) ?? { qty: 0, value: 0 };
      billed.set(line.purchaseOrderLineId, {
        qty: prev.qty + Number(line.qty),
        value: prev.value + Number(line.lineTotal) * Number(bill.fxRate || 1),
      });
    }

    if (pos.length) {
      const poLines = await manager
        .getRepository(PurchaseOrderLine)
        .find({ where: { tenantId, purchaseOrderId: In(poIds) } });
      for (const po of pos) {
        let rate = 1;
        try {
          rate = await fxRateFor(manager, tenantId, po.currency, po.orderDate);
        } catch {
          rate = 1;
        }
        let counted = 0;
        let onOrder = 0;
        const descriptions: string[] = [];
        for (const line of poLines.filter((l) => l.purchaseOrderId === po.id)) {
          // Stock goes on the shelf and counts when it is issued to the job.
          if (line.materialId) continue;
          descriptions.push(line.description);
          const b = billed.get(line.id) ?? { qty: 0, value: 0 };
          const received = Number(line.qtyReceived);
          const receivedUnit =
            received > 0 ? Number(line.receivedValueBase) / received : 0;
          const unbilledReceived = Math.max(0, received - b.qty);
          counted += b.value + unbilledReceived * receivedUnit;
          const done = Math.max(received, b.qty);
          onOrder +=
            Math.max(0, Number(line.qtyOrdered) - done) *
            Number(line.unitCost) *
            rate;
        }
        if (!descriptions.length) continue;
        sources.push({
          kind: 'PURCHASE_ORDER',
          id: po.id,
          number: po.poNumber,
          party: po.supplierName,
          description: descriptions.join(', '),
          counted: r2(counted),
          onOrder: r2(onOrder),
        });
      }
    }

    // Bill lines that match no order line: a bill with no PO, or freight added to one.
    const blocked = await this.blockedTaxCodes(manager, tenantId, bills);
    for (const bill of bills) {
      const extra = billLines.filter(
        (l) => l.billId === bill.id && !l.purchaseOrderLineId,
      );
      if (!extra.length) continue;
      const rate = Number(bill.fxRate || 1);
      const net = extra.reduce((s, l) => s + Number(l.lineTotal), 0);
      // Blocked VAT cannot be claimed back, so it is part of the cost. On a
      // PO bill only the extra lines' share of it belongs here.
      const subtotal = Number(bill.subtotalAmount) || net;
      const tax =
        bill.taxCodeId && blocked.has(bill.taxCodeId)
          ? Number(bill.taxAmount) * (subtotal > 0 ? net / subtotal : 0)
          : 0;
      sources.push({
        kind: 'SUPPLIER_BILL',
        id: bill.id,
        number: bill.billNumber,
        party: bill.supplierName,
        description: extra.map((l) => l.description).join(', '),
        counted: r2((net + tax) * rate),
        onOrder: 0,
      });
    }

    const claims = await manager.getRepository(ExpenseClaim).find({
      where: {
        tenantId,
        salesOrderId: orderId,
        status: In([...POSTED_CLAIMS]),
      },
    });
    for (const claim of claims) {
      const net = Number(claim.amount) - Number(claim.recoverableTax ?? 0);
      sources.push({
        kind: 'EXPENSE_CLAIM',
        id: claim.id,
        number: claim.claimNumber,
        party: claim.employeeName,
        description: claim.merchantName
          ? `${claim.category} · ${claim.merchantName}`
          : claim.category,
        counted: r2(net * Number(claim.fxRate || 1)),
        onOrder: 0,
      });
    }

    return {
      counted: r2(sources.reduce((s, x) => s + x.counted, 0)),
      onOrder: r2(sources.reduce((s, x) => s + x.onOrder, 0)),
      sources,
    };
  }

  private async blockedTaxCodes(
    manager: EntityManager,
    tenantId: string,
    bills: SupplierBill[],
  ): Promise<Set<string>> {
    const ids = [
      ...new Set(bills.map((b) => b.taxCodeId).filter((x): x is string => !!x)),
    ];
    if (!ids.length) return new Set();
    const codes = await manager
      .getRepository(TaxCode)
      .find({ where: { tenantId, id: In(ids) } });
    return new Set(
      codes.filter((c) => c.treatment === 'BLOCKED').map((c) => c.id),
    );
  }

  /**
   * Tells the people who see cost, once, when a job passes its threshold, and
   * re-arms when it drops back under, so a second overrun alerts again.
   */
  async alertIfOverBudget(
    tenantId: string,
    orderId: string,
    dto: OrderJobCostDto,
  ): Promise<boolean> {
    const repo = this.dataSource.manager.getRepository(SalesOrder);
    if (!dto.overBudget) {
      await repo.update(
        { id: orderId, tenantId, overBudgetAlertedAt: Not(IsNull()) },
        { overBudgetAlertedAt: null },
      );
      return false;
    }
    const claimed = await repo.update(
      { id: orderId, tenantId, overBudgetAlertedAt: IsNull() },
      { overBudgetAlertedAt: new Date() },
    );
    if (!claimed.affected) return false;
    const order = await repo.findOne({ where: { id: orderId, tenantId } });
    if (!order) return false;
    const overBy = Math.round((dto.overByPct ?? 0) * 100);
    const money = (n: number) =>
      `${dto.currency} ${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
    await this.notifications.notifyHolders(
      tenantId,
      PERMISSIONS.QUOTE_VIEW_COST,
      {
        type: 'JOB_OVER_BUDGET',
        title: `${order.orderNumber} is ${overBy}% over its quoted cost`,
        body: `${order.customerName}: spent ${money(dto.actual.total)} against ${money(dto.quotedCost ?? 0)} quoted. Margin left ${money(dto.marginLeft)}.`,
        link: `/orders/${order.id}`,
        entityType: 'sales_order',
        entityId: order.id,
      },
      { refresh: true },
    );
    await this.shopEvents?.emit('sales_order.over_budget', tenantId, order.id, {
      extra: {
        quotedCost: dto.quotedCost,
        actualCost: dto.actual.total,
        overByPct: overBy,
        alertPct: Math.round(dto.alertPct * 100),
      },
    });
    return true;
  }

  /**
   * Costs land from many places (bills, claims, timesheets, stock issues), so
   * rather than hook each one this re-checks the watched orders every half
   * hour. Opening an order's cost card checks it straight away as well.
   */
  @Cron(CronExpression.EVERY_30_MINUTES)
  async sweep(): Promise<void> {
    const orders = await this.tenantContext.runAsSystem(() =>
      this.dataSource.manager.getRepository(SalesOrder).find({
        where: { status: In([...WATCHED_ORDERS]) },
        select: { id: true, tenantId: true },
        order: { createdAt: 'DESC' },
        take: 2000,
      }),
    );
    for (const o of orders) {
      try {
        await this.tenantContext.runWithTenant(o.tenantId, async () => {
          const dto = await this.compute(
            this.dataSource.manager,
            o.tenantId,
            o.id,
          );
          await this.alertIfOverBudget(o.tenantId, o.id, dto);
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(`Job budget check failed for ${o.id}: ${msg}`);
      }
    }
  }
}
