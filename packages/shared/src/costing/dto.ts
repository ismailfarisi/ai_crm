import type { GuardrailViolation } from '../quotes/guardrails';
import type { QuoteLineItem, QuoteTotals } from '../quotes/types';
import type { GrainDirection } from './nesting';
import type {
  DerivedVariable,
  MaterialUom,
  PriceBreak,
  TemplateMaterial,
  TemplateOperation,
  TemplateParameter,
  TemplatePricing,
  TemplateTooling,
} from './types';

/** Wire shapes for the catalog endpoints — what the web client actually receives. */

/** A stock material a product is made from. */
export interface MaterialDto {
  id: string;
  sku: string | null;
  name: string;
  uom: MaterialUom;
  costPerUom: number;
  /** Required when `uom` is SHEET; the sheet the nesting engine lays blanks on. */
  sheetWidthMm: number | null;
  sheetHeightMm: number | null;
  grain: GrainDirection;
  /** Fraction, 0–1, added to every calculated quantity. */
  wastePct: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

/** A machine or bench that operations are scheduled and costed against. */
export interface WorkCenterDto {
  id: string;
  name: string;
  setupMinutes: number;
  machineCostPerHour: number;
  laborCostPerHour: number;
  /** Fraction, 0–1, of output lost at this operation. */
  scrapPct: number;
  minChargeMinutes: number;
  dailyCapacityMinutes: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

/** A one-off cost such as a cutting forme or a print plate. */
export interface ToolingDto {
  id: string;
  name: string;
  cost: number;
  /** Spread across the run rather than charged whole to the first order. */
  amortize: boolean;
  /** Kept for the customer's next order instead of remade each time. */
  reusable: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CatalogItemDto {
  id: string;
  sku: string;
  name: string;
  description: string | null;
  uom: string;
  listPrice: number;
  /** Zeroed by the API for an actor without `quote:view_cost`. */
  standardCost: number;
  taxRate: number;
  leadTimeDays: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * A specific, immutable template version.
 *
 * `materials`, `operations`, `tooling` and `pricing` come back empty for an
 * actor without `quote:view_cost` — a bill of materials reverses straight into
 * the cost base. `parameters` always survives, because the picker form needs it.
 */
export interface ProductTemplateDto {
  id: string;
  templateKey: string;
  version: number;
  isCurrent: boolean;
  name: string;
  description: string | null;
  currency: string;
  parameters: TemplateParameter[];
  derived: DerivedVariable[];
  materials: TemplateMaterial[];
  operations: TemplateOperation[];
  tooling: TemplateTooling[];
  pricing: TemplatePricing;
  createdAt: string;
  updatedAt: string;
}

export interface ResolvedLinesDto {
  lines: QuoteLineItem[];
  totals: QuoteTotals;
  /** Costing notes worth showing, e.g. a layout wasting most of a sheet. */
  warnings: string[];
  leadTimeDays: number;
  violations: GuardrailViolation[];
}

export interface TemplatePriceBreaksDto {
  templateId: string;
  templateVersion: number;
  breaks: PriceBreak[];
  warnings: string[];
  leadTimeDays: number;
}

export interface QuoteGuardrailsDto {
  violations: GuardrailViolation[];
  totals: QuoteTotals;
}
