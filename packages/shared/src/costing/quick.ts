import type { QuoteLineCostSnapshot } from '../quotes/types';
import type { CostingCatalog, MaterialUom } from './types';

/**
 * Quick costing: what a hand-typed, one-off line costs, without building a
 * product template.
 *
 * The estimator says what the job uses, for the whole line: materials from
 * stock, hours on each machine or work centre, anything bought in, and an
 * overhead %. Materials and hours are costed at the catalog's own rates on
 * the server; only a bought-in amount is a figure a person types.
 */
export interface QuickCostMaterialInput {
  materialId: string;
  /** In the material's own unit (sheets, metres, kg, pieces), for the whole line. */
  quantity: number;
}

export interface QuickCostHoursInput {
  workCenterId: string;
  /** Hours on this machine or work centre for the whole line, setup included. */
  hours: number;
}

export interface QuickCostBoughtInInput {
  description: string;
  /** What the shop pays for it, for the whole line. Typed by a person. */
  amount: number;
}

export interface QuickCostInput {
  materials: QuickCostMaterialInput[];
  hours: QuickCostHoursInput[];
  boughtIn: QuickCostBoughtInInput[];
  /** Burden on the direct cost, 0-1. */
  overheadPct: number;
  /**
   * The line quantity the amounts were worked out for. When the quantity on
   * the line changes later, every amount scales with it (twice the pieces,
   * twice the material, hours and bought-in), which overstates fixed setup
   * time; the editor says so and offers to re-check the costing.
   */
  costedForQuantity: number;
}

export interface QuickCostMaterialLine {
  materialId: string;
  name: string;
  uom: MaterialUom;
  quantity: number;
  wastePct: number;
  /** Quantity plus the material's waste, whole sheets and pieces rounded up. */
  purchaseUnits: number;
  unitCost: number;
  cost: number;
}

export interface QuickCostHoursLine {
  workCenterId: string;
  name: string;
  hours: number;
  /** After the work centre's minimum charge. */
  chargedHours: number;
  ratePerHour: number;
  machineCost: number;
  laborCost: number;
  cost: number;
}

export interface QuickCostBreakdown {
  materials: QuickCostMaterialLine[];
  hours: QuickCostHoursLine[];
  boughtIn: QuickCostBoughtInInput[];
  materialCost: number;
  machineCost: number;
  laborCost: number;
  boughtInCost: number;
  directCost: number;
  overheadPct: number;
  overheadCost: number;
  totalCost: number;
  /** `totalCost` over the line quantity. */
  unitCost: number;
  quantity: number;
  /** Line quantity over `costedForQuantity`: 1 unless the quantity changed since. */
  scale: number;
}

export class QuickCostError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QuickCostError';
  }
}

const money = (value: number): number => Math.round(value * 100) / 100;
const cost4 = (value: number): number => Math.round(value * 10000) / 10000;

/** True when the costing names anything at all; an empty one has no cost to give. */
export function hasQuickCostInputs(input: QuickCostInput | null | undefined): input is QuickCostInput {
  return Boolean(
    input && (input.materials?.length || input.hours?.length || input.boughtIn?.length),
  );
}

/**
 * Costs a quick costing against the shop's own rates.
 *
 * Throws `QuickCostError` with a message for a person when a material or work
 * centre no longer exists, or when the costing adds up to nothing: a cost of
 * zero would read as a 100% margin and clear any floor.
 */
export function costQuickLine(
  input: QuickCostInput,
  catalog: Pick<CostingCatalog, 'materials' | 'workCenters'>,
  lineQuantity: number,
): QuickCostBreakdown {
  const quantity = lineQuantity > 0 ? lineQuantity : 1;
  const costedFor = Number(input.costedForQuantity) > 0 ? Number(input.costedForQuantity) : quantity;
  const scale = quantity / costedFor;

  const materials = (input.materials ?? []).map((row): QuickCostMaterialLine => {
    const material = catalog.materials[row.materialId];
    if (!material) throw new QuickCostError('A material in this costing has been removed from the catalog');
    const wastePct = material.wastePct ?? 0;
    const withWaste = row.quantity * scale * (1 + wastePct);
    const whole = material.uom === 'SHEET' || material.uom === 'EACH';
    // Rounded to 6dp first, so 2 × 1.05 does not become 3 sheets on a float.
    const purchaseUnits = whole ? Math.ceil(Math.round(withWaste * 1e6) / 1e6) : withWaste;
    return {
      materialId: material.id,
      name: material.name,
      uom: material.uom,
      quantity: row.quantity * scale,
      wastePct,
      purchaseUnits: Math.round(purchaseUnits * 1000) / 1000,
      unitCost: material.costPerUom,
      cost: cost4(purchaseUnits * material.costPerUom),
    };
  });

  const hours = (input.hours ?? []).map((row): QuickCostHoursLine => {
    const centre = catalog.workCenters[row.workCenterId];
    if (!centre) throw new QuickCostError('A machine or work centre in this costing has been removed');
    const minHours = (centre.minChargeMinutes ?? 0) / 60;
    const chargedHours = Math.max(row.hours * scale, minHours);
    const machineCost = cost4(chargedHours * centre.machineCostPerHour);
    const laborCost = cost4(chargedHours * centre.laborCostPerHour);
    return {
      workCenterId: centre.id,
      name: centre.name,
      hours: row.hours * scale,
      chargedHours: Math.round(chargedHours * 1000) / 1000,
      ratePerHour: centre.machineCostPerHour + centre.laborCostPerHour,
      machineCost,
      laborCost,
      cost: cost4(machineCost + laborCost),
    };
  });

  const boughtIn = (input.boughtIn ?? []).map((row) => ({
    description: row.description,
    amount: money(row.amount * scale),
  }));

  const materialCost = materials.reduce((sum, line) => sum + line.cost, 0);
  const machineCost = hours.reduce((sum, line) => sum + line.machineCost, 0);
  const laborCost = hours.reduce((sum, line) => sum + line.laborCost, 0);
  const boughtInCost = boughtIn.reduce((sum, line) => sum + line.amount, 0);
  const directCost = materialCost + machineCost + laborCost + boughtInCost;
  if (!(directCost > 0)) {
    throw new QuickCostError('This costing adds up to nothing. Add a material, some hours or a bought-in item.');
  }
  const overheadPct = Math.min(1, Math.max(0, Number(input.overheadPct) || 0));
  const overheadCost = directCost * overheadPct;
  const totalCost = money(directCost + overheadCost);

  return {
    materials,
    hours,
    boughtIn,
    materialCost: money(materialCost),
    machineCost: money(machineCost),
    laborCost: money(laborCost),
    boughtInCost: money(boughtInCost),
    directCost: money(directCost),
    overheadPct,
    overheadCost: money(overheadCost),
    totalCost,
    unitCost: cost4(totalCost / quantity),
    quantity,
    scale,
  };
}

/**
 * The lowest unit price that keeps `targetMarginPct` of the line's untaxed
 * subtotal after its discount, rounded up to the cent. Null when the target
 * cannot be reached (100% or more) or the discount takes everything.
 */
export function priceForMargin(
  unitCost: number,
  targetMarginPct: number,
  discountPct = 0,
): number | null {
  const keep = 1 - targetMarginPct;
  const afterDiscount = 1 - Math.min(100, Math.max(0, discountPct)) / 100;
  if (!(keep > 0) || !(afterDiscount > 0)) return null;
  return Math.ceil((unitCost / keep / afterDiscount) * 100 - 1e-9) / 100;
}

/** The cost a quick costing puts on its quote line. */
export function quickCostSnapshot(breakdown: QuickCostBreakdown): QuoteLineCostSnapshot {
  return {
    unitCost: breakdown.unitCost,
    totalCost: breakdown.totalCost,
    source: 'QUICK',
    materialCost: breakdown.materialCost,
    machineCost: breakdown.machineCost,
    laborCost: breakdown.laborCost,
    boughtInCost: breakdown.boughtInCost,
    overheadCost: breakdown.overheadCost,
  };
}
