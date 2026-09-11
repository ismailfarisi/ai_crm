import type { ExprValue } from './expression';
import type { GrainDirection } from './nesting';

/* ------------------------------------------------------------------ *
 * Cost primitives — tenant-configurable data, no code
 * ------------------------------------------------------------------ */

export type MaterialUom = 'SHEET' | 'METRE' | 'KG' | 'EACH';

export interface Material {
  id: string;
  sku?: string;
  name: string;
  uom: MaterialUom;
  /** Purchase cost of one `uom`. Kept at 4dp — unit costs divide. */
  costPerUom: number;
  /** Required when `uom === 'SHEET'`. */
  sheetWidthMm?: number;
  sheetHeightMm?: number;
  /** A grained or pre-printed stock cannot be rotated when nesting. */
  grain?: GrainDirection;
  /** Default scrap allowance, 0-1. A template line may override it. */
  wastePct?: number;
}

export interface WorkCenter {
  id: string;
  name: string;
  /** Make-ready. Charged once per operation, regardless of order quantity. */
  setupMinutes: number;
  machineCostPerHour: number;
  laborCostPerHour: number;
  laborRoleId?: string | null;
  /** Rework/spoilage as a time uplift on run minutes, 0-1. */
  scrapPct?: number;
  /** Nobody books the press for four minutes. */
  minChargeMinutes?: number;
  /** Drives lead time, not cost. */
  dailyCapacityMinutes?: number;
}

export interface Tooling {
  id: string;
  name: string;
  cost: number;
  /**
   * `true` folds the cost into the unit price; `false` bills it as its own
   * line. Either way, a reusable die must not be charged twice on a repeat
   * order — that is the caller's job, via `ToolingContext.alreadyOwned`.
   */
  amortize: boolean;
  reusable: boolean;
}

export interface CostingCatalog {
  materials: Record<string, Material>;
  workCenters: Record<string, WorkCenter>;
  tooling: Record<string, Tooling>;
}

/* ------------------------------------------------------------------ *
 * Product template — parameters + BOM + routing
 * ------------------------------------------------------------------ */

export type ParameterType = 'NUMBER' | 'ENUM' | 'BOOLEAN';

export interface TemplateParameter {
  key: string;
  label: string;
  type: ParameterType;
  unit?: string;
  defaultValue?: ExprValue;
  min?: number;
  max?: number;
  options?: string[];
  help?: string;
}

/** A named intermediate, evaluated in declaration order. */
export interface DerivedVariable {
  key: string;
  label?: string;
  formula: string;
  unit?: string;
}

/**
 * - `SHEET_NEST` — nest a blank onto a purchased sheet. Stepped.
 * - `PER_UNIT`   — formula gives consumption per finished piece.
 * - `FIXED`      — formula gives total consumption for the whole order.
 */
export type MaterialConsumption = 'SHEET_NEST' | 'PER_UNIT' | 'FIXED';

export interface TemplateMaterial {
  /** Identifier published into scope as `<key>_units`, `<key>_cost`, … */
  key: string;
  label: string;
  materialId: string;
  mode: MaterialConsumption;
  /** `SHEET_NEST` only. */
  blankWidthFormula?: string;
  blankHeightFormula?: string;
  marginMm?: number;
  gutterMm?: number;
  /** `PER_UNIT` / `FIXED` only — result is in the material's own UoM. */
  quantityFormula?: string;
  /** Overrides `Material.wastePct`. */
  wastePctFormula?: string;
  /** Skip this line entirely when the expression is false. */
  condition?: string;
}

export interface TemplateOperation {
  /** Published into scope as `<key>_minutes`, `<key>_cost`. */
  key: string;
  label: string;
  workCenterId: string;
  sequence: number;
  /** Defaults to the work centre's own setup time. */
  setupMinutesFormula?: string;
  /** May reference material results, e.g. `board_base_units / 900 * 60`. */
  runMinutesFormula: string;
  condition?: string;
  /**
   * Concurrent branch name. Operations on the same branch run in sequence;
   * different branches run at the same time. Ungrouped operations are serial.
   * Printing and laminating the wrap is one branch, die-cutting the board is
   * another — they happen side by side, then both feed hand-wrapping.
   */
  branch?: string | null;
}

export interface TemplateTooling {
  key: string;
  label: string;
  toolingId: string;
  condition?: string;
}

export interface TemplatePricing {
  /**
   * `MARGIN` divides by `(1 - rate)`; `MARKUP` multiplies by `(1 + rate)`.
   * These are not the same number — 30% markup is 23% margin — so the method
   * is stored explicitly rather than inferred.
   */
  method: 'MARGIN' | 'MARKUP';
  rate: number;
  /** Burden on direct cost, 0-1. */
  overheadPct?: number;
  /** Floor on the order total, before separately-billed tooling. */
  minCharge?: number;
  /** Round the unit price up to this increment, e.g. 0.05. */
  roundUnitPriceTo?: number;
}

export interface ProductTemplate {
  id: string;
  tenantId?: string;
  /** Immutable. A quote references a version, never the live template. */
  version: number;
  name: string;
  description?: string;
  currency?: string;
  parameters: TemplateParameter[];
  derived?: DerivedVariable[];
  materials: TemplateMaterial[];
  operations: TemplateOperation[];
  tooling?: TemplateTooling[];
  pricing: TemplatePricing;
}

/* ------------------------------------------------------------------ *
 * Costing output
 * ------------------------------------------------------------------ */

export interface MaterialCostLine {
  key: string;
  label: string;
  materialId: string;
  materialName: string;
  mode: MaterialConsumption;
  uom: MaterialUom;
  blankWidthMm?: number;
  blankHeightMm?: number;
  perSheet?: number;
  orientation?: 'AS_IS' | 'ROTATED';
  utilisation?: number;
  wastePct: number;
  /** Purchase units actually bought — whole sheets/pieces where indivisible. */
  purchaseUnits: number;
  unitCost: number;
  cost: number;
}

export interface OperationCostLine {
  key: string;
  label: string;
  workCenterId: string;
  workCenterName: string;
  sequence: number;
  branch?: string | null;
  setupMinutes: number;
  runMinutes: number;
  /** After the work centre's minimum charge is applied. */
  chargedMinutes: number;
  machineCost: number;
  laborCost: number;
  cost: number;
}

export interface ToolingCostLine {
  key: string;
  label: string;
  toolingId: string;
  cost: number;
  amortized: boolean;
  /** True when the customer already owns the die and it was not charged. */
  reused: boolean;
}

export interface PriceResult {
  totalPrice: number;
  unitPrice: number;
  marginAmount: number;
  marginPct: number;
  /** Tooling billed as its own line, excluded from `unitPrice`. */
  separateToolingPrice: number;
  grandTotal: number;
}

export interface CostBreakdown {
  templateId: string;
  templateVersion: number;
  quantity: number;
  parameters: Record<string, ExprValue>;

  materials: MaterialCostLine[];
  operations: OperationCostLine[];
  tooling: ToolingCostLine[];

  materialCost: number;
  machineCost: number;
  laborCost: number;
  amortizedToolingCost: number;
  separateToolingCost: number;

  directCost: number;
  overheadCost: number;
  totalCost: number;
  unitCost: number;

  price: PriceResult;

  totalMinutes: number;
  /** Longest path through the routing, honouring concurrent branches. */
  criticalPathMinutes: number;

  /** Full evaluation scope, so a quote can explain itself six months later. */
  scope: Record<string, ExprValue>;
  warnings: string[];
}

export interface PriceBreak {
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  unitCost: number;
  marginPct: number;
}
