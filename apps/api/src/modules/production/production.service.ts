import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  DataSource,
  EntityManager,
  In,
  QueryFailedError,
  Repository,
} from 'typeorm';
import {
  actualCost,
  canTransitionWorkOrder,
  elapsedMinutes,
  isOnTheFloor,
  LEDGER_ROLES,
  MAX_SESSION_MINUTES,
  rankVariance,
  type CostSplit,
  type JournalLineInput,
  type QuoteLineItem,
  type VarianceRow,
  type WorkOrderDto,
  type WorkOrderQueryPayload,
} from '@saas/shared';
import {
  allocateNextSequenceValue,
  formatSequenceNumber,
} from '@/database/tenant-sequence.util';
import { CostingService } from '../catalog/costing.service';
import { LedgerService } from '../finance/ledger.service';
import { JournalEntry } from '../finance/entities/journal-entry.entity';
import { InventoryService } from '../inventory/inventory.service';
import {
  SalesOrder,
  SalesOrderLine,
} from '../orders/entities/sales-order.entity';
import { Quote } from '../quotes/entities/quote.entity';
import {
  WorkOrder,
  WorkOrderMaterial,
  WorkOrderOperation,
} from './entities/work-order.entity';

const POSTGRES_UNIQUE_VIOLATION = '23505';
const money = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const round4 = (n: number) => Math.round((n + Number.EPSILON) * 10000) / 10000;

export interface CreateWorkOrdersResult {
  created: WorkOrderDto[];
  skipped: { salesOrderLineId: string; description: string; reason: string }[];
}

/**
 * Work orders: planned from a sales order line's template, run on the floor,
 * costed on completion.
 *
 * Every state-changing method takes the work order row `FOR UPDATE` first.
 * Two tablets pressing stop on the same operation, or a material issue racing
 * completion, then queue instead of both reading the same minutes or the
 * same WIP balance.
 */
@Injectable()
export class ProductionService {
  constructor(
    @InjectRepository(WorkOrder)
    private readonly workOrders: Repository<WorkOrder>,
    @InjectRepository(WorkOrderOperation)
    private readonly operations: Repository<WorkOrderOperation>,
    @InjectRepository(WorkOrderMaterial)
    private readonly materials: Repository<WorkOrderMaterial>,
    @InjectRepository(SalesOrder)
    private readonly salesOrders: Repository<SalesOrder>,
    @InjectRepository(SalesOrderLine)
    private readonly salesOrderLines: Repository<SalesOrderLine>,
    @InjectRepository(Quote)
    private readonly quotes: Repository<Quote>,
    private readonly costing: CostingService,
    private readonly inventory: InventoryService,
    private readonly ledger: LedgerService,
    private readonly dataSource: DataSource,
  ) {}

  /* ------------------------------------------------------------------ *
   * Reading
   * ------------------------------------------------------------------ */

  async list(
    tenantId: string,
    query: WorkOrderQueryPayload,
    canSeeCost: boolean,
  ): Promise<WorkOrderDto[]> {
    const qb = this.workOrders
      .createQueryBuilder('wo')
      .where('wo.tenant_id = :tenantId', { tenantId })
      .orderBy('wo.due_date', 'ASC', 'NULLS LAST')
      .addOrderBy('wo.createdAt', 'DESC')
      .take(500);
    if (query.status)
      qb.andWhere('wo.status = :status', { status: query.status });
    if (query.salesOrderId) {
      qb.andWhere('wo.sales_order_id = :salesOrderId', {
        salesOrderId: query.salesOrderId,
      });
    }
    if (query.dueBefore) {
      qb.andWhere('wo.due_date <= :dueBefore', { dueBefore: query.dueBefore });
    }
    if (query.workCenterId) {
      qb.andWhere(
        `EXISTS (SELECT 1 FROM "work_order_operations" op WHERE op."work_order_id" = wo.id AND op."work_center_id" = :workCenterId)`,
        { workCenterId: query.workCenterId },
      );
    }
    const rows = await qb.getMany();
    return this.toDtos(tenantId, rows, canSeeCost);
  }

  async get(
    tenantId: string,
    id: string,
    canSeeCost: boolean,
  ): Promise<WorkOrderDto> {
    const wo = await this.workOrders.findOne({ where: { id, tenantId } });
    if (!wo) throw new NotFoundException('Work order not found');
    const [dto] = await this.toDtos(tenantId, [wo], canSeeCost);
    return dto;
  }

  /** For chat: jobs someone could be logging time against right now. */
  async findOpenByNumber(
    tenantId: string,
    woNumber: string,
  ): Promise<WorkOrder | null> {
    return this.workOrders.findOne({
      where: { tenantId, woNumber: woNumber.toUpperCase() },
    });
  }

  async listOperations(
    tenantId: string,
    workOrderId: string,
  ): Promise<WorkOrderOperation[]> {
    return this.operations.find({
      where: { tenantId, workOrderId },
      order: { sequence: 'ASC' },
    });
  }

  /* ------------------------------------------------------------------ *
   * Planning
   * ------------------------------------------------------------------ */

  /**
   * One work order per template-priced line on a sales order.
   *
   * The routing and bill of materials come from the costing engine, run
   * against the template version the quote line was priced on. A line typed
   * by hand or sold from the catalog has no routing to follow, so it is
   * skipped with a reason rather than given an empty job.
   */
  async createFromSalesOrder(
    tenantId: string,
    actorId: string,
    salesOrderId: string,
    input: { salesOrderLineIds: string[] | null; dueDate: Date | null },
  ): Promise<CreateWorkOrdersResult> {
    const order = await this.salesOrders.findOne({
      where: { id: salesOrderId, tenantId },
    });
    if (!order) throw new NotFoundException('Sales order not found');
    if (order.status === 'CANCELLED' || order.status === 'CLOSED') {
      throw new BadRequestException(
        `${order.orderNumber} is ${order.status.toLowerCase()} and cannot be put into production`,
      );
    }

    const allLines = await this.salesOrderLines.find({
      where: { salesOrderId: order.id, tenantId },
      order: { sequence: 'ASC' },
    });
    const lines = input.salesOrderLineIds
      ? allLines.filter((l) => input.salesOrderLineIds!.includes(l.id))
      : allLines;
    if (
      input.salesOrderLineIds &&
      lines.length !== input.salesOrderLineIds.length
    ) {
      throw new NotFoundException('One or more lines are not on this order');
    }

    const quote = await this.quotes.findOne({
      where: { id: order.quoteId, tenantId },
    });
    const quoteItems = new Map<string, QuoteLineItem>(
      (quote?.items ?? []).map((item) => [item.id, item]),
    );

    const live = await this.workOrders.find({
      where: {
        tenantId,
        salesOrderLineId: In(lines.map((l) => l.id)),
      },
    });
    const liveLineIds = new Set(
      live
        .filter((w) => w.status !== 'CANCELLED')
        .map((w) => w.salesOrderLineId),
    );

    const result: CreateWorkOrdersResult = { created: [], skipped: [] };
    for (const line of lines) {
      const skip = (reason: string) =>
        result.skipped.push({
          salesOrderLineId: line.id,
          description: line.description,
          reason,
        });

      if (liveLineIds.has(line.id)) {
        skip('Already has a work order');
        continue;
      }
      const item = line.quoteLineId
        ? quoteItems.get(line.quoteLineId)
        : undefined;
      if (!item?.templateId) {
        skip(
          'Not priced from a product template, so there is no routing to follow',
        );
        continue;
      }

      const qty = Math.max(1, Math.round(line.qtyOrdered));
      let planned: Awaited<ReturnType<CostingService['breakdownForTemplate']>>;
      try {
        planned = await this.costing.breakdownForTemplate(
          tenantId,
          item.templateId,
          item.parameters ?? {},
          qty,
        );
      } catch (err) {
        skip(
          err instanceof Error
            ? `Could not be costed: ${err.message}`
            : 'Could not be costed',
        );
        continue;
      }

      try {
        const wo = await this.dataSource.transaction((manager) =>
          this.insertWorkOrder(manager, {
            tenantId,
            actorId,
            order,
            line,
            item,
            qty,
            dueDate: input.dueDate,
            planned,
          }),
        );
        result.created.push(await this.get(tenantId, wo.id, true));
      } catch (err) {
        const code = (err as { code?: string }).code;
        if (
          err instanceof QueryFailedError &&
          code === POSTGRES_UNIQUE_VIOLATION
        ) {
          // Someone else planned this line between our check and our insert.
          skip('Already has a work order');
          continue;
        }
        throw err;
      }
    }
    return result;
  }

  private async insertWorkOrder(
    manager: EntityManager,
    p: {
      tenantId: string;
      actorId: string;
      order: SalesOrder;
      line: SalesOrderLine;
      item: QuoteLineItem;
      qty: number;
      dueDate: Date | null;
      planned: Awaited<ReturnType<CostingService['breakdownForTemplate']>>;
    },
  ): Promise<WorkOrder> {
    const { breakdown, template, catalog } = p.planned;
    const number = await allocateNextSequenceValue(
      manager,
      p.tenantId,
      'work_order_number',
    );

    const estimated: CostSplit = {
      material: breakdown.materialCost,
      machine: breakdown.machineCost,
      labor: breakdown.laborCost,
      tooling: breakdown.amortizedToolingCost,
      overhead: breakdown.overheadCost,
      total: breakdown.totalCost,
      unit: breakdown.unitCost,
    };

    const repo = manager.getRepository(WorkOrder);
    const wo = await repo.save(
      repo.create({
        tenantId: p.tenantId,
        woNumber: formatSequenceNumber('WO', number),
        status: 'PLANNED',
        salesOrderId: p.order.id,
        salesOrderLineId: p.line.id,
        description: p.line.description,
        templateId: template.id,
        templateKey: template.templateKey,
        templateName: template.name,
        templateVersion: template.version,
        parameters: (p.item.parameters ?? {}) as Record<string, unknown>,
        qty: p.qty,
        dueDate: p.dueDate,
        overheadPct: template.pricing?.overheadPct ?? 0,
        quotedUnitCost: p.item.cost?.unitCost ?? null,
        estimatedCost: estimated,
        createdById: p.actorId,
      }),
    );

    const opRepo = manager.getRepository(WorkOrderOperation);
    await opRepo.save(
      [...breakdown.operations]
        .sort((a, b) => a.sequence - b.sequence)
        .map((op, index) => {
          const center = catalog.workCenters[op.workCenterId];
          return opRepo.create({
            tenantId: p.tenantId,
            workOrderId: wo.id,
            sequence: index + 1,
            operationKey: op.key,
            label: op.label,
            workCenterId: op.workCenterId,
            workCenterName: op.workCenterName,
            status: 'PENDING',
            estimatedSetupMinutes: op.setupMinutes,
            estimatedRunMinutes: op.runMinutes,
            estimatedChargedMinutes: op.chargedMinutes,
            machineCostPerHour: center?.machineCostPerHour ?? 0,
            laborCostPerHour: center?.laborCostPerHour ?? 0,
          });
        }),
    );

    // The unique index is per material, and two template lines can draw on
    // the same board.
    const byMaterial = new Map<string, WorkOrderMaterial>();
    const matRepo = manager.getRepository(WorkOrderMaterial);
    for (const m of breakdown.materials) {
      const existing = byMaterial.get(m.materialId);
      if (existing) {
        existing.qtyPlanned = round4(existing.qtyPlanned + m.purchaseUnits);
        continue;
      }
      byMaterial.set(
        m.materialId,
        matRepo.create({
          tenantId: p.tenantId,
          workOrderId: wo.id,
          materialId: m.materialId,
          materialName: m.materialName,
          uom: m.uom,
          qtyPlanned: round4(m.purchaseUnits),
          estimatedUnitCost: m.unitCost,
        }),
      );
    }
    if (byMaterial.size) await matRepo.save([...byMaterial.values()]);

    return wo;
  }

  /* ------------------------------------------------------------------ *
   * Lifecycle
   * ------------------------------------------------------------------ */

  async release(tenantId: string, id: string): Promise<WorkOrderDto> {
    await this.dataSource.transaction(async (manager) => {
      const wo = await this.lock(manager, tenantId, id);
      this.assertTransition(wo, 'RELEASED');
      wo.status = 'RELEASED';
      wo.releasedAt = new Date();
      await manager.getRepository(WorkOrder).save(wo);
    });
    return this.get(tenantId, id, true);
  }

  /**
   * Finishes the job and posts what it cost.
   *
   * Operations nobody touched are marked skipped rather than done-in-zero-
   * minutes; counted as zero they would drag the variance report towards
   * "the estimate was pessimistic" for work that simply was not recorded.
   * A running timer blocks completion, because stopping it on the operator's
   * behalf would guess at when they actually finished.
   */
  async complete(
    tenantId: string,
    id: string,
    actorId: string,
    input: { qtyCompleted: number | null },
    canSeeCost: boolean,
  ): Promise<WorkOrderDto> {
    await this.dataSource.transaction(async (manager) => {
      const wo = await this.lock(manager, tenantId, id);
      this.assertTransition(wo, 'COMPLETE');

      const ops = await manager.getRepository(WorkOrderOperation).find({
        where: { workOrderId: wo.id },
        order: { sequence: 'ASC' },
      });
      const running = ops.find((op) => op.status === 'RUNNING');
      if (running) {
        throw new BadRequestException(
          `"${running.label}" is still running. Stop it first so the time recorded is the time it took.`,
        );
      }
      const now = new Date();
      for (const op of ops) {
        if (op.status === 'PENDING') op.status = 'SKIPPED';
        else if (op.status === 'PAUSED') {
          op.status = 'DONE';
          op.completedAt = now;
        }
      }
      await manager.getRepository(WorkOrderOperation).save(ops);

      const mats = await manager.getRepository(WorkOrderMaterial).find({
        where: { workOrderId: wo.id },
      });
      const wip = money(
        mats.reduce((sum, m) => sum + Number(m.valueIssued), 0),
      );

      const qtyCompleted = input.qtyCompleted ?? wo.qty;
      wo.actualCost = actualCost({
        operations: ops.map((op) => ({
          workCenterId: op.workCenterId,
          workCenterName: op.workCenterName,
          status: op.status,
          estimatedSetupMinutes: op.estimatedSetupMinutes,
          estimatedRunMinutes: op.estimatedRunMinutes,
          estimatedChargedMinutes: op.estimatedChargedMinutes,
          actualMinutes: op.actualMinutes,
          machineCostPerHour: op.machineCostPerHour,
          laborCostPerHour: op.laborCostPerHour,
        })),
        materialValue: wip,
        toolingCost: wo.estimatedCost?.tooling ?? 0,
        overheadPct: wo.overheadPct,
        qtyCompleted,
      });
      wo.status = 'COMPLETE';
      wo.qtyCompleted = qtyCompleted;
      wo.completedAt = now;
      wo.completedById = actorId;
      await manager.getRepository(WorkOrder).save(wo);

      // Only material has been capitalised into WIP, so only material leaves
      // it. Labour and machine time are measured here, not posted: the system
      // has no payroll to credit them against, and inventing an "absorbed
      // labour" account would put a number in the books nobody can reconcile.
      if (wip > 0) {
        await this.post(manager, tenantId, {
          entryNumber: `JE-${wo.woNumber}-DONE`,
          workOrderId: wo.id,
          amount: wip,
          lines: [
            {
              role: LEDGER_ROLES.COGS,
              accountName: 'Cost of goods sold',
              debit: wip,
              credit: 0,
              description: `${wo.woNumber} completed`,
            },
            {
              role: LEDGER_ROLES.WIP,
              accountName: 'Work in progress',
              debit: 0,
              credit: wip,
              description: `${wo.woNumber} completed`,
            },
          ],
        });
      }
    });
    return this.get(tenantId, id, canSeeCost);
  }

  /** Material still on the job has to go back to the shelf, or it stays in WIP with no job to clear it. */
  async cancel(
    tenantId: string,
    id: string,
    reason: string | null,
  ): Promise<WorkOrderDto> {
    await this.dataSource.transaction(async (manager) => {
      const wo = await this.lock(manager, tenantId, id);
      this.assertTransition(wo, 'CANCELLED');
      const mats = await manager.getRepository(WorkOrderMaterial).find({
        where: { workOrderId: wo.id },
      });
      const onJob = mats.filter(
        (m) => Number(m.qtyIssued) - Number(m.qtyReturned) > 0,
      );
      if (onJob.length) {
        throw new BadRequestException(
          `Return ${onJob.map((m) => m.materialName).join(', ')} to stock before cancelling ${wo.woNumber}.`,
        );
      }
      await manager
        .getRepository(WorkOrderOperation)
        .update(
          { workOrderId: wo.id, status: 'RUNNING' },
          { status: 'PAUSED', runningSince: null },
        );
      wo.status = 'CANCELLED';
      wo.cancelledAt = new Date();
      wo.cancelReason = reason;
      await manager.getRepository(WorkOrder).save(wo);
    });
    return this.get(tenantId, id, true);
  }

  /* ------------------------------------------------------------------ *
   * The shop floor
   * ------------------------------------------------------------------ */

  async startOperation(
    tenantId: string,
    id: string,
    operationId: string,
    actorId: string,
  ): Promise<WorkOrderDto> {
    await this.dataSource.transaction(async (manager) => {
      const wo = await this.lockOnFloor(manager, tenantId, id);
      const op = await this.findOperation(manager, wo, operationId);
      if (op.status === 'RUNNING') return; // a double tap is not an error
      if (op.status === 'DONE' || op.status === 'SKIPPED') {
        throw new BadRequestException(`"${op.label}" is already finished`);
      }
      const now = new Date();
      op.status = 'RUNNING';
      op.runningSince = now;
      op.startedAt = op.startedAt ?? now;
      op.operatorId = actorId;
      await manager.getRepository(WorkOrderOperation).save(op);
      await this.markInProgress(manager, wo);
    });
    return this.get(tenantId, id, false);
  }

  /**
   * Stops the clock. `finish` also marks the operation done.
   *
   * A session longer than twelve hours is capped and the cap is reported, on
   * the assumption that somebody went home without pressing stop.
   */
  async stopOperation(
    tenantId: string,
    id: string,
    operationId: string,
    finish: boolean,
  ): Promise<{ workOrder: WorkOrderDto; capped: boolean }> {
    let capped = false;
    await this.dataSource.transaction(async (manager) => {
      const wo = await this.lockOnFloor(manager, tenantId, id);
      const op = await this.findOperation(manager, wo, operationId);
      if (op.status === 'DONE' || op.status === 'SKIPPED') {
        if (finish) return;
        throw new BadRequestException(`"${op.label}" is already finished`);
      }
      const now = new Date();
      if (op.status === 'RUNNING' && op.runningSince) {
        const session = elapsedMinutes(op.runningSince, now);
        capped = session > MAX_SESSION_MINUTES;
        op.actualMinutes =
          Math.round(
            (op.actualMinutes + Math.min(session, MAX_SESSION_MINUTES)) * 100,
          ) / 100;
      } else if (!finish) {
        throw new BadRequestException(`"${op.label}" is not running`);
      }
      op.runningSince = null;
      op.status = finish ? 'DONE' : 'PAUSED';
      if (finish) op.completedAt = now;
      op.startedAt = op.startedAt ?? now;
      await manager.getRepository(WorkOrderOperation).save(op);
    });
    return { workOrder: await this.get(tenantId, id, false), capped };
  }

  /** Time recorded after the fact: from a timesheet, or a chat message. */
  async logTime(
    tenantId: string,
    id: string,
    operationId: string,
    actorId: string,
    minutes: number,
  ): Promise<WorkOrderDto> {
    if (!(minutes > 0))
      throw new BadRequestException('Log more than zero minutes');
    await this.dataSource.transaction(async (manager) => {
      const wo = await this.lockOnFloor(manager, tenantId, id);
      const op = await this.findOperation(manager, wo, operationId);
      if (op.status === 'SKIPPED') {
        throw new BadRequestException(`"${op.label}" was skipped`);
      }
      op.actualMinutes = Math.round((op.actualMinutes + minutes) * 100) / 100;
      op.operatorId = op.operatorId ?? actorId;
      op.startedAt = op.startedAt ?? new Date();
      if (op.status === 'PENDING') op.status = 'PAUSED';
      await manager.getRepository(WorkOrderOperation).save(op);
      await this.markInProgress(manager, wo);
    });
    return this.get(tenantId, id, false);
  }

  /**
   * Issues material to the job (positive qty) or returns it (negative).
   *
   * Issue: Dr WIP / Cr Inventory at the moving average.
   * Return: Dr Inventory / Cr WIP at the average the job was charged. A full
   * return takes back exactly the value left on the job, so WIP for a
   * cancelled job returns to zero rather than to a rounding residue.
   */
  async issueMaterial(
    tenantId: string,
    id: string,
    actorId: string,
    input: { workOrderMaterialId: string; qty: number; locationId?: string },
    canSeeCost: boolean,
  ): Promise<WorkOrderDto> {
    await this.dataSource.transaction(async (manager) => {
      const wo = await this.lockOnFloor(manager, tenantId, id);
      const mat = await manager
        .getRepository(WorkOrderMaterial)
        .createQueryBuilder('m')
        .setLock('pessimistic_write')
        .where('m.id = :mid', { mid: input.workOrderMaterialId })
        .andWhere('m.work_order_id = :wid', { wid: wo.id })
        .getOne();
      if (!mat)
        throw new NotFoundException('That material is not on this work order');

      const onJob = round4(Number(mat.qtyIssued) - Number(mat.qtyReturned));
      const isReturn = input.qty < 0;
      const qty = Math.abs(input.qty);
      if (isReturn && qty > onJob + 1e-9) {
        throw new BadRequestException(
          `Only ${onJob} ${mat.uom.toLowerCase()} of ${mat.materialName} is on this job to return`,
        );
      }
      const returnUnitCost = onJob > 0 ? Number(mat.valueIssued) / onJob : 0;

      const { movement, value: stockValue } =
        await this.inventory.moveForWorkOrder(manager, {
          tenantId,
          materialId: mat.materialId,
          locationId: input.locationId,
          qty: input.qty,
          workOrderId: wo.id,
          workOrderNumber: wo.woNumber,
          actorId,
          returnUnitCost,
        });

      const fullReturn = isReturn && Math.abs(qty - onJob) < 1e-9;
      const value = fullReturn ? money(Number(mat.valueIssued)) : stockValue;

      if (isReturn) {
        mat.qtyReturned = round4(Number(mat.qtyReturned) + qty);
        mat.valueIssued = fullReturn
          ? 0
          : round4(Number(mat.valueIssued) - value);
      } else {
        mat.qtyIssued = round4(Number(mat.qtyIssued) + qty);
        mat.valueIssued = round4(Number(mat.valueIssued) + value);
      }
      mat.lastStockMovementId = movement.id;
      await manager.getRepository(WorkOrderMaterial).save(mat);

      if (value > 0) {
        const description = `${wo.woNumber}: ${isReturn ? 'returned' : 'issued'} ${qty} ${mat.materialName}`;
        const wipLine = {
          role: LEDGER_ROLES.WIP,
          accountName: 'Work in progress',
          description,
        };
        const invLine = {
          role: LEDGER_ROLES.INVENTORY,
          accountName: 'Inventory',
          description,
        };
        await this.post(manager, tenantId, {
          entryNumber: `JE-${wo.woNumber}-${isReturn ? 'RET' : 'ISS'}-${movement.id.slice(0, 8)}`,
          workOrderId: wo.id,
          amount: value,
          lines: isReturn
            ? [
                { ...invLine, debit: value, credit: 0 },
                { ...wipLine, debit: 0, credit: value },
              ]
            : [
                { ...wipLine, debit: value, credit: 0 },
                { ...invLine, debit: 0, credit: value },
              ],
        });
      }
      if (!isReturn) await this.markInProgress(manager, wo);
    });
    return this.get(tenantId, id, canSeeCost);
  }

  /* ------------------------------------------------------------------ *
   * The report
   * ------------------------------------------------------------------ */

  /**
   * Estimated against actual minutes for every finished operation on a
   * completed job, ranked by what the error cost.
   *
   * The estimate compared is setup plus run — the engine's time — not the
   * charged minutes, which include a work centre's minimum charge. A minimum
   * charge is a pricing rule, not a prediction of how long anything takes.
   */
  async varianceReport(
    tenantId: string,
    range: { from?: Date; to?: Date } = {},
  ): Promise<{
    rows: VarianceRow[];
    jobs: number;
    from: string | null;
    to: string | null;
  }> {
    const qb = this.operations
      .createQueryBuilder('op')
      .innerJoin(WorkOrder, 'wo', 'wo.id = op.work_order_id')
      .select([
        'wo.id AS "workOrderId"',
        'wo.template_key AS "templateKey"',
        'wo.template_name AS "templateName"',
        'wo.template_version AS "templateVersion"',
        'op.work_center_id AS "workCenterId"',
        'op.work_center_name AS "workCenterName"',
        'op.estimated_setup_minutes AS "setup"',
        'op.estimated_run_minutes AS "run"',
        'op.actual_minutes AS "actual"',
        'op.labor_cost_per_hour AS "labor"',
        'op.machine_cost_per_hour AS "machine"',
      ])
      .where('wo.tenant_id = :tenantId', { tenantId })
      .andWhere(`wo.status = 'COMPLETE'`)
      .andWhere(`op.status = 'DONE'`);
    if (range.from)
      qb.andWhere('wo.completed_at >= :from', { from: range.from });
    if (range.to) qb.andWhere('wo.completed_at < :to', { to: range.to });

    const raw = await qb.getRawMany<Record<string, string | number | null>>();
    const rows = rankVariance(
      raw.map((r) => ({
        templateKey: (r.templateKey as string) ?? null,
        templateName: (r.templateName as string) ?? null,
        templateVersion:
          r.templateVersion == null ? null : Number(r.templateVersion),
        workCenterId: String(r.workCenterId),
        workCenterName: String(r.workCenterName),
        estimatedMinutes: Number(r.setup) + Number(r.run),
        actualMinutes: Number(r.actual),
        laborCostPerHour: Number(r.labor),
        machineCostPerHour: Number(r.machine),
      })),
    );
    return {
      rows,
      jobs: new Set(raw.map((r) => r.workOrderId)).size,
      from: range.from?.toISOString() ?? null,
      to: range.to?.toISOString() ?? null,
    };
  }

  /* ------------------------------------------------------------------ *
   * Internals
   * ------------------------------------------------------------------ */

  private async lock(
    manager: EntityManager,
    tenantId: string,
    id: string,
  ): Promise<WorkOrder> {
    const wo = await manager
      .getRepository(WorkOrder)
      .createQueryBuilder('wo')
      .setLock('pessimistic_write')
      .where('wo.id = :id', { id })
      .andWhere('wo.tenant_id = :tenantId', { tenantId })
      .getOne();
    if (!wo) throw new NotFoundException('Work order not found');
    return wo;
  }

  private async lockOnFloor(
    manager: EntityManager,
    tenantId: string,
    id: string,
  ): Promise<WorkOrder> {
    const wo = await this.lock(manager, tenantId, id);
    if (!isOnTheFloor(wo.status)) {
      throw new BadRequestException(
        wo.status === 'PLANNED'
          ? `${wo.woNumber} has not been released to the floor yet`
          : `${wo.woNumber} is ${wo.status.toLowerCase()}`,
      );
    }
    return wo;
  }

  private async findOperation(
    manager: EntityManager,
    wo: WorkOrder,
    operationId: string,
  ): Promise<WorkOrderOperation> {
    const op = await manager.getRepository(WorkOrderOperation).findOne({
      where: { id: operationId, workOrderId: wo.id },
    });
    if (!op)
      throw new NotFoundException('That operation is not on this work order');
    return op;
  }

  private async markInProgress(
    manager: EntityManager,
    wo: WorkOrder,
  ): Promise<void> {
    if (wo.status === 'RELEASED') {
      wo.status = 'IN_PROGRESS';
      await manager.getRepository(WorkOrder).save(wo);
    }
  }

  private assertTransition(wo: WorkOrder, to: WorkOrder['status']): void {
    if (!canTransitionWorkOrder(wo.status, to)) {
      throw new ConflictException(
        `${wo.woNumber} is ${wo.status.toLowerCase().replace('_', ' ')} and cannot be ${
          {
            RELEASED: 'released',
            COMPLETE: 'completed',
            CANCELLED: 'cancelled',
            IN_PROGRESS: 'started',
            PLANNED: 'planned',
          }[to]
        }`,
      );
    }
  }

  private async post(
    manager: EntityManager,
    tenantId: string,
    p: {
      entryNumber: string;
      workOrderId: string;
      amount: number;
      lines: JournalLineInput[];
    },
  ): Promise<void> {
    const repo = manager.getRepository(JournalEntry);
    await repo.save(
      repo.create({
        tenantId,
        entryNumber: p.entryNumber,
        referenceType: 'WORK_ORDER',
        referenceId: p.workOrderId,
        entryDate: new Date(),
        totalAmount: p.amount,
        lines: await this.ledger.resolveLines(tenantId, p.lines, manager),
      }),
    );
  }

  private async toDtos(
    tenantId: string,
    rows: WorkOrder[],
    canSeeCost: boolean,
  ): Promise<WorkOrderDto[]> {
    if (!rows.length) return [];
    const ids = rows.map((r) => r.id);
    const soIds = [
      ...new Set(
        rows.map((r) => r.salesOrderId).filter((v): v is string => Boolean(v)),
      ),
    ];
    const [ops, mats, orders] = await Promise.all([
      this.operations.find({
        where: { workOrderId: In(ids) },
        order: { sequence: 'ASC' },
      }),
      this.materials.find({
        where: { workOrderId: In(ids) },
        order: { materialName: 'ASC' },
      }),
      soIds.length
        ? this.salesOrders.find({ where: { id: In(soIds), tenantId } })
        : Promise.resolve([] as SalesOrder[]),
    ]);

    return rows.map((wo) => {
      const order = orders.find((o) => o.id === wo.salesOrderId);
      return {
        id: wo.id,
        woNumber: wo.woNumber,
        status: wo.status,
        salesOrderId: wo.salesOrderId,
        salesOrderNumber: order?.orderNumber ?? null,
        salesOrderLineId: wo.salesOrderLineId,
        customerName: order?.customerName ?? null,
        description: wo.description,
        templateId: wo.templateId,
        templateName: wo.templateName,
        templateVersion: wo.templateVersion,
        qty: wo.qty,
        qtyCompleted: wo.qtyCompleted,
        dueDate: wo.dueDate?.toISOString() ?? null,
        releasedAt: wo.releasedAt?.toISOString() ?? null,
        completedAt: wo.completedAt?.toISOString() ?? null,
        quotedUnitCost: canSeeCost ? wo.quotedUnitCost : null,
        estimatedCost: canSeeCost ? wo.estimatedCost : null,
        actualCost: canSeeCost ? wo.actualCost : null,
        operations: ops
          .filter((op) => op.workOrderId === wo.id)
          .map((op) => ({
            id: op.id,
            sequence: op.sequence,
            label: op.label,
            workCenterId: op.workCenterId,
            workCenterName: op.workCenterName,
            status: op.status,
            estimatedSetupMinutes: op.estimatedSetupMinutes,
            estimatedRunMinutes: op.estimatedRunMinutes,
            estimatedChargedMinutes: op.estimatedChargedMinutes,
            actualMinutes: op.actualMinutes,
            runningSince: op.runningSince?.toISOString() ?? null,
            operatorId: op.operatorId,
            startedAt: op.startedAt?.toISOString() ?? null,
            completedAt: op.completedAt?.toISOString() ?? null,
          })),
        materials: mats
          .filter((m) => m.workOrderId === wo.id)
          .map((m) => ({
            id: m.id,
            materialId: m.materialId,
            materialName: m.materialName,
            uom: m.uom,
            qtyPlanned: m.qtyPlanned,
            qtyIssued: m.qtyIssued,
            qtyReturned: m.qtyReturned,
            valueIssued: canSeeCost ? m.valueIssued : 0,
            estimatedUnitCost: canSeeCost ? m.estimatedUnitCost : 0,
          })),
        createdAt: wo.createdAt.toISOString(),
      };
    });
  }
}
