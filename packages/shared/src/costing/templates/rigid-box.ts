import type { CostingCatalog, ProductTemplate } from '../types';

/**
 * A worked example: a two-piece rigid (setup) gift box — a greyboard base and
 * a telescoping lid, each wrapped in printed art paper.
 *
 * The rates below are placeholders shaped like a real small packaging shop.
 * Replace them with the actual sheet prices and machine rates before trusting
 * a number; the point of this file is the *shape* of the model, not the values.
 */

export const SAMPLE_CATALOG: CostingCatalog = {
  materials: {
    'greyboard-2mm': {
      id: 'greyboard-2mm',
      sku: 'GB-2.0-1000700',
      name: 'Greyboard 2.0mm',
      uom: 'SHEET',
      costPerUom: 1.85,
      sheetWidthMm: 1000,
      sheetHeightMm: 700,
      grain: 'NONE',
      wastePct: 0.03,
    },
    'artpaper-157': {
      id: 'artpaper-157',
      sku: 'AP-157-720X1020',
      name: 'Art paper 157gsm',
      uom: 'SHEET',
      costPerUom: 0.42,
      sheetWidthMm: 720,
      sheetHeightMm: 1020,
      // Wrapping against the grain cracks the fold, so these cannot rotate.
      grain: 'LENGTH',
      wastePct: 0.05,
    },
    'glue-pva': {
      id: 'glue-pva',
      name: 'PVA adhesive',
      uom: 'KG',
      costPerUom: 4.2,
    },
    'magnet-10mm': {
      id: 'magnet-10mm',
      name: 'Neodymium magnet 10mm',
      uom: 'EACH',
      costPerUom: 0.09,
    },
    'ribbon-25mm': {
      id: 'ribbon-25mm',
      name: 'Satin ribbon 25mm',
      uom: 'METRE',
      costPerUom: 0.35,
      wastePct: 0.08,
    },
  },

  workCenters: {
    'press-offset': {
      id: 'press-offset',
      name: 'Offset press',
      setupMinutes: 45,
      machineCostPerHour: 85,
      laborCostPerHour: 22,
      scrapPct: 0.02,
      minChargeMinutes: 30,
      dailyCapacityMinutes: 480,
    },
    laminator: {
      id: 'laminator',
      name: 'Laminator',
      setupMinutes: 20,
      machineCostPerHour: 40,
      laborCostPerHour: 18,
      minChargeMinutes: 20,
      dailyCapacityMinutes: 480,
    },
    diecutter: {
      id: 'diecutter',
      name: 'Die-cutter',
      setupMinutes: 35,
      machineCostPerHour: 55,
      laborCostPerHour: 20,
      scrapPct: 0.03,
      minChargeMinutes: 30,
      dailyCapacityMinutes: 480,
    },
    'wrap-bench': {
      id: 'wrap-bench',
      name: 'Wrapping bench',
      setupMinutes: 10,
      machineCostPerHour: 0,
      laborCostPerHour: 16,
      // Four benches, so four times the daily minutes of a single machine.
      dailyCapacityMinutes: 1920,
    },
    assembly: {
      id: 'assembly',
      name: 'Assembly',
      setupMinutes: 5,
      machineCostPerHour: 0,
      laborCostPerHour: 15,
      dailyCapacityMinutes: 960,
    },
    'qc-pack': {
      id: 'qc-pack',
      name: 'QC and packing',
      setupMinutes: 5,
      machineCostPerHour: 0,
      laborCostPerHour: 14,
      dailyCapacityMinutes: 960,
    },
  },

  tooling: {
    'cutting-die': {
      id: 'cutting-die',
      name: 'Cutting die',
      cost: 180,
      amortize: true,
      reusable: true,
    },
  },
};

export const RIGID_BOX_TEMPLATE: ProductTemplate = {
  id: 'rigid-box-2pc',
  version: 1,
  name: 'Rigid gift box — base and lid',
  description:
    'Two-piece rigid box: greyboard base and telescoping lid, wrapped in printed art paper.',
  currency: 'USD',

  parameters: [
    { key: 'length_mm', label: 'Length', type: 'NUMBER', unit: 'mm', min: 40, max: 600 },
    { key: 'width_mm', label: 'Width', type: 'NUMBER', unit: 'mm', min: 40, max: 600 },
    { key: 'height_mm', label: 'Height', type: 'NUMBER', unit: 'mm', min: 15, max: 400 },
    {
      key: 'board_thickness_mm',
      label: 'Board thickness',
      type: 'NUMBER',
      unit: 'mm',
      defaultValue: 2,
      min: 1,
      max: 4,
    },
    {
      key: 'turn_in_mm',
      label: 'Wrap turn-in',
      type: 'NUMBER',
      unit: 'mm',
      defaultValue: 15,
      min: 8,
      max: 30,
      help: 'Paper folded over the board edge on every side.',
    },
    {
      key: 'finish',
      label: 'Lamination',
      type: 'ENUM',
      options: ['none', 'matt', 'gloss', 'soft-touch'],
      defaultValue: 'matt',
    },
    { key: 'magnet', label: 'Magnetic closure', type: 'BOOLEAN', defaultValue: false },
    { key: 'ribbon', label: 'Ribbon pull', type: 'BOOLEAN', defaultValue: false },
  ],

  derived: [
    {
      key: 'lid_depth_mm',
      label: 'Lid depth',
      unit: 'mm',
      formula: 'max(25, round(height_mm * 0.3))',
    },
    // A rigid base is cut as a scored net: the floor plus four walls, with
    // board thickness eaten at each fold.
    {
      key: 'base_blank_w',
      formula: 'width_mm + 2 * height_mm + 4 * board_thickness_mm',
      unit: 'mm',
    },
    {
      key: 'base_blank_h',
      formula: 'length_mm + 2 * height_mm + 4 * board_thickness_mm',
      unit: 'mm',
    },
    // The lid must clear the base, hence 6× thickness rather than 4×.
    {
      key: 'lid_blank_w',
      formula: 'width_mm + 2 * lid_depth_mm + 6 * board_thickness_mm',
      unit: 'mm',
    },
    {
      key: 'lid_blank_h',
      formula: 'length_mm + 2 * lid_depth_mm + 6 * board_thickness_mm',
      unit: 'mm',
    },
    { key: 'base_wrap_w', formula: 'base_blank_w + 2 * turn_in_mm', unit: 'mm' },
    { key: 'base_wrap_h', formula: 'base_blank_h + 2 * turn_in_mm', unit: 'mm' },
    { key: 'lid_wrap_w', formula: 'lid_blank_w + 2 * turn_in_mm', unit: 'mm' },
    { key: 'lid_wrap_h', formula: 'lid_blank_h + 2 * turn_in_mm', unit: 'mm' },
    {
      key: 'glued_area_m2',
      label: 'Glued area per box',
      unit: 'm²',
      formula: '(base_wrap_w * base_wrap_h + lid_wrap_w * lid_wrap_h) / 1000000',
    },
  ],

  materials: [
    {
      key: 'board_base',
      label: 'Greyboard — base',
      materialId: 'greyboard-2mm',
      mode: 'SHEET_NEST',
      blankWidthFormula: 'base_blank_w',
      blankHeightFormula: 'base_blank_h',
      gutterMm: 3,
    },
    {
      key: 'board_lid',
      label: 'Greyboard — lid',
      materialId: 'greyboard-2mm',
      mode: 'SHEET_NEST',
      blankWidthFormula: 'lid_blank_w',
      blankHeightFormula: 'lid_blank_h',
      gutterMm: 3,
    },
    {
      key: 'wrap_base',
      label: 'Printed wrap — base',
      materialId: 'artpaper-157',
      mode: 'SHEET_NEST',
      blankWidthFormula: 'base_wrap_w',
      blankHeightFormula: 'base_wrap_h',
      gutterMm: 4,
    },
    {
      key: 'wrap_lid',
      label: 'Printed wrap — lid',
      materialId: 'artpaper-157',
      mode: 'SHEET_NEST',
      blankWidthFormula: 'lid_wrap_w',
      blankHeightFormula: 'lid_wrap_h',
      gutterMm: 4,
    },
    {
      key: 'glue',
      label: 'Adhesive',
      materialId: 'glue-pva',
      mode: 'PER_UNIT',
      quantityFormula: 'glued_area_m2 * 0.03',
    },
    {
      key: 'magnets',
      label: 'Magnets',
      materialId: 'magnet-10mm',
      mode: 'PER_UNIT',
      condition: 'magnet',
      quantityFormula: '2',
    },
    {
      key: 'ribbon',
      label: 'Ribbon pull',
      materialId: 'ribbon-25mm',
      mode: 'PER_UNIT',
      condition: 'ribbon',
      quantityFormula: '(length_mm + width_mm) * 2 / 1000 + 0.3',
    },
  ],

  operations: [
    {
      key: 'print',
      label: 'Print wrap sheets',
      workCenterId: 'press-offset',
      sequence: 10,
      branch: 'wrap-prep',
      runMinutesFormula: '(wrap_base_units + wrap_lid_units) / 1200 * 60',
    },
    {
      key: 'laminate',
      label: 'Laminate wrap',
      workCenterId: 'laminator',
      sequence: 20,
      branch: 'wrap-prep',
      condition: "finish != 'none'",
      runMinutesFormula: '(wrap_base_units + wrap_lid_units) / 2000 * 60',
    },
    {
      key: 'diecut',
      label: 'Die-cut and crease board',
      workCenterId: 'diecutter',
      sequence: 30,
      // Board cutting does not wait on the printed wrap, so it runs alongside
      // the print/laminate branch rather than after it.
      branch: 'board-prep',
      runMinutesFormula: '(board_base_units + board_lid_units) / 900 * 60',
    },
    {
      key: 'wrap',
      label: 'Hand-wrap base and lid',
      workCenterId: 'wrap-bench',
      sequence: 40,
      runMinutesFormula: 'quantity * 95 / 60',
    },
    {
      key: 'magnet_fit',
      label: 'Fit magnets',
      workCenterId: 'assembly',
      sequence: 50,
      condition: 'magnet',
      runMinutesFormula: 'quantity * 12 / 60',
    },
    {
      key: 'ribbon_fit',
      label: 'Fit ribbon pull',
      workCenterId: 'assembly',
      sequence: 55,
      condition: 'ribbon',
      runMinutesFormula: 'quantity * 8 / 60',
    },
    {
      key: 'qc_pack',
      label: 'QC and pack',
      workCenterId: 'qc-pack',
      sequence: 60,
      runMinutesFormula: 'quantity * 20 / 60',
    },
  ],

  tooling: [
    {
      key: 'die',
      label: 'Cutting die',
      toolingId: 'cutting-die',
    },
  ],

  pricing: {
    method: 'MARGIN',
    rate: 0.35,
    overheadPct: 0.12,
    roundUnitPriceTo: 0.05,
  },
};

/** The quantities this trade habitually quotes at. */
export const DEFAULT_PRICE_BREAKS = [100, 250, 500, 1000, 2500];
