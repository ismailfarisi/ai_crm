import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import {
  calculateQuoteTotals,
  calculatePriceBreaks,
  costTemplate,
  CostingError,
  DEFAULT_COSTING_POLICY,
  estimateWorkingDays,
  evaluateGuardrails,
  ExpressionError,
  type CostBreakdown,
  type CostingCatalog,
  type ExprValue,
  type Material as MaterialSpec,
  type MaterialUom,
  type PriceBreak,
  type PriceBreaksPayload,
  type ProductTemplate as TemplateSpec,
  type QuoteLineItem,
  type QuoteTotals,
  type CostingPolicy as CostingPolicySpec,
  type GuardrailViolation,
  type ResolveLineInput,
  type ResolveLinesPayload,
  type Tooling as ToolingSpec,
  type WorkCenter as WorkCenterSpec,
} from '@saas/shared';
import { CatalogItem } from './entities/catalog-item.entity';
import { CostingPolicy } from './entities/costing-policy.entity';
import { Material } from './entities/material.entity';
import { ProductTemplate } from './entities/product-template.entity';
import { Tooling } from './entities/tooling.entity';
import { WorkCenter } from './entities/work-center.entity';

/** Raw stock a quote will consume, ready to become purchase order lines. */
export interface MaterialDemand {
  materialId: string;
  materialName: string;
  uom: MaterialUom;
  /** Whole purchase units, as the engine computed them. */
  purchaseUnits: number;
  /** The engine's standing cost, shown only when no supplier price exists. */
  estimatedUnitCost: number;
}

export interface ResolvedLines {
  lines: QuoteLineItem[];
  totals: QuoteTotals;
  warnings: string[];
  /** Longest lead time across the resolved lines, in working days. */
  leadTimeDays: number;
  /** Policy breaches, so the editor can warn before the user hits save. */
  violations: GuardrailViolation[];
}

/** Lines re-priced from the catalog, with whatever the client claimed discarded. */
export interface RecostedLines {
  items: QuoteLineItem[];
  totals: QuoteTotals;
  violations: GuardrailViolation[];
  /** Lines whose template or catalog item has since been changed or removed. */
  staleLineIds: string[];
}

export interface TemplatePriceBreaks {
  templateId: string;
  templateVersion: number;
  breaks: PriceBreak[];
  warnings: string[];
  leadTimeDays: number;
}

/**
 * Turns catalog references into fully-priced quote lines.
 *
 * This runs on the server and never trusts a client-supplied price or cost.
 * The browser sends `{ catalogItemId | templateId, quantity, parameters }` and
 * gets back finished lines: pricing policy and the cost base are decided here,
 * because a rep who could post their own `unitCost` could clear any margin
 * floor we add in Phase 2.
 */
@Injectable()
export class CostingService {
  constructor(
    @InjectRepository(Material)
    private readonly materials: Repository<Material>,
    @InjectRepository(WorkCenter)
    private readonly workCenters: Repository<WorkCenter>,
    @InjectRepository(Tooling)
    private readonly tooling: Repository<Tooling>,
    @InjectRepository(CatalogItem)
    private readonly items: Repository<CatalogItem>,
    @InjectRepository(ProductTemplate)
    private readonly templates: Repository<ProductTemplate>,
    @InjectRepository(CostingPolicy)
    private readonly policies: Repository<CostingPolicy>,
  ) {}

  /** The tenant's floors, falling back to the shared defaults before setup. */
  async getPolicy(tenantId: string): Promise<CostingPolicySpec> {
    const row = await this.policies.findOne({ where: { tenantId } });
    if (!row) return { ...DEFAULT_COSTING_POLICY };
    return {
      minMarginPct: row.minMarginPct,
      maxDiscountPct: row.maxDiscountPct,
      requireKnownCost: row.requireKnownCost,
      enforce: row.enforce,
    };
  }

  async updatePolicy(
    tenantId: string,
    patch: Partial<CostingPolicySpec>,
  ): Promise<CostingPolicySpec> {
    const row =
      (await this.policies.findOne({ where: { tenantId } })) ??
      this.policies.create({ tenantId, ...DEFAULT_COSTING_POLICY });

    Object.assign(row, patch);
    const saved = await this.policies.save(row);

    return {
      minMarginPct: saved.minMarginPct,
      maxDiscountPct: saved.maxDiscountPct,
      requireKnownCost: saved.requireKnownCost,
      enforce: saved.enforce,
    };
  }

  async resolveLines(tenantId: string, payload: ResolveLinesPayload): Promise<ResolvedLines> {
    const catalog = await this.loadCostingCatalog(tenantId);
    const lines: QuoteLineItem[] = [];
    const warnings: string[] = [];
    let leadTimeDays = 0;

    for (const [index, input] of payload.lines.entries()) {
      if (input.kind === 'CATALOG_ITEM') {
        const item = await this.items.findOne({
          where: { id: input.catalogItemId, tenantId },
        });
        if (!item) {
          throw new NotFoundException(`Catalog item ${input.catalogItemId} not found`);
        }
        lines.push(this.lineFromCatalogItem(item, input, index));
        leadTimeDays = Math.max(leadTimeDays, item.leadTimeDays);
        continue;
      }

      const entity = await this.templates.findOne({
        where: { id: input.templateId, tenantId },
      });
      if (!entity) {
        throw new NotFoundException(`Product template ${input.templateId} not found`);
      }

      const breakdown = this.runCosting(entity, catalog, input.parameters, input.quantity, {
        toolingAlreadyOwned: input.toolingAlreadyOwned,
      });

      warnings.push(...breakdown.warnings.map((warning) => `${entity.name}: ${warning}`));
      leadTimeDays = Math.max(leadTimeDays, estimateWorkingDays(breakdown, catalog));
      lines.push(this.lineFromBreakdown(entity, breakdown, input, index));
    }

    const totals = calculateQuoteTotals(lines);

    return {
      lines,
      totals,
      warnings,
      leadTimeDays,
      violations: evaluateGuardrails(lines, totals, await this.getPolicy(tenantId)),
    };
  }


  /**
   * How much raw stock a set of quote lines actually consumes.
   *
   * The costing engine already works this out — `MaterialCostLine.purchaseUnits`
   * is the whole sheets, boxes and kilos that have to be bought, rounded up
   * where a unit is indivisible — but nothing persists it: a quote line stores
   * aggregate cost, not the material breakdown behind it. So the demand is
   * recomputed from the stored `templateId`, `templateVersion` and parameters,
   * which is also what keeps it honest if the catalog has moved on.
   *
   * Quantities are summed per material across every line, because two lines
   * on one quote using the same board should become one order line.
   */
  async materialDemandForItems(
    tenantId: string,
    items: QuoteLineItem[],
  ): Promise<MaterialDemand[]> {
    const catalog = await this.loadCostingCatalog(tenantId);
    const byMaterial = new Map<string, MaterialDemand>();

    for (const item of items ?? []) {
      if (item.type !== 'product' || !item.templateId) continue;

      const entity = await this.templates.findOne({
        where: { id: item.templateId, tenantId },
      });
      if (!entity) continue;

      const breakdown = this.runCosting(
        entity,
        catalog,
        (item.parameters ?? {}) as Record<string, unknown>,
        item.quantity ?? 1,
        {},
      );

      for (const line of breakdown.materials) {
        const existing = byMaterial.get(line.materialId);
        if (existing) {
          existing.purchaseUnits += line.purchaseUnits;
          existing.estimatedUnitCost = line.unitCost;
        } else {
          byMaterial.set(line.materialId, {
            materialId: line.materialId,
            materialName: line.materialName,
            uom: line.uom,
            purchaseUnits: line.purchaseUnits,
            estimatedUnitCost: line.unitCost,
          });
        }
      }
    }

    return [...byMaterial.values()].map((demand) => ({
      ...demand,
      // Re-round after summing: two lines each needing 1.5 sheets need three,
      // not three point zero after a float add.
      purchaseUnits: Math.round(demand.purchaseUnits * 1000) / 1000,
    }));
  }

  /**
   * Recomputes every line's cost from the catalog, ignoring whatever the
   * client sent.
   *
   * This is the load-bearing half of the margin guardrail. Without it a rep
   * could post an inflated `cost.unitCost`, making a thin quote look healthy
   * and clearing the floor on the way through. Nothing the browser says about
   * cost survives this method.
   */
  async recostLines(tenantId: string, items: QuoteLineItem[]): Promise<RecostedLines> {
    const catalog = await this.loadCostingCatalog(tenantId);
    const staleLineIds: string[] = [];
    const recosted: QuoteLineItem[] = [];

    for (const item of items ?? []) {
      if (item.type !== 'product') {
        recosted.push(item);
        continue;
      }

      if (item.templateId) {
        const entity = await this.templates.findOne({
          where: { id: item.templateId, tenantId },
        });

        // The version a quote points at is immutable, so this only happens if
        // the row was removed outright or belongs to another tenant.
        if (!entity) {
          staleLineIds.push(item.id);
          recosted.push(this.asManualLine(item));
          continue;
        }

        try {
          const breakdown = this.runCosting(
            entity,
            catalog,
            (item.parameters ?? {}) as Record<string, ExprValue>,
            Math.max(1, Math.round(Number(item.quantity) || 1)),
            {},
          );
          recosted.push({
            ...item,
            cost: {
              unitCost: breakdown.unitCost,
              totalCost: breakdown.totalCost,
              source: 'COMPUTED',
              materialCost: breakdown.materialCost,
              machineCost: breakdown.machineCost,
              laborCost: breakdown.laborCost,
              toolingCost: breakdown.amortizedToolingCost,
              overheadCost: breakdown.overheadCost,
            },
          });
        } catch {
          // A template whose primitives have since changed can stop costing.
          // Flag the line rather than failing the whole save — the guardrail
          // then treats it as unknown cost, which is the honest answer.
          staleLineIds.push(item.id);
          recosted.push(this.asManualLine(item));
        }
        continue;
      }

      if (item.catalogItemId) {
        const catalogItem = await this.items.findOne({
          where: { id: item.catalogItemId, tenantId },
        });
        if (!catalogItem) {
          staleLineIds.push(item.id);
          recosted.push(this.asManualLine(item));
          continue;
        }

        const quantity = Number(item.quantity) || 0;
        recosted.push({
          ...item,
          cost: {
            unitCost: catalogItem.standardCost,
            totalCost: round2(catalogItem.standardCost * quantity),
            source: 'STANDARD',
          },
        });
        continue;
      }

      recosted.push(this.asManualLine(item));
    }

    const totals = calculateQuoteTotals(recosted);

    return {
      items: recosted,
      totals,
      violations: evaluateGuardrails(recosted, totals, await this.getPolicy(tenantId)),
      staleLineIds,
    };
  }

  /**
   * A hand-typed line. The cost is dropped rather than kept, because an
   * unverifiable number is worse than an admitted gap — `hasCompleteCost`
   * goes false and the margin stops claiming to be fact.
   */
  private asManualLine(item: QuoteLineItem): QuoteLineItem {
    const { cost: _discarded, ...rest } = item;
    return rest;
  }

  async priceBreaks(
    tenantId: string,
    templateId: string,
    payload: PriceBreaksPayload,
  ): Promise<TemplatePriceBreaks> {
    const entity = await this.templates.findOne({ where: { id: templateId, tenantId } });
    if (!entity) throw new NotFoundException(`Product template ${templateId} not found`);

    const catalog = await this.loadCostingCatalog(tenantId);
    const spec = this.toSpec(entity);
    const parameters = payload.parameters as Record<string, ExprValue>;

    const breaks = this.guard(() =>
      calculatePriceBreaks(spec, catalog, parameters, payload.quantities, {
        toolingAlreadyOwned: payload.toolingAlreadyOwned,
      }),
    );

    // Re-cost the largest run for the warnings and the lead time, since those
    // are the ones a customer actually waits on.
    const largest = Math.max(...payload.quantities);
    const breakdown = this.runCosting(entity, catalog, payload.parameters, largest, {
      toolingAlreadyOwned: payload.toolingAlreadyOwned,
    });

    return {
      templateId: entity.id,
      templateVersion: entity.version,
      breaks,
      warnings: breakdown.warnings,
      leadTimeDays: estimateWorkingDays(breakdown, catalog),
    };
  }

  /* ---------------- internals ---------------- */

  private runCosting(
    entity: ProductTemplate,
    catalog: CostingCatalog,
    parameters: Record<string, unknown>,
    quantity: number,
    context: { toolingAlreadyOwned?: string[] },
  ): CostBreakdown {
    return this.guard(() =>
      costTemplate(
        this.toSpec(entity),
        catalog,
        parameters as Record<string, ExprValue>,
        quantity,
        context,
      ),
    );
  }

  /**
   * A bad dimension or a formula typo is the caller's problem, not a 500.
   * `CostingError` already carries a message written for a human ("Blank for
   * Greyboard — base (1408×1408mm) does not fit on…"), so pass it through.
   */
  private guard<T>(run: () => T): T {
    try {
      return run();
    } catch (error) {
      if (error instanceof CostingError || error instanceof ExpressionError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }

  private lineFromCatalogItem(
    item: CatalogItem,
    input: Extract<ResolveLineInput, { kind: 'CATALOG_ITEM' }>,
    index: number,
  ): QuoteLineItem {
    const gross = item.listPrice * input.quantity;
    const subtotal = gross - gross * (input.discount / 100);
    const totalCost = item.standardCost * input.quantity;

    return {
      id: `line_${Date.now()}_${index}`,
      type: 'product',
      description: item.name,
      quantity: input.quantity,
      uom: item.uom,
      unitPrice: item.listPrice,
      discount: input.discount,
      taxRate: item.taxRate,
      subtotal: round2(subtotal),
      catalogItemId: item.id,
      sku: item.sku,
      leadTimeDays: item.leadTimeDays,
      cost: {
        unitCost: item.standardCost,
        totalCost: round2(totalCost),
        source: 'STANDARD',
      },
    };
  }

  private lineFromBreakdown(
    entity: ProductTemplate,
    breakdown: CostBreakdown,
    input: Extract<ResolveLineInput, { kind: 'TEMPLATE' }>,
    index: number,
  ): QuoteLineItem {
    const gross = breakdown.price.unitPrice * input.quantity;
    const subtotal = gross - gross * (input.discount / 100);

    return {
      id: `line_${Date.now()}_${index}`,
      type: 'product',
      description: this.describe(entity, breakdown),
      quantity: input.quantity,
      uom: 'Units',
      unitPrice: breakdown.price.unitPrice,
      discount: input.discount,
      taxRate: 0,
      subtotal: round2(subtotal),
      templateId: entity.id,
      templateVersion: entity.version,
      sku: entity.templateKey,
      // Retained so the line can be reopened, re-costed and explained later.
      parameters: breakdown.parameters as Record<string, string | number | boolean>,
      effortMinutes: breakdown.totalMinutes,
      cost: {
        unitCost: breakdown.unitCost,
        totalCost: breakdown.totalCost,
        source: 'COMPUTED',
        materialCost: breakdown.materialCost,
        machineCost: breakdown.machineCost,
        laborCost: breakdown.laborCost,
        toolingCost: breakdown.amortizedToolingCost,
        overheadCost: breakdown.overheadCost,
      },
    };
  }

  /** "Rigid gift box — base and lid (200 × 150 × 80mm, matt)". */
  private describe(entity: ProductTemplate, breakdown: CostBreakdown): string {
    const p = breakdown.parameters;
    const dimensions =
      typeof p.length_mm === 'number' &&
      typeof p.width_mm === 'number' &&
      typeof p.height_mm === 'number'
        ? `${p.length_mm} × ${p.width_mm} × ${p.height_mm}mm`
        : null;

    const extras = Object.entries(p)
      .filter(([key, value]) => !key.endsWith('_mm') && value !== false && value !== 'none')
      .map(([key, value]) => (value === true ? key.replace(/_/g, ' ') : String(value)));

    const detail = [dimensions, ...extras].filter(Boolean).join(', ');
    return detail ? `${entity.name} (${detail})` : entity.name;
  }

  private toSpec(entity: ProductTemplate): TemplateSpec {
    return {
      id: entity.id,
      tenantId: entity.tenantId,
      version: entity.version,
      name: entity.name,
      description: entity.description ?? undefined,
      currency: entity.currency,
      parameters: entity.parameters,
      derived: entity.derived,
      materials: entity.materials,
      operations: entity.operations,
      tooling: entity.tooling,
      pricing: entity.pricing,
    };
  }

  /**
   * Loads the whole tenant cost base into the shape the engine wants.
   *
   * Deliberately loads everything rather than only the ids a template names:
   * a template is a handful of rows, a shop's catalog is hundreds at most, and
   * one query beats N round trips inside a costing loop that also runs for
   * every quantity in a price break table.
   */
  async loadCostingCatalog(tenantId: string): Promise<CostingCatalog> {
    const [materials, workCenters, tools] = await Promise.all([
      this.materials.find({ where: { tenantId } }),
      this.workCenters.find({ where: { tenantId } }),
      this.tooling.find({ where: { tenantId } }),
    ]);

    return {
      materials: Object.fromEntries(
        materials.map((row): [string, MaterialSpec] => [
          row.id,
          {
            id: row.id,
            sku: row.sku ?? undefined,
            name: row.name,
            uom: row.uom,
            costPerUom: row.costPerUom,
            sheetWidthMm: row.sheetWidthMm ?? undefined,
            sheetHeightMm: row.sheetHeightMm ?? undefined,
            grain: row.grain,
            wastePct: row.wastePct,
          },
        ]),
      ),
      workCenters: Object.fromEntries(
        workCenters.map((row): [string, WorkCenterSpec] => [
          row.id,
          {
            id: row.id,
            name: row.name,
            setupMinutes: row.setupMinutes,
            machineCostPerHour: row.machineCostPerHour,
            laborCostPerHour: row.laborCostPerHour,
            scrapPct: row.scrapPct,
            minChargeMinutes: row.minChargeMinutes,
            dailyCapacityMinutes: row.dailyCapacityMinutes,
          },
        ]),
      ),
      tooling: Object.fromEntries(
        tools.map((row): [string, ToolingSpec] => [
          row.id,
          {
            id: row.id,
            name: row.name,
            cost: row.cost,
            amortize: row.amortize,
            reusable: row.reusable,
          },
        ]),
      ),
    };
  }

  /** Bulk lookup used when re-costing the lines already on a quote. */
  async findTemplatesByIds(tenantId: string, ids: string[]): Promise<ProductTemplate[]> {
    if (!ids.length) return [];
    return this.templates.find({ where: { tenantId, id: In(ids) } });
  }
}

const round2 = (value: number): number => Math.round(value * 100) / 100;
