import { costTemplate, estimateWorkingDays } from '../../engine';
import type { ExprValue } from '../../expression';
import type { CostingCatalog, ProductTemplate } from '../../types';
import type { StarterTemplatePreviewDto } from './dto';
import { ACRYLIC_SIGN_CATALOG, ACRYLIC_SIGN_TEMPLATE } from './signage';
import { CABINET_CATALOG, CABINET_TEMPLATE } from './joinery';
import { LABEL_RUN_CATALOG, LABEL_RUN_TEMPLATE } from './print';
import {
  RIGID_BOX_STARTER,
  RIGID_BOX_STARTER_CATALOG,
  RSC_CARTON_CATALOG,
  RSC_CARTON_TEMPLATE,
} from './packaging';
import { SHEET_METAL_CATALOG, SHEET_METAL_TEMPLATE } from './fabrication';

export * from './dto';
export * from './fabrication';
export * from './joinery';
export * from './packaging';
export * from './print';
export * from './shared-primitives';
export * from './signage';

export type StarterIndustry = 'PACKAGING' | 'PRINT' | 'SIGNAGE' | 'FABRICATION' | 'JOINERY';

export const STARTER_INDUSTRIES: { id: StarterIndustry; label: string; description: string }[] = [
  { id: 'PACKAGING', label: 'Packaging', description: 'Rigid boxes and corrugated cartons.' },
  { id: 'PRINT', label: 'Print', description: 'Labels and short digital runs.' },
  { id: 'SIGNAGE', label: 'Signage', description: 'Acrylic panels and 3D letters.' },
  { id: 'FABRICATION', label: 'Fabrication', description: 'Laser-cut and bent sheet metal.' },
  { id: 'JOINERY', label: 'Joinery and fit-out', description: 'Cabinets built from board.' },
];

/**
 * A complete costing model a new shop can install and quote from on day one:
 * the template plus the materials, work centres and tooling it names, keyed
 * by the same ids the template uses. Rates are AED placeholders.
 */
export interface StarterTemplate {
  key: string;
  industry: StarterIndustry;
  template: ProductTemplate;
  catalog: CostingCatalog;
  /** The job the preview prices. Parameters not given take their defaults. */
  example: { quantity: number; parameters: Record<string, ExprValue> };
}

export const STARTER_TEMPLATES: StarterTemplate[] = [
  {
    key: 'rigid-box',
    industry: 'PACKAGING',
    template: RIGID_BOX_STARTER,
    catalog: RIGID_BOX_STARTER_CATALOG,
    example: {
      quantity: 500,
      parameters: { length_mm: 200, width_mm: 150, height_mm: 60, finish: 'matt', magnet: false, ribbon: false },
    },
  },
  {
    key: 'rsc-carton',
    industry: 'PACKAGING',
    template: RSC_CARTON_TEMPLATE,
    catalog: RSC_CARTON_CATALOG,
    example: {
      quantity: 1000,
      parameters: { length_mm: 400, width_mm: 300, height_mm: 300, board: 'single wall', print: '1 colour' },
    },
  },
  {
    key: 'label-run',
    industry: 'PRINT',
    template: LABEL_RUN_TEMPLATE,
    catalog: LABEL_RUN_CATALOG,
    example: {
      quantity: 5000,
      parameters: { label_w_mm: 60, label_h_mm: 40, stock: 'gloss paper', finish: 'matt laminate', shape: 'rectangle' },
    },
  },
  {
    key: 'acrylic-letter-sign',
    industry: 'SIGNAGE',
    template: ACRYLIC_SIGN_TEMPLATE,
    catalog: ACRYLIC_SIGN_CATALOG,
    example: {
      quantity: 1,
      parameters: { width_mm: 1200, height_mm: 400, letters: 8, letter_h_mm: 200, lit: true, install: true },
    },
  },
  {
    key: 'sheet-metal-part',
    industry: 'FABRICATION',
    template: SHEET_METAL_TEMPLATE,
    catalog: SHEET_METAL_CATALOG,
    example: {
      quantity: 50,
      parameters: {
        blank_w_mm: 300,
        blank_h_mm: 200,
        metal: 'mild steel 2 mm',
        cut_length_m: 1.4,
        pierces: 6,
        bends: 2,
        finish: 'powder coat',
      },
    },
  },
  {
    key: 'cabinet-carcass',
    industry: 'JOINERY',
    template: CABINET_TEMPLATE,
    catalog: CABINET_CATALOG,
    example: {
      quantity: 6,
      parameters: {
        width_mm: 600,
        height_mm: 720,
        depth_mm: 560,
        shelves: 1,
        doors: 2,
        board: 'white melamine',
        install: true,
      },
    },
  },
];

export function findStarterTemplate(key: string): StarterTemplate | undefined {
  return STARTER_TEMPLATES.find((starter) => starter.key === key);
}

/** Everything the picker shows before installing, with the example job priced. */
export function previewStarterTemplate(starter: StarterTemplate): StarterTemplatePreviewDto {
  const { template, catalog, example } = starter;
  const breakdown = costTemplate(template, catalog, example.parameters, example.quantity);
  const industry = STARTER_INDUSTRIES.find((entry) => entry.id === starter.industry);

  return {
    key: starter.key,
    industry: starter.industry,
    industryLabel: industry?.label ?? starter.industry,
    name: template.name,
    description: template.description ?? null,
    currency: template.currency ?? 'AED',
    parameters: template.parameters,
    materials: template.materials.map((line) => {
      const material = catalog.materials[line.materialId];
      return {
        label: line.label,
        name: material.name,
        uom: material.uom,
        costPerUom: material.costPerUom,
        optional: line.condition !== undefined,
      };
    }),
    operations: [...template.operations]
      .sort((a, b) => a.sequence - b.sequence)
      .map((operation) => ({
        label: operation.label,
        workCenterName: catalog.workCenters[operation.workCenterId].name,
        optional: operation.condition !== undefined,
      })),
    tooling: (template.tooling ?? []).map((line) => ({
      label: line.label,
      name: catalog.tooling[line.toolingId].name,
      cost: catalog.tooling[line.toolingId].cost,
    })),
    example: {
      quantity: example.quantity,
      parameters: breakdown.parameters,
      unitCost: breakdown.unitCost,
      unitPrice: breakdown.price.unitPrice,
      grandTotal: breakdown.price.grandTotal,
      workingDays: estimateWorkingDays(breakdown, catalog),
    },
  };
}
