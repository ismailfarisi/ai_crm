import type { GuardrailViolation } from '../quotes/guardrails';
import type { QuoteLineItem, QuoteTotals } from '../quotes/types';
import type {
  DerivedVariable,
  PriceBreak,
  TemplateMaterial,
  TemplateOperation,
  TemplateParameter,
  TemplatePricing,
  TemplateTooling,
} from './types';

/** Wire shapes for the catalog endpoints — what the web client actually receives. */

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
