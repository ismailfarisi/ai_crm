import type { CostingCatalog, ProductTemplate } from '../../types';
import { QC_PACK } from './shared-primitives';

/**
 * A flat sheet-metal part: nested and cut on a fibre laser, bent on a press
 * brake, deburred, optionally powder coated. Quote it from the flat blank
 * size and the cut length the drawing gives you.
 */
export const SHEET_METAL_CATALOG: CostingCatalog = {
  materials: {
    'ms-2-sheet': {
      id: 'ms-2-sheet',
      sku: 'MS-2.0-1250X2500',
      name: 'Mild steel sheet 2 mm, 1250 × 2500',
      uom: 'SHEET',
      costPerUom: 210,
      sheetWidthMm: 2500,
      sheetHeightMm: 1250,
      grain: 'NONE',
    },
    'ss304-1.5-sheet': {
      id: 'ss304-1.5-sheet',
      sku: 'SS304-1.5-1250X2500',
      name: 'Stainless 304 sheet 1.5 mm brushed, 1250 × 2500',
      uom: 'SHEET',
      costPerUom: 520,
      sheetWidthMm: 2500,
      sheetHeightMm: 1250,
      // The brushed finish has to run the same way on every part.
      grain: 'LENGTH',
    },
    'al-3-sheet': {
      id: 'al-3-sheet',
      sku: 'AL5052-3.0-1250X2500',
      name: 'Aluminium 5052 sheet 3 mm, 1250 × 2500',
      uom: 'SHEET',
      costPerUom: 430,
      sheetWidthMm: 2500,
      sheetHeightMm: 1250,
      grain: 'NONE',
    },
    'powder-ral': {
      id: 'powder-ral',
      sku: 'POWDER-RAL-STD',
      name: 'Polyester powder coat, standard RAL',
      uom: 'KG',
      costPerUom: 28,
      wastePct: 0.25,
    },
  },
  workCenters: {
    'fibre-laser': {
      id: 'fibre-laser',
      name: 'Fibre laser 3 kW',
      setupMinutes: 10,
      machineCostPerHour: 220,
      laborCostPerHour: 25,
      scrapPct: 0.02,
      minChargeMinutes: 15,
      dailyCapacityMinutes: 960,
    },
    'press-brake': {
      id: 'press-brake',
      name: 'Press brake',
      setupMinutes: 10,
      machineCostPerHour: 90,
      laborCostPerHour: 25,
      scrapPct: 0.01,
      minChargeMinutes: 15,
      dailyCapacityMinutes: 480,
    },
    'deburr-bench': {
      id: 'deburr-bench',
      name: 'Deburr and finish bench',
      setupMinutes: 5,
      machineCostPerHour: 5,
      laborCostPerHour: 20,
      dailyCapacityMinutes: 960,
    },
    'powder-line': {
      id: 'powder-line',
      name: 'Powder coat line',
      setupMinutes: 30,
      machineCostPerHour: 70,
      laborCostPerHour: 20,
      minChargeMinutes: 60,
      dailyCapacityMinutes: 480,
    },
    [QC_PACK.id]: QC_PACK,
  },
  tooling: {
    'bend-fixture': {
      id: 'bend-fixture',
      name: 'Press brake bending fixture',
      cost: 350,
      amortize: true,
      reusable: true,
    },
  },
};

export const SHEET_METAL_TEMPLATE: ProductTemplate = {
  id: 'sheet-metal-part',
  version: 1,
  name: 'Sheet-metal part — laser cut and bent',
  description:
    'Flat part nested and cut on a fibre laser, bent on a press brake, optionally powder coated.',
  currency: 'AED',
  blankPreview: null,

  parameters: [
    { key: 'blank_w_mm', label: 'Flat blank width', type: 'NUMBER', unit: 'mm', defaultValue: 300, min: 20, max: 2400 },
    { key: 'blank_h_mm', label: 'Flat blank height', type: 'NUMBER', unit: 'mm', defaultValue: 200, min: 20, max: 1200 },
    {
      key: 'metal',
      label: 'Material',
      type: 'ENUM',
      options: ['mild steel 2 mm', 'stainless 304 1.5 mm', 'aluminium 3 mm'],
      defaultValue: 'mild steel 2 mm',
    },
    {
      key: 'cut_length_m',
      label: 'Cut length per part',
      type: 'NUMBER',
      unit: 'm',
      defaultValue: 1.2,
      min: 0.05,
      max: 50,
      help: 'Outline plus every hole, from the drawing.',
    },
    { key: 'pierces', label: 'Pierces per part', type: 'NUMBER', defaultValue: 4, min: 1, max: 500 },
    { key: 'bends', label: 'Bends per part', type: 'NUMBER', defaultValue: 2, min: 0, max: 20 },
    {
      key: 'finish',
      label: 'Finish',
      type: 'ENUM',
      options: ['none', 'powder coat'],
      defaultValue: 'none',
    },
  ],

  derived: [
    // Cutting speed in metres a minute: stainless and thick aluminium are slower.
    {
      key: 'cut_speed',
      unit: 'm/min',
      formula: "metal == 'stainless 304 1.5 mm' ? 6 : (metal == 'aluminium 3 mm' ? 5 : 8)",
    },
    { key: 'part_m2', unit: 'm²', formula: 'blank_w_mm * blank_h_mm / 1000000' },
  ],

  materials: [
    {
      key: 'mild_steel',
      label: 'Sheet — mild steel',
      materialId: 'ms-2-sheet',
      mode: 'SHEET_NEST',
      condition: "metal == 'mild steel 2 mm'",
      blankWidthFormula: 'blank_w_mm',
      blankHeightFormula: 'blank_h_mm',
      gutterMm: 5,
    },
    {
      key: 'stainless',
      label: 'Sheet — stainless',
      materialId: 'ss304-1.5-sheet',
      mode: 'SHEET_NEST',
      condition: "metal == 'stainless 304 1.5 mm'",
      blankWidthFormula: 'blank_w_mm',
      blankHeightFormula: 'blank_h_mm',
      gutterMm: 5,
    },
    {
      key: 'aluminium',
      label: 'Sheet — aluminium',
      materialId: 'al-3-sheet',
      mode: 'SHEET_NEST',
      condition: "metal == 'aluminium 3 mm'",
      blankWidthFormula: 'blank_w_mm',
      blankHeightFormula: 'blank_h_mm',
      gutterMm: 5,
    },
    {
      key: 'powder',
      label: 'Powder coat',
      materialId: 'powder-ral',
      mode: 'PER_UNIT',
      condition: "finish == 'powder coat'",
      // Both faces at about 120 g a square metre.
      quantityFormula: 'part_m2 * 2 * 0.12',
    },
  ],

  operations: [
    {
      key: 'laser',
      label: 'Laser cut',
      workCenterId: 'fibre-laser',
      sequence: 10,
      runMinutesFormula: 'quantity * (cut_length_m / cut_speed + pierces * 0.02)',
    },
    {
      key: 'bend',
      label: 'Bend',
      workCenterId: 'press-brake',
      sequence: 20,
      condition: 'bends > 0',
      setupMinutesFormula: '10 + bends * 5',
      runMinutesFormula: 'quantity * bends * 0.5',
    },
    {
      key: 'deburr',
      label: 'Deburr',
      workCenterId: 'deburr-bench',
      sequence: 30,
      runMinutesFormula: 'quantity * 1.5',
    },
    {
      key: 'coat',
      label: 'Powder coat and cure',
      workCenterId: 'powder-line',
      sequence: 40,
      condition: "finish == 'powder coat'",
      runMinutesFormula: 'quantity * (2 + part_m2 * 10)',
    },
    {
      key: 'pack',
      label: 'Inspect and pack',
      workCenterId: 'qc-pack',
      sequence: 50,
      runMinutesFormula: 'quantity * 0.5',
    },
  ],

  tooling: [
    // Parts with many bends need a fixture to hold the angles repeatable.
    { key: 'fixture', label: 'Bending fixture', toolingId: 'bend-fixture', condition: 'bends >= 4' },
  ],

  pricing: { method: 'MARGIN', rate: 0.3, overheadPct: 0.12, minCharge: 250, roundUnitPriceTo: 0.5 },
};
