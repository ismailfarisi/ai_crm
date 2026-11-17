import type { CostingCatalog, ProductTemplate } from '../../types';
import { RIGID_BOX_TEMPLATE, SAMPLE_CATALOG } from '../rigid-box';
import { DIE_CUTTER, LAMINATOR, PVA_GLUE, QC_PACK } from './shared-primitives';

/**
 * The rigid box starter is the marketing demo's template, re-rated in AED.
 * Materials are imported stock, so their prices follow the dollar; machine
 * and labour rates are set for a UAE shop instead of converted.
 */
const USD_TO_AED = 3.6725;

export const RIGID_BOX_STARTER_CATALOG: CostingCatalog = {
  materials: {
    ...Object.fromEntries(
      Object.entries(SAMPLE_CATALOG.materials).map(([id, material]) => [
        id,
        {
          ...material,
          sku: material.sku ?? id.toUpperCase(),
          costPerUom: Math.round(material.costPerUom * USD_TO_AED * 100) / 100,
        },
      ]),
    ),
    [PVA_GLUE.id]: PVA_GLUE,
  },
  workCenters: {
    'press-offset': {
      ...SAMPLE_CATALOG.workCenters['press-offset'],
      machineCostPerHour: 260,
      laborCostPerHour: 30,
    },
    [LAMINATOR.id]: LAMINATOR,
    [DIE_CUTTER.id]: DIE_CUTTER,
    'wrap-bench': { ...SAMPLE_CATALOG.workCenters['wrap-bench'], laborCostPerHour: 16 },
    assembly: { ...SAMPLE_CATALOG.workCenters.assembly, laborCostPerHour: 16 },
    [QC_PACK.id]: QC_PACK,
  },
  tooling: {
    'cutting-die': { ...SAMPLE_CATALOG.tooling['cutting-die'], cost: 650 },
  },
};

export const RIGID_BOX_STARTER: ProductTemplate = {
  ...RIGID_BOX_TEMPLATE,
  currency: 'AED',
  blankPreview: 'RIGID_BOX',
};

/**
 * A regular slotted carton (FEFCO 0201): one corrugated blank, four panels
 * plus a glue flap, flaps half the width deep top and bottom.
 */
export const RSC_CARTON_CATALOG: CostingCatalog = {
  materials: {
    'corrugated-c': {
      id: 'corrugated-c',
      sku: 'CORR-C-2200X1400',
      name: 'Corrugated board, single wall C-flute, 2200 × 1400',
      uom: 'SHEET',
      costPerUom: 7.5,
      sheetWidthMm: 2200,
      sheetHeightMm: 1400,
      // Flutes must run around the box for crush strength: no rotating.
      grain: 'LENGTH',
      wastePct: 0.03,
    },
    'corrugated-bc': {
      id: 'corrugated-bc',
      sku: 'CORR-BC-2200X1400',
      name: 'Corrugated board, double wall BC-flute, 2200 × 1400',
      uom: 'SHEET',
      costPerUom: 12,
      sheetWidthMm: 2200,
      sheetHeightMm: 1400,
      grain: 'LENGTH',
      wastePct: 0.03,
    },
    'ink-flexo': {
      id: 'ink-flexo',
      sku: 'INK-FLEXO-WB',
      name: 'Water-based flexo ink',
      uom: 'KG',
      costPerUom: 32,
    },
    [PVA_GLUE.id]: PVA_GLUE,
  },
  workCenters: {
    'board-cutter': {
      id: 'board-cutter',
      name: 'Board cutter-creaser',
      setupMinutes: 15,
      machineCostPerHour: 60,
      laborCostPerHour: 20,
      scrapPct: 0.02,
      minChargeMinutes: 15,
      dailyCapacityMinutes: 480,
    },
    'flexo-slotter': {
      id: 'flexo-slotter',
      name: 'Flexo printer-slotter',
      setupMinutes: 30,
      machineCostPerHour: 150,
      laborCostPerHour: 25,
      scrapPct: 0.03,
      minChargeMinutes: 30,
      dailyCapacityMinutes: 480,
    },
    'folder-gluer': {
      id: 'folder-gluer',
      name: 'Folder-gluer',
      setupMinutes: 20,
      machineCostPerHour: 90,
      laborCostPerHour: 20,
      scrapPct: 0.01,
      minChargeMinutes: 20,
      dailyCapacityMinutes: 480,
    },
    [QC_PACK.id]: QC_PACK,
  },
  tooling: {
    'flexo-plate': {
      id: 'flexo-plate',
      name: 'Flexo printing plate',
      cost: 450,
      amortize: true,
      reusable: true,
    },
  },
};

export const RSC_CARTON_TEMPLATE: ProductTemplate = {
  id: 'rsc-carton',
  version: 1,
  name: 'Shipping carton — regular slotted (RSC)',
  description:
    'Corrugated shipping carton, FEFCO 0201: one blank, glued side seam, optional flexo print.',
  currency: 'AED',
  blankPreview: null,

  parameters: [
    { key: 'length_mm', label: 'Inside length', type: 'NUMBER', unit: 'mm', defaultValue: 400, min: 100, max: 900 },
    { key: 'width_mm', label: 'Inside width', type: 'NUMBER', unit: 'mm', defaultValue: 300, min: 80, max: 600 },
    { key: 'height_mm', label: 'Inside height', type: 'NUMBER', unit: 'mm', defaultValue: 300, min: 50, max: 800 },
    {
      key: 'board',
      label: 'Board',
      type: 'ENUM',
      options: ['single wall', 'double wall'],
      defaultValue: 'single wall',
    },
    {
      key: 'print',
      label: 'Print',
      type: 'ENUM',
      options: ['none', '1 colour', '2 colour'],
      defaultValue: 'none',
    },
  ],

  derived: [
    { key: 'colours', formula: "print == '2 colour' ? 2 : (print == '1 colour' ? 1 : 0)" },
    { key: 'glue_flap_mm', label: 'Glue flap', unit: 'mm', formula: '35' },
    // Four panels side by side plus the glue flap.
    { key: 'blank_w', unit: 'mm', formula: '2 * length_mm + 2 * width_mm + glue_flap_mm' },
    // The wall plus a flap of half the width at the top and at the bottom.
    { key: 'blank_h', unit: 'mm', formula: 'height_mm + width_mm' },
    { key: 'blank_m2', unit: 'm²', formula: 'blank_w * blank_h / 1000000' },
  ],

  materials: [
    {
      key: 'board_single',
      label: 'Corrugated board — single wall',
      materialId: 'corrugated-c',
      mode: 'SHEET_NEST',
      condition: "board == 'single wall'",
      blankWidthFormula: 'blank_w',
      blankHeightFormula: 'blank_h',
    },
    {
      key: 'board_double',
      label: 'Corrugated board — double wall',
      materialId: 'corrugated-bc',
      mode: 'SHEET_NEST',
      condition: "board == 'double wall'",
      blankWidthFormula: 'blank_w',
      blankHeightFormula: 'blank_h',
    },
    {
      key: 'ink',
      label: 'Flexo ink',
      materialId: 'ink-flexo',
      mode: 'PER_UNIT',
      condition: 'colours > 0',
      // About 3 g a square metre a colour, printed on the outside face.
      quantityFormula: 'blank_m2 * 0.003 * colours',
    },
    {
      key: 'glue',
      label: 'Side seam glue',
      materialId: 'glue-pva',
      mode: 'PER_UNIT',
      quantityFormula: 'height_mm / 1000 * 0.004',
    },
  ],

  operations: [
    {
      key: 'cut_crease',
      label: 'Cut sheets to blanks and crease',
      workCenterId: 'board-cutter',
      sequence: 10,
      runMinutesFormula: '(board_single_units + board_double_units) / 400 * 60',
    },
    {
      key: 'print_slot',
      label: 'Print and slot',
      workCenterId: 'flexo-slotter',
      sequence: 20,
      setupMinutesFormula: '20 + 15 * colours',
      runMinutesFormula: 'quantity / 1500 * 60',
    },
    {
      key: 'fold_glue',
      label: 'Fold and glue the side seam',
      workCenterId: 'folder-gluer',
      sequence: 30,
      runMinutesFormula: 'quantity / 2000 * 60',
    },
    {
      key: 'bundle',
      label: 'Count, bundle and strap',
      workCenterId: 'qc-pack',
      sequence: 40,
      runMinutesFormula: 'quantity / 25',
    },
  ],

  tooling: [
    { key: 'plate', label: 'Printing plate', toolingId: 'flexo-plate', condition: 'colours > 0' },
  ],

  pricing: { method: 'MARGIN', rate: 0.25, overheadPct: 0.12, minCharge: 400, roundUnitPriceTo: 0.01 },
};
