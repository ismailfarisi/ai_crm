import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, MoreThanOrEqual, Repository } from 'typeorm';
import { reviewCosting, type CostingReviewDto } from '@saas/shared';
import {
  WorkOrder,
  WorkOrderMaterial,
  WorkOrderOperation,
} from '../production/entities/work-order.entity';
import { Material } from './entities/material.entity';
import { WorkCenter } from './entities/work-center.entity';

/** Wide enough for slow-moving catalogs; bounded so a query stays cheap. */
export const COSTING_REVIEW_MAX_DAYS = 730;

/**
 * What completed jobs say about the catalog's rates. Reads only; a proposal
 * is applied, if at all, through the ordinary catalog update.
 */
@Injectable()
export class CostingReviewService {
  constructor(
    @InjectRepository(WorkOrder)
    private readonly workOrders: Repository<WorkOrder>,
    @InjectRepository(WorkOrderMaterial)
    private readonly materialUses: Repository<WorkOrderMaterial>,
    @InjectRepository(WorkOrderOperation)
    private readonly operations: Repository<WorkOrderOperation>,
    @InjectRepository(Material)
    private readonly materials: Repository<Material>,
    @InjectRepository(WorkCenter)
    private readonly workCenters: Repository<WorkCenter>,
  ) {}

  async review(tenantId: string, days: number): Promise<CostingReviewDto> {
    const windowDays = Math.min(
      COSTING_REVIEW_MAX_DAYS,
      Math.max(1, Math.round(days)),
    );
    const from = new Date(Date.now() - windowDays * 86_400_000);

    const jobs = await this.workOrders.find({
      where: {
        tenantId,
        status: 'COMPLETE',
        completedAt: MoreThanOrEqual(from),
      },
      select: {
        id: true,
        woNumber: true,
        estimatedCost: true,
        actualCost: true,
      },
    });
    const ids = jobs.map((j) => j.id);
    const numbers = new Map(jobs.map((j) => [j.id, j.woNumber]));

    const [uses, ops, materials, centres] = await Promise.all([
      ids.length
        ? this.materialUses.find({ where: { tenantId, workOrderId: In(ids) } })
        : [],
      ids.length
        ? this.operations.find({ where: { tenantId, workOrderId: In(ids) } })
        : [],
      this.materials.find({ where: { tenantId, deletedAt: IsNull() } }),
      this.workCenters.find({ where: { tenantId, deletedAt: IsNull() } }),
    ]);

    const review = reviewCosting({
      jobs: jobs.map((j) => ({
        workOrderId: j.id,
        woNumber: j.woNumber,
        estimated: j.estimatedCost,
        actual: j.actualCost,
      })),
      materialUses: uses.map((u) => ({
        workOrderId: u.workOrderId,
        woNumber: numbers.get(u.workOrderId) ?? '',
        materialId: u.materialId,
        qtyPlanned: u.qtyPlanned,
        qtyNet: u.qtyIssued - u.qtyReturned,
        valueIssued: u.valueIssued,
        plannedWastePct: u.plannedWastePct,
      })),
      operations: ops.map((o) => ({
        workOrderId: o.workOrderId,
        woNumber: numbers.get(o.workOrderId) ?? '',
        workCenterId: o.workCenterId,
        estimatedSetupMinutes: o.estimatedSetupMinutes,
        estimatedRunMinutes: o.estimatedRunMinutes,
        estimatedChargedMinutes: o.estimatedChargedMinutes,
        actualMinutes: o.actualMinutes,
        plannedScrapPct: o.plannedScrapPct,
        machineCostPerHour: o.machineCostPerHour,
        laborCostPerHour: o.laborCostPerHour,
      })),
      catalog: {
        materials: materials.map((m) => ({
          id: m.id,
          name: m.name,
          uom: m.uom,
          costPerUom: m.costPerUom,
          wastePct: m.wastePct,
        })),
        workCenters: centres.map((w) => ({
          id: w.id,
          name: w.name,
          scrapPct: w.scrapPct,
          machineCostPerHour: w.machineCostPerHour,
          laborCostPerHour: w.laborCostPerHour,
        })),
      },
    });

    return { ...review, windowDays, from: from.toISOString().slice(0, 10) };
  }
}
