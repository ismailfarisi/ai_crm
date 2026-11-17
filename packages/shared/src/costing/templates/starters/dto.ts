import type { ExprValue } from '../../expression';
import type { MaterialUom, TemplateParameter } from '../../types';

/** One starter as the picker shows it: no ids, the example job priced. */
export interface StarterTemplatePreviewDto {
  key: string;
  industry: string;
  industryLabel: string;
  name: string;
  description: string | null;
  currency: string;
  parameters: TemplateParameter[];
  materials: {
    label: string;
    name: string;
    uom: MaterialUom;
    costPerUom: number;
    /** Only used for some options, e.g. a magnet when "magnetic closure" is on. */
    optional: boolean;
  }[];
  operations: { label: string; workCenterName: string; optional: boolean }[];
  tooling: { label: string; name: string; cost: number }[];
  example: {
    quantity: number;
    parameters: Record<string, ExprValue>;
    unitCost: number;
    unitPrice: number;
    grandTotal: number;
    workingDays: number;
  };
}

/** What installing a starter did to the tenant's catalog. */
export interface StarterInstallResultDto {
  templateId: string;
  templateKey: string;
  created: { materials: number; workCenters: number; tooling: number };
  reused: { materials: number; workCenters: number; tooling: number };
}
