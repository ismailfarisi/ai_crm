import type { CostingCatalog, ProductTemplate } from '../../types';
import { DIE_CUTTER, LAMINATOR, QC_PACK } from './shared-primitives';

/**
 * Self-adhesive labels printed digitally on SRA3 sheets, kiss-cut on a
 * plotter, or on a flatbed die-cutter when the shape needs a cutting die.
 */
export const LABEL_RUN_CATALOG: CostingCatalog = {
  materials: {
    'sa-paper-sra3': {
      id: 'sa-paper-sra3',
      sku: 'SA-PAPER-SRA3',
      name: 'Self-adhesive gloss paper, SRA3 450 × 320',
      uom: 'SHEET',
      costPerUom: 1.1,
      sheetWidthMm: 450,
      sheetHeightMm: 320,
      grain: 'NONE',
      wastePct: 0.02,
    },
    'sa-pp-sra3': {
      id: 'sa-pp-sra3',
      sku: 'SA-PP-CLEAR-SRA3',
      name: 'Self-adhesive clear polypropylene, SRA3 450 × 320',
      uom: 'SHEET',
      costPerUom: 2.4,
      sheetWidthMm: 450,
      sheetHeightMm: 320,
      grain: 'NONE',
      wastePct: 0.02,
    },
    'lam-film-330': {
      id: 'lam-film-330',
      sku: 'LAM-FILM-330',
      name: 'Laminating film, 330 mm roll',
      uom: 'METRE',
      costPerUom: 0.6,
      wastePct: 0.05,
    },
  },
  workCenters: {
    'digital-press': {
      id: 'digital-press',
      name: 'Digital press (SRA3)',
      setupMinutes: 15,
      machineCostPerHour: 110,
      laborCostPerHour: 22,
      scrapPct: 0.03,
      minChargeMinutes: 15,
      dailyCapacityMinutes: 480,
    },
    [LAMINATOR.id]: LAMINATOR,
    'label-plotter': {
      id: 'label-plotter',
      name: 'Label cutting plotter',
      setupMinutes: 10,
      machineCostPerHour: 45,
      laborCostPerHour: 22,
      minChargeMinutes: 15,
      dailyCapacityMinutes: 480,
    },
    [DIE_CUTTER.id]: DIE_CUTTER,
    [QC_PACK.id]: QC_PACK,
  },
  tooling: {
    'label-die': {
      id: 'label-die',
      name: 'Flexible magnetic cutting die',
      cost: 650,
      amortize: true,
      reusable: true,
    },
  },
};

export const LABEL_RUN_TEMPLATE: ProductTemplate = {
  id: 'label-run',
  version: 1,
  name: 'Labels — digital sheet run',
  description:
    'Self-adhesive labels printed four colour on SRA3, optionally laminated, cut on a plotter or with a die.',
  currency: 'AED',
  blankPreview: null,

  parameters: [
    { key: 'label_w_mm', label: 'Label width', type: 'NUMBER', unit: 'mm', defaultValue: 60, min: 15, max: 300 },
    { key: 'label_h_mm', label: 'Label height', type: 'NUMBER', unit: 'mm', defaultValue: 40, min: 15, max: 420 },
    {
      key: 'stock',
      label: 'Stock',
      type: 'ENUM',
      options: ['gloss paper', 'clear PP'],
      defaultValue: 'gloss paper',
    },
    {
      key: 'finish',
      label: 'Finish',
      type: 'ENUM',
      options: ['none', 'gloss laminate', 'matt laminate'],
      defaultValue: 'none',
    },
    {
      key: 'shape',
      label: 'Shape',
      type: 'ENUM',
      options: ['rectangle', 'custom die'],
      defaultValue: 'rectangle',
      help: 'Custom shapes run on the die-cutter and need a cutting die.',
    },
  ],

  materials: [
    {
      key: 'paper',
      label: 'Label stock — paper',
      materialId: 'sa-paper-sra3',
      mode: 'SHEET_NEST',
      condition: "stock == 'gloss paper'",
      blankWidthFormula: 'label_w_mm',
      blankHeightFormula: 'label_h_mm',
      gutterMm: 3,
    },
    {
      key: 'pp',
      label: 'Label stock — clear PP',
      materialId: 'sa-pp-sra3',
      mode: 'SHEET_NEST',
      condition: "stock == 'clear PP'",
      blankWidthFormula: 'label_w_mm',
      blankHeightFormula: 'label_h_mm',
      gutterMm: 3,
    },
    {
      key: 'film',
      label: 'Laminating film',
      materialId: 'lam-film-330',
      mode: 'FIXED',
      condition: "finish != 'none'",
      // One 450 mm pull of film per sheet.
      quantityFormula: '(paper_units + pp_units) * 0.45',
    },
  ],

  operations: [
    {
      key: 'print',
      label: 'Print four colour',
      workCenterId: 'digital-press',
      sequence: 10,
      runMinutesFormula: '(paper_units + pp_units) / 25',
    },
    {
      key: 'laminate',
      label: 'Laminate',
      workCenterId: 'laminator',
      sequence: 20,
      condition: "finish != 'none'",
      setupMinutesFormula: '10',
      runMinutesFormula: '(paper_units + pp_units) / 15',
    },
    {
      key: 'kiss_cut',
      label: 'Kiss-cut on the plotter',
      workCenterId: 'label-plotter',
      sequence: 30,
      condition: "shape == 'rectangle'",
      runMinutesFormula: '(paper_units + pp_units) * 0.25',
    },
    {
      key: 'die_cut',
      label: 'Die-cut custom shape',
      workCenterId: 'diecutter',
      sequence: 30,
      condition: "shape == 'custom die'",
      runMinutesFormula: '(paper_units + pp_units) / 20',
    },
    {
      key: 'pack',
      label: 'Count and pack',
      workCenterId: 'qc-pack',
      sequence: 40,
      runMinutesFormula: 'quantity / 1000 * 10',
    },
  ],

  tooling: [
    { key: 'die', label: 'Cutting die', toolingId: 'label-die', condition: "shape == 'custom die'" },
  ],

  pricing: { method: 'MARGIN', rate: 0.35, overheadPct: 0.1, minCharge: 150, roundUnitPriceTo: 0.001 },
};
