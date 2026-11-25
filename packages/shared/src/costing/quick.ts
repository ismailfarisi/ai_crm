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

/**
 * Whether an hours or bought-in amount is for each piece on the line (it grows
 * with the quantity) or once for the whole job (setup, a delivery, an
 * installer's day).
 */
export type QuickCostPer = 'piece' | 'job';

/** Hours rows are per piece unless said otherwise; bought-in rows are for the whole job. */
export const QUICK_COST_DEFAULT_PER = { hours: 'piece', boughtIn: 'job' } as const;

export interface QuickCostHoursInput {
  workCenterId: string;
  /** Hours on this machine or work centre: for each piece, or once for the whole job. */
  hours: number;
  per?: QuickCostPer;
}

export interface QuickCostBoughtInInput {
  description: string;
  /** What the shop pays for it: for each piece, or once for the whole job. Typed by a person. */
  amount: number;
  per?: QuickCostPer;
}

export interface QuickCostInput {
  materials: QuickCostMaterialInput[];
  hours: QuickCostHoursInput[];
  boughtIn: QuickCostBoughtInInput[];
  /** Burden on the direct cost, 0-1. */
  overheadPct: number;
  /**
   * The line quantity the material amounts were entered for. Materials are
   * for the whole line and scale when its quantity changes; per-piece hours
   * and bought-in follow the quantity directly, whole-job ones never change.
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
  per: QuickCostPer;
  /** As entered: for each piece, or for the whole job. */
  hoursEach: number;
  /** For the whole line. */
  hours: number;
  /** After the work centre's minimum charge. */
  chargedHours: number;
  ratePerHour: number;
  machineCost: number;
  laborCost: number;
  cost: number;
}

export interface QuickCostBoughtInLine {
  description: string;
  per: QuickCostPer;
  /** As entered: for each piece, or for the whole job. */
  amountEach: number;
  /** For the whole line. */
  amount: number;
}

export interface QuickCostBreakdown {
  materials: QuickCostMaterialLine[];
  hours: QuickCostHoursLine[];
  boughtIn: QuickCostBoughtInLine[];
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
  /** Line quantity over `costedForQuantity`, applied to materials: 1 unless the quantity changed since. */
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
    const per = row.per ?? QUICK_COST_DEFAULT_PER.hours;
    const lineHours = per === 'piece' ? row.hours * quantity : row.hours;
    const minHours = (centre.minChargeMinutes ?? 0) / 60;
    const chargedHours = Math.max(lineHours, minHours);
    const machineCost = cost4(chargedHours * centre.machineCostPerHour);
    const laborCost = cost4(chargedHours * centre.laborCostPerHour);
    return {
      workCenterId: centre.id,
      name: centre.name,
      per,
      hoursEach: row.hours,
      hours: Math.round(lineHours * 1000) / 1000,
      chargedHours: Math.round(chargedHours * 1000) / 1000,
      ratePerHour: centre.machineCostPerHour + centre.laborCostPerHour,
      machineCost,
      laborCost,
      cost: cost4(machineCost + laborCost),
    };
  });

  const boughtIn = (input.boughtIn ?? []).map((row): QuickCostBoughtInLine => {
    const per = row.per ?? QUICK_COST_DEFAULT_PER.boughtIn;
    return {
      description: row.description,
      per,
      amountEach: row.amount,
      amount: money(per === 'piece' ? row.amount * quantity : row.amount),
    };
  });

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
