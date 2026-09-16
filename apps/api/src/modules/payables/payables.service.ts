import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  DataSource,
  EntityManager,
  In,
  IsNull,
  Not,
  Repository,
} from 'typeorm';
import {
  AGING_BUCKETS,
  agingBucket,
  billPostingLines,
  billTotals,
  canTransitionBill,
  LEDGER_ROLES,
  PERMISSIONS,
  summariseMatch,
  type AgingBucket,
  type BillQueryPayload,
  type BillStatus,
  type CreateBillPayload,
  type LineVariance,
  type PaginatedResult,
  type Permission,
  type RecordBillPaymentPayload,
  toBase,
} from '@saas/shared';
import {
  allocateNextSequenceValue,
  formatSequenceNumber,
} from '@/database/tenant-sequence.util';
import { LedgerService } from '../finance/ledger.service';
import { FinanceAccount } from '../finance/entities/finance-account.entity';
import { JournalEntry } from '../finance/entities/journal-entry.entity';
import { TaxService } from '../tax/tax.service';
import { cashAccountAmount, fxRateFor } from '../finance/fx';
import { NotificationsService } from '../notifications/notifications.service';
import { PurchaseOrder } from '../purchasing/entities/purchase-order.entity';
import { PurchaseOrderLine } from '../purchasing/entities/purchase-order-line.entity';
import { PurchasePolicyEntity } from '../purchasing/entities/purchase-policy.entity';
import { Supplier } from '../purchasing/entities/supplier.entity';
import {
  BillPayment,
  SupplierBill,
  SupplierBillLine,
} from './entities/supplier-bill.entity';

export interface Actor {
  userId: string;
  /** The actor's own resolved effective permissions — never a role. */
  permissions: Permission[];
}

export interface BillableOrderLine {
  purchaseOrderLineId: string;
  materialId: string | null;
  description: string;
  qtyOrdered: number;
  qtyReceived: number;
  qtyBilled: number;
  /** Received and not yet on any live bill. */
  qtyBillable: number;
  orderUnitCost: number;
}

export interface AgingReport {
  asOf: string;
  buckets: Record<AgingBucket, number>;
  total: number;
  /** The payables account balance, which the report must agree with. */
  ledgerBalance: number;
  /** `total - ledgerBalance`. Anything but zero means a bill posted without a matching record, or the reverse. */
  difference: number;
  bills: {
    id: string;
    billNumber: string;
    supplierName: string;
    dueDate: string | null;
    outstanding: number;
    currency: string;
    outstandingBase: number;
    bucket: AgingBucket;
  }[];
}

const money = (n: number): number =>
  Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * Bills that count against an order line's billable quantity.
 *
 * Two sets, deliberately. When a bill is being entered, every live bill counts
 * — a second draft for the same goods is worth warning about early. When one
 * is being *approved*, only bills that have already posted count: otherwise a
 * forgotten draft sitting in someone's queue would block a legitimate bill for
 * goods that nobody has actually been charged for.
 */
const LIVE_BILL_STATUSES: BillStatus[] = [
  'DRAFT',
  'DISPUTED',
  'APPROVED',
  'PARTIALLY_PAID',
  'PAID',
];
const POSTED_BILL_STATUSES: BillStatus[] = [
  'APPROVED',
  'PARTIALLY_PAID',
  'PAID',
];

@Injectable()
export class PayablesService {
  constructor(
    @InjectRepository(SupplierBill)
    private readonly bills: Repository<SupplierBill>,
    @InjectRepository(BillPayment)
    private readonly payments: Repository<BillPayment>,
    private readonly ledger: LedgerService,
    private readonly dataSource: DataSource,
    private readonly tax: TaxService,
    private readonly notifications: NotificationsService,
  ) {}

  /* ------------------------------------------------------------------ *
   * Reading
   * ------------------------------------------------------------------ */

  async list(
    tenantId: string,
    query: BillQueryPayload,
  ): Promise<PaginatedResult<SupplierBill>> {
    const where = {
      tenantId,
      deletedAt: IsNull(),
      ...(query.status ? { status: query.status } : {}),
      ...(query.supplierId ? { supplierId: query.supplierId } : {}),
      ...(query.purchaseOrderId
        ? { purchaseOrderId: query.purchaseOrderId }
        : {}),
    };
    const [items, total] = await this.bills.findAndCount({
      where,
      order: { billDate: 'DESC' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    });
    const totalPages = Math.ceil(total / query.limit) || 1;
    return {
      items,
      meta: {
        total,
        page: query.page,
        limit: query.limit,
        totalPages,
        hasNextPage: query.page < totalPages,
        hasPreviousPage: query.page > 1,
      },
    };
  }

  async findById(
    tenantId: string,
    id: string,
    manager?: EntityManager,
  ): Promise<SupplierBill> {
    const repo = manager ? manager.getRepository(SupplierBill) : this.bills;
    const bill = await repo.findOne({
      where: { id, tenantId, deletedAt: IsNull() },
    });
    if (!bill) throw new NotFoundException(`Bill ${id} not found`);
    return bill;
  }

  async listPayments(tenantId: string, billId: string): Promise<BillPayment[]> {
    await this.findById(tenantId, billId);
    return this.payments.find({
      where: { tenantId, billId },
      order: { paidAt: 'ASC' },
    });
  }

  /**
   * What is left to bill on each line of an order.
   *
   * Drives the "enter bill" screen, so it opens on the quantities that
   * actually arrived rather than the quantities ordered — the difference is the
   * whole point of a three-way match.
   */
  async billableLines(
    tenantId: string,
    purchaseOrderId: string,
    manager: EntityManager = this.dataSource.manager,
    excludeBillId?: string,
  ): Promise<BillableOrderLine[]> {
    const order = await manager.getRepository(PurchaseOrder).findOne({
      where: { id: purchaseOrderId, tenantId, deletedAt: IsNull() },
    });
    if (!order)
      throw new NotFoundException(
        `Purchase order ${purchaseOrderId} not found`,
      );

    const lines = await manager
      .getRepository(PurchaseOrderLine)
      .find({ where: { tenantId, purchaseOrderId } });

    const billed = await this.billedQuantities(
      manager,
      tenantId,
      lines.map((l) => l.id),
      excludeBillId,
    );

    return lines.map((line) => {
      const qtyBilled = billed.get(line.id) ?? 0;
      return {
        purchaseOrderLineId: line.id,
        materialId: line.materialId,
        description: line.description,
        qtyOrdered: line.qtyOrdered,
        qtyReceived: line.qtyReceived,
        qtyBilled,
        qtyBillable: Math.max(
          0,
          Math.round((line.qtyReceived - qtyBilled) * 10000) / 10000,
        ),
        orderUnitCost: line.unitCost,
      };
    });
  }

  /** Quantity per order line already on a live bill, optionally ignoring one bill. */
  private async billedQuantities(
    manager: EntityManager,
    tenantId: string,
    orderLineIds: string[],
    excludeBillId?: string,
    statuses: BillStatus[] = LIVE_BILL_STATUSES,
  ): Promise<Map<string, number>> {
    if (orderLineIds.length === 0) return new Map();

    const qb = manager
      .getRepository(SupplierBillLine)
      .createQueryBuilder('line')
      .innerJoin(SupplierBill, 'bill', 'bill.id = line.bill_id')
      .select('line.purchase_order_line_id', 'orderLineId')
      .addSelect('COALESCE(SUM(line.qty), 0)', 'qty')
      .where('line.tenant_id = :tenantId', { tenantId })
      .andWhere('line.purchase_order_line_id IN (:...ids)', {
        ids: orderLineIds,
      })
      .andWhere('bill.deletedAt IS NULL')
      .andWhere('bill.status IN (:...statuses)', { statuses })
      .groupBy('line.purchase_order_line_id');

    if (excludeBillId)
      qb.andWhere('bill.id <> :excludeBillId', { excludeBillId });

    const rows: { orderLineId: string; qty: string }[] = await qb.getRawMany();
    return new Map(rows.map((r) => [r.orderLineId, Number(r.qty)]));
  }

  private async tolerance(
    manager: EntityManager,
    tenantId: string,
  ): Promise<number> {
    const policy = await manager
      .getRepository(PurchasePolicyEntity)
      .findOne({ where: { tenantId } });
    return policy?.varianceTolerancePct ?? 0;
  }

  /** Re-runs the three-way match against current receipts and other bills. */
  private async match(
    manager: EntityManager,
    tenantId: string,
    bill: Pick<SupplierBill, 'id' | 'purchaseOrderId'>,
    lines: {
      purchaseOrderLineId: string | null;
      description: string;
      qty: number;
      unitCost: number;
    }[],
    statuses: BillStatus[] = LIVE_BILL_STATUSES,
  ) {
    const linkedIds = lines
      .map((l) => l.purchaseOrderLineId)
      .filter((id): id is string => Boolean(id));

    const orderLines = linkedIds.length
      ? await manager
          .getRepository(PurchaseOrderLine)
          .find({ where: { id: In(linkedIds) } })
      : [];
    const byId = new Map(
      orderLines.filter((l) => l.tenantId === tenantId).map((l) => [l.id, l]),
    );
    const billed = await this.billedQuantities(
      manager,
      tenantId,
      linkedIds,
      bill.id || undefined,
      statuses,
    );

    for (const id of linkedIds) {
      const orderLine = byId.get(id);
      if (!orderLine)
        throw new BadRequestException(`Order line ${id} not found`);
      if (
        bill.purchaseOrderId &&
        orderLine.purchaseOrderId !== bill.purchaseOrderId
      ) {
        throw new BadRequestException(
          `"${orderLine.description}" belongs to a different purchase order`,
        );
      }
    }

    const tolerance = await this.tolerance(manager, tenantId);
    return summariseMatch(
      lines.map((l) => {
        const orderLine = l.purchaseOrderLineId
          ? byId.get(l.purchaseOrderLineId)
          : undefined;
        return {
          description: l.description,
          qty: l.qty,
          unitCost: l.unitCost,
          orderLine: orderLine
            ? {
                unitCost: orderLine.unitCost,
                qtyReceived: orderLine.qtyReceived,
                qtyBilledElsewhere: billed.get(orderLine.id) ?? 0,
              }
            : null,
        };
      }),
      tolerance,
    );
  }

  /* ------------------------------------------------------------------ *
   * Entry
   * ------------------------------------------------------------------ */

  /**
   * Records a supplier bill as a draft.
   *
   * A variance does not block entry — the bill still says what the supplier
   * asked for, and refusing to record it would just move the disagreement
   * into someone's inbox. It blocks *approval*.
   */
  async create(
    tenantId: string,
    actorId: string,
    input: CreateBillPayload,
  ): Promise<SupplierBill> {
    return this.dataSource.transaction(async (manager) => {
      const supplier = await manager.getRepository(Supplier).findOne({
        where: { id: input.supplierId, tenantId, deletedAt: IsNull() },
      });
      if (!supplier) throw new NotFoundException('Supplier not found');

      if (input.purchaseOrderId) {
        const order = await manager.getRepository(PurchaseOrder).findOne({
          where: { id: input.purchaseOrderId, tenantId, deletedAt: IsNull() },
        });
        if (!order) throw new NotFoundException('Purchase order not found');
        if (order.supplierId !== supplier.id) {
          throw new BadRequestException(
            `${order.poNumber} was placed with ${order.supplierName}, not ${supplier.companyName}`,
          );
        }
      }

      const duplicate = await manager.getRepository(SupplierBill).findOne({
        where: {
          tenantId,
          supplierId: supplier.id,
          supplierInvoiceNumber: input.supplierInvoiceNumber,
          deletedAt: IsNull(),
          status: Not('CANCELLED'),
        },
      });
      if (duplicate) {
        throw new ConflictException(
          `${supplier.companyName} invoice ${input.supplierInvoiceNumber} is already entered as ${duplicate.billNumber}`,
        );
      }

      const matched = await this.match(
        manager,
        tenantId,
        { id: '', purchaseOrderId: input.purchaseOrderId },
        input.lines,
      );

      const linkedIds = input.lines
        .map((l) => l.purchaseOrderLineId)
        .filter((v): v is string => Boolean(v));
      const orderLines = linkedIds.length
        ? await manager
            .getRepository(PurchaseOrderLine)
            .find({ where: { id: In(linkedIds), tenantId } })
        : [];
      const orderCost = new Map(orderLines.map((l) => [l.id, l.unitCost]));

      const totals = billTotals(input.lines, input.taxAmount);
      // Reported as whatever the purchase rules say for this supplier's
      // country, unless the person entering the bill chose a code.
      const taxCodeId = input.taxCodeId
        ? (await this.tax.findCode(tenantId, input.taxCodeId, 'PURCHASE')).id
        : ((await this.tax.purchaseCodeForSupplier(tenantId, supplier.id))
            ?.id ?? null);
      const dueDate =
        input.dueDate ??
        (supplier.paymentTermsDays != null
          ? new Date(
              input.billDate.getTime() + supplier.paymentTermsDays * 86_400_000,
            )
          : null);

      const sequence = await allocateNextSequenceValue(
        manager,
        tenantId,
        'bill_number',
      );

      const created = await manager.getRepository(SupplierBill).save(
        manager.getRepository(SupplierBill).create({
          tenantId,
          billNumber: formatSequenceNumber('BILL', sequence),
          supplierInvoiceNumber: input.supplierInvoiceNumber,
          supplierId: supplier.id,
          supplierName: supplier.companyName,
          purchaseOrderId: input.purchaseOrderId,
          status: 'DRAFT',
          matchStatus: matched.status,
          currency: supplier.currency ?? 'USD',
          billDate: input.billDate,
          dueDate,
          subtotalAmount: totals.subtotal,
          taxAmount: totals.tax,
          taxCodeId,
          totalAmount: totals.total,
          paidAmount: 0,
          notes: input.notes,
          createdById: actorId,
          lines: input.lines.map((line) =>
            manager.getRepository(SupplierBillLine).create({
              tenantId,
              purchaseOrderLineId: line.purchaseOrderLineId,
              description: line.description,
              qty: line.qty,
              unitCost: line.unitCost,
              orderUnitCost: line.purchaseOrderLineId
                ? (orderCost.get(line.purchaseOrderLineId) ?? null)
                : null,
              lineTotal: money(line.qty * line.unitCost),
            }),
          ),
        }),
      );
      if (matched.status === 'VARIANCE') {
        await this.notifications.notifyHolders(
          tenantId,
          PERMISSIONS.BILL_APPROVE_VARIANCE,
          {
            type: 'BILL_VARIANCE',
            title: `${created.billNumber} from ${created.supplierName} does not match its order`,
            body: matched.variances
              .map((v) => v.message)
              .join('; ')
              .slice(0, 1000),
            link: `/purchasing/bills/${created.id}`,
            entityType: 'BILL',
            entityId: created.id,
          },
          { manager, excludeUserId: actorId },
        );
      }
      return created;
    });
  }

  /** The current three-way match, for the approval screen to show before anyone clicks. */
  async check(
    tenantId: string,
    id: string,
  ): Promise<{
    status: string;
    variances: (LineVariance & { lineIndex: number })[];
  }> {
    const bill = await this.findById(tenantId, id);
    return this.match(
      this.dataSource.manager,
      tenantId,
      bill,
      bill.lines ?? [],
    );
  }

  /* ------------------------------------------------------------------ *
   * Approval
   * ------------------------------------------------------------------ */

  /**
   * Turns a claim into a liability, and posts it.
   *
   * The match is re-run here rather than trusted from entry: another bill for
   * the same goods may have been approved in between, and the quantity that
   * was billable an hour ago may not be now.
   */
  async approve(
    tenantId: string,
    id: string,
    actor: Actor,
  ): Promise<SupplierBill> {
    if (!actor.permissions.includes(PERMISSIONS.BILL_APPROVE)) {
      throw new ForbiddenException(
        'You do not have permission to approve bills.',
      );
    }

    return this.dataSource.transaction(async (manager) => {
      const bill = await this.lockBill(manager, tenantId, id);
      this.assertTransition(bill, 'APPROVED');

      // Lock the order lines this bill claims. Two bills for the same goods
      // approved at the same moment would otherwise each read the other as not
      // yet posted, both pass the match, and the supplier would be owed twice.
      const linkedIds = (bill.lines ?? [])
        .map((l) => l.purchaseOrderLineId)
        .filter((v): v is string => Boolean(v));
      if (linkedIds.length) {
        await manager
          .getRepository(PurchaseOrderLine)
          .createQueryBuilder('pol')
          .setLock('pessimistic_write')
          .where('pol.id IN (:...ids)', { ids: linkedIds })
          .andWhere('pol.tenant_id = :tenantId', { tenantId })
          .getMany();
      }

      const matched = await this.match(
        manager,
        tenantId,
        bill,
        bill.lines ?? [],
        POSTED_BILL_STATUSES,
      );
      const variance = matched.status === 'VARIANCE';

      // Quantity beyond what arrived and is unbilled is refused outright, for
      // everyone. Letting the variance permission override it is how the same
      // goods get billed — and paid — twice.
      const hard = matched.variances.filter((v) => !v.overridable);
      if (hard.length > 0) {
        throw new BadRequestException(
          `${bill.billNumber} cannot be approved: ${hard.map((v) => v.message).join('; ')}. Book in the delivery, or ask the supplier for a corrected bill.`,
        );
      }

      // Price is a judgement someone senior can make. Compared against what
      // this actor holds, not a role — the rule the order threshold follows.
      if (
        variance &&
        !actor.permissions.includes(PERMISSIONS.BILL_APPROVE_VARIANCE)
      ) {
        throw new ForbiddenException(
          `${bill.billNumber} does not match its order: ${matched.variances.map((v) => v.message).join('; ')}.`,
        );
      }

      const billRate = await fxRateFor(
        manager,
        tenantId,
        bill.currency,
        bill.billDate,
      );
      const postingLines = billPostingLines(
        (bill.lines ?? []).map((l) => ({
          description: l.description,
          qty: l.qty,
          unitCost: l.unitCost,
          orderUnitCost: l.purchaseOrderLineId ? l.orderUnitCost : null,
        })),
        bill.taxAmount,
        { billNumber: bill.billNumber, supplierName: bill.supplierName },
      );

      // GRNI was credited in base currency at the rate each delivery arrived
      // at. Clearing it at the bill's rate instead would leave the difference
      // stranded in GRNI for ever; clearing it at the receipt rates lets it
      // reach zero, and the gap between the two rates lands in exchange
      // gains and losses where it belongs.
      const grniLine = postingLines.find(
        (l) => l.role === LEDGER_ROLES.GRNI && l.debit > 0,
      );
      if (grniLine && linkedIds.length) {
        const orderLines = await manager
          .getRepository(PurchaseOrderLine)
          .find({ where: { id: In(linkedIds), tenantId } });
        const byId = new Map(orderLines.map((l) => [l.id, l]));
        let grniBase = 0;
        for (const line of bill.lines ?? []) {
          const orderLine = line.purchaseOrderLineId
            ? byId.get(line.purchaseOrderLineId)
            : undefined;
          if (!orderLine || line.orderUnitCost == null) continue;
          const doc = money(line.qty * line.orderUnitCost);
          grniBase = money(
            grniBase +
              (orderLine.qtyReceived > 0
                ? money(
                    (line.qty * Number(orderLine.receivedValueBase)) /
                      orderLine.qtyReceived,
                  )
                : toBase(doc, billRate)),
          );
        }
        grniLine.fxRate = grniLine.debit > 0 ? grniBase / grniLine.debit : null;
      }

      const lines = await this.ledger.resolveLines(
        tenantId,
        postingLines,
        manager,
        billRate,
      );

      const entry = await manager.getRepository(JournalEntry).save(
        manager.getRepository(JournalEntry).create({
          tenantId,
          entryNumber: `JE-${bill.billNumber}`,
          referenceType: 'BILL',
          referenceId: bill.id,
          entryDate: bill.billDate,
          totalAmount: bill.totalAmount,
          currency: bill.currency,
          fxRate: billRate,
          lines,
        }),
      );

      await this.notifications.resolve(tenantId, bill.id, manager);
      bill.status = 'APPROVED';
      bill.fxRate = billRate;
      bill.matchStatus = matched.status;
      bill.varianceApproved = variance;
      bill.approvedAt = new Date();
      bill.approvedById = actor.userId;
      bill.journalEntryId = entry.id;
      return manager.getRepository(SupplierBill).save(bill);
    });
  }

  async dispute(
    tenantId: string,
    id: string,
    reason: string | null,
  ): Promise<SupplierBill> {
    const bill = await this.findById(tenantId, id);
    this.assertTransition(bill, 'DISPUTED');
    bill.status = 'DISPUTED';
    bill.disputeReason = reason;
    return this.bills.save(bill);
  }

  async reopen(tenantId: string, id: string): Promise<SupplierBill> {
    const bill = await this.findById(tenantId, id);
    this.assertTransition(bill, 'DRAFT');
    bill.status = 'DRAFT';
    return this.bills.save(bill);
  }

  /** Only before approval: an approved bill has posted, and is corrected by a credit note. */
  async cancel(tenantId: string, id: string): Promise<SupplierBill> {
    const bill = await this.findById(tenantId, id);
    this.assertTransition(bill, 'CANCELLED');
    bill.status = 'CANCELLED';
    await this.notifications.resolve(tenantId, bill.id);
    return this.bills.save(bill);
  }

  /* ------------------------------------------------------------------ *
   * Payment
   * ------------------------------------------------------------------ */

  /**
   * Pays some or all of an approved bill.
   *
   * The bill row is locked and the cash balance is moved with a single
   * relative UPDATE rather than read, adjusted and written back. Two payments
   * recorded at once would otherwise each read the same balance and the second
   * would overwrite the first — money leaving the account with no trace in the
   * figure that is supposed to show it.
   */
  async recordPayment(
    tenantId: string,
    id: string,
    actorId: string,
    input: RecordBillPaymentPayload,
  ): Promise<SupplierBill> {
    return this.dataSource.transaction(async (manager) => {
      const bill = await this.lockBill(manager, tenantId, id);
      if (bill.status !== 'APPROVED' && bill.status !== 'PARTIALLY_PAID') {
        throw new BadRequestException(
          `${bill.billNumber} is ${bill.status.toLowerCase().replace(/_/g, ' ')} and cannot be paid.`,
        );
      }

      const remaining = money(bill.totalAmount - bill.paidAmount);
      const amount = money(input.amount ?? remaining);
      if (!(amount > 0))
        throw new BadRequestException('Payment must be above zero');
      if (amount > remaining) {
        throw new BadRequestException(
          `Paying ${amount.toFixed(2)} would overpay ${bill.billNumber}, which has ${remaining.toFixed(2)} outstanding.`,
        );
      }

      const account = await manager
        .getRepository(FinanceAccount)
        .findOne({ where: { id: input.financeAccountId, tenantId } });
      if (!account) throw new NotFoundException('Account not found');

      const paidAt = input.paidAt ?? new Date();
      const paymentRate = await fxRateFor(
        manager,
        tenantId,
        bill.currency,
        paidAt,
      );
      const leaving = await cashAccountAmount(manager, tenantId, account, {
        amount,
        currency: bill.currency,
        rate: paymentRate,
      });

      await manager.query(
        `UPDATE "finance_accounts" SET "balance" = "balance" - $1, "updatedAt" = now()
         WHERE "id" = $2 AND "tenantId" = $3`,
        [leaving, account.id, tenantId],
      );

      // The payable clears at the rate the bill was booked at; the cash
      // leaves at today's. The difference is an exchange gain or loss.
      const lines = await this.ledger.resolveLines(
        tenantId,
        [
          {
            role: LEDGER_ROLES.ACCOUNTS_PAYABLE,
            accountName: 'Accounts payable',
            debit: amount,
            credit: 0,
            fxRate: bill.fxRate,
            description: `Payment of ${bill.billNumber} to ${bill.supplierName}`,
          },
          {
            financeAccountId: account.id,
            accountName: account.name,
            debit: 0,
            credit: amount,
            fxRate: paymentRate,
            description: `Payment of ${bill.billNumber} to ${bill.supplierName}`,
          },
        ],
        manager,
        paymentRate,
      );

      const payment = manager.getRepository(BillPayment).create({
        tenantId,
        billId: bill.id,
        financeAccountId: account.id,
        amount,
        paidAt,
        reference: input.reference,
        recordedById: actorId,
        fxRate: paymentRate,
      });
      await manager.getRepository(BillPayment).save(payment);

      const entry = await manager.getRepository(JournalEntry).save(
        manager.getRepository(JournalEntry).create({
          tenantId,
          entryNumber: `JE-${bill.billNumber}-PAY-${payment.id.slice(0, 8)}`,
          referenceType: 'BILL',
          referenceId: bill.id,
          entryDate: payment.paidAt,
          totalAmount: amount,
          currency: bill.currency,
          fxRate: paymentRate,
          lines,
        }),
      );
      payment.journalEntryId = entry.id;
      await manager.getRepository(BillPayment).save(payment);

      bill.paidAmount = money(bill.paidAmount + amount);
      bill.status =
        bill.paidAmount >= bill.totalAmount ? 'PAID' : 'PARTIALLY_PAID';
      return manager.getRepository(SupplierBill).save(bill);
    });
  }

  /** Undoes a payment line for line, and puts the money back. */
  async reversePayment(
    tenantId: string,
    billId: string,
    paymentId: string,
    actorId: string,
  ): Promise<SupplierBill> {
    return this.dataSource.transaction(async (manager) => {
      const bill = await this.lockBill(manager, tenantId, billId);
      const payment = await manager
        .getRepository(BillPayment)
        .findOne({ where: { id: paymentId, billId: bill.id, tenantId } });
      if (!payment) throw new NotFoundException('Payment not found');
      if (payment.reversedAt)
        throw new BadRequestException('That payment has already been reversed');

      const account = await manager
        .getRepository(FinanceAccount)
        .findOne({ where: { id: payment.financeAccountId, tenantId } });
      if (!account) throw new NotFoundException('Account not found');
      const returning = await cashAccountAmount(manager, tenantId, account, {
        amount: payment.amount,
        currency: bill.currency,
        rate: payment.fxRate,
      });

      await manager.query(
        `UPDATE "finance_accounts" SET "balance" = "balance" + $1, "updatedAt" = now()
         WHERE "id" = $2 AND "tenantId" = $3`,
        [returning, payment.financeAccountId, tenantId],
      );

      const lines = await this.ledger.resolveLines(
        tenantId,
        [
          {
            financeAccountId: payment.financeAccountId,
            accountName: account.name,
            debit: payment.amount,
            credit: 0,
            fxRate: payment.fxRate,
            description: `Reversal of payment on ${bill.billNumber}`,
          },
          {
            role: LEDGER_ROLES.ACCOUNTS_PAYABLE,
            accountName: 'Accounts payable',
            debit: 0,
            credit: payment.amount,
            fxRate: bill.fxRate,
            description: `Reversal of payment on ${bill.billNumber}`,
          },
        ],
        manager,
        payment.fxRate,
      );

      await manager.getRepository(JournalEntry).save(
        manager.getRepository(JournalEntry).create({
          tenantId,
          entryNumber: `JE-${bill.billNumber}-REV-${payment.id.slice(0, 8)}`,
          referenceType: 'BILL',
          referenceId: bill.id,
          entryDate: new Date(),
          totalAmount: payment.amount,
          lines,
        }),
      );

      payment.reversedAt = new Date();
      payment.reversedById = actorId;
      await manager.getRepository(BillPayment).save(payment);

      bill.paidAmount = money(bill.paidAmount - payment.amount);
      bill.status = bill.paidAmount <= 0 ? 'APPROVED' : 'PARTIALLY_PAID';
      return manager.getRepository(SupplierBill).save(bill);
    });
  }

  /* ------------------------------------------------------------------ *
   * Aging
   * ------------------------------------------------------------------ */

  /**
   * What is owed, by how late it is — and whether that agrees with the ledger.
   *
   * The reconciliation is the useful half. A report that merely lists bills
   * cannot tell you when the payables account has drifted from them.
   */
  async aging(tenantId: string, asOf: Date = new Date()): Promise<AgingReport> {
    const open = await this.bills.find({
      where: [
        { tenantId, status: 'APPROVED', deletedAt: IsNull() },
        { tenantId, status: 'PARTIALLY_PAID', deletedAt: IsNull() },
      ],
      order: { dueDate: 'ASC' },
    });

    const buckets = Object.fromEntries(
      AGING_BUCKETS.map((b) => [b, 0]),
    ) as Record<AgingBucket, number>;
    // Totals are in base currency at each bill's booked rate, which is what
    // the payables account holds, so the reconciliation below compares like
    // with like across currencies.
    const rows = open.map((bill) => {
      const outstanding = money(bill.totalAmount - bill.paidAmount);
      const outstandingBase = toBase(outstanding, bill.fxRate ?? 1);
      const bucket = agingBucket(bill.dueDate, asOf);
      buckets[bucket] = money(buckets[bucket] + outstandingBase);
      return {
        id: bill.id,
        billNumber: bill.billNumber,
        supplierName: bill.supplierName,
        dueDate: bill.dueDate ? bill.dueDate.toISOString() : null,
        outstanding,
        currency: bill.currency,
        outstandingBase,
        bucket,
      };
    });
    const total = money(rows.reduce((s, r) => s + r.outstandingBase, 0));

    const payablesAccount = await this.ledger.byRole(
      tenantId,
      LEDGER_ROLES.ACCOUNTS_PAYABLE,
    );
    const trial = await this.ledger.trialBalance(tenantId, asOf);
    const ledgerBalance =
      trial.rows.find((r) => r.ledgerAccountId === payablesAccount.id)
        ?.balance ?? 0;

    return {
      asOf: asOf.toISOString(),
      buckets,
      total,
      ledgerBalance,
      difference: money(total - ledgerBalance),
      bills: rows,
    };
  }

  /* ------------------------------------------------------------------ */

  private async lockBill(
    manager: EntityManager,
    tenantId: string,
    id: string,
  ): Promise<SupplierBill> {
    const locked = await manager
      .getRepository(SupplierBill)
      .createQueryBuilder('bill')
      .setLock('pessimistic_write')
      .where('bill.id = :id', { id })
      .andWhere('bill.tenant_id = :tenantId', { tenantId })
      .andWhere('bill.deletedAt IS NULL')
      .getOne();
    if (!locked) throw new NotFoundException(`Bill ${id} not found`);
    // The lock query does not load relations; fetch the lines separately.
    locked.lines = await manager
      .getRepository(SupplierBillLine)
      .find({ where: { billId: locked.id, tenantId } });
    return locked;
  }

  private assertTransition(bill: SupplierBill, to: BillStatus): void {
    if (canTransitionBill(bill.status, to)) return;
    const human = (s: string) => s.toLowerCase().replace(/_/g, ' ');
    throw new BadRequestException(
      `${bill.billNumber} is ${human(bill.status)} and cannot be ${human(to)}.`,
    );
  }
}
