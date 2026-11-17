import type { CostingCatalog, ProductTemplate } from '../../types';
import { QC_PACK, SITE_INSTALL } from './shared-primitives';

/**
 * A flat-pack-style cabinet carcass with doors: panels nested on a CNC
 * router, edge-banded or sprayed, assembled on the bench, optionally fitted
 * on site. Board is bought by area at a nesting yield rather than nested
 * blank by blank, because one cabinet is a dozen different panel sizes.
 */
const SHEET_M2 = 2.44 * 1.22;

export const CABINET_CATALOG: CostingCatalog = {
  materials: {
    'mfc-18-white': {
      id: 'mfc-18-white',
      sku: 'MFC-18-WHT-2440X1220',
      name: 'Melamine MFC 18 mm white, 2440 × 1220',
      uom: 'SHEET',
      costPerUom: 135,
      sheetWidthMm: 2440,
      sheetHeightMm: 1220,
      grain: 'NONE',
    },
    'mdf-18-mr': {
      id: 'mdf-18-mr',
      sku: 'MDF-18-MR-2440X1220',
      name: 'Moisture-resistant MDF 18 mm, 2440 × 1220',
      uom: 'SHEET',
      costPerUom: 120,
      sheetWidthMm: 2440,
      sheetHeightMm: 1220,
      grain: 'NONE',
    },
    'hdf-6-back': {
      id: 'hdf-6-back',
      sku: 'HDF-6-2440X1220',
      name: 'HDF back panel 6 mm, 2440 × 1220',
      uom: 'SHEET',
      costPerUom: 45,
      sheetWidthMm: 2440,
      sheetHeightMm: 1220,
      grain: 'NONE',
    },
    'edge-pvc-22': {
      id: 'edge-pvc-22',
      sku: 'EDGE-PVC-22X1',
      name: 'PVC edge band 22 × 1 mm',
      uom: 'METRE',
      costPerUom: 0.9,
      wastePct: 0.1,
    },
    'pu-lacquer': {
      id: 'pu-lacquer',
      sku: 'PU-PRIMER-LACQUER',
      name: 'PU primer and lacquer',
      uom: 'KG',
      costPerUom: 38,
      wastePct: 0.2,
    },
    'hinge-soft-close': {
      id: 'hinge-soft-close',
      sku: 'HINGE-SC-110',
      name: 'Soft-close concealed hinge 110°',
      uom: 'EACH',
      costPerUom: 9.5,
    },
    'handle-128': {
      id: 'handle-128',
      sku: 'HANDLE-128',
      name: 'Bar handle 128 mm',
      uom: 'EACH',
      costPerUom: 14,
    },
    'cabinet-fixings': {
      id: 'cabinet-fixings',
      sku: 'FIX-KIT-CAB',
      name: 'Cabinet fixings kit (cams, dowels, shelf pins, legs)',
      uom: 'EACH',
      costPerUom: 22,
    },
  },
  workCenters: {
    'cnc-nesting': {
      id: 'cnc-nesting',
      name: 'CNC nesting router',
      setupMinutes: 20,
      machineCostPerHour: 150,
      laborCostPerHour: 25,
      scrapPct: 0.02,
      minChargeMinutes: 30,
      dailyCapacityMinutes: 480,
    },
    'edge-bander': {
      id: 'edge-bander',
      name: 'Edge bander',
      setupMinutes: 15,
      machineCostPerHour: 70,
      laborCostPerHour: 22,
      minChargeMinutes: 15,
      dailyCapacityMinutes: 480,
    },
    'spray-booth': {
      id: 'spray-booth',
      name: 'Spray booth',
      setupMinutes: 30,
      machineCostPerHour: 60,
      laborCostPerHour: 28,
      minChargeMinutes: 60,
      dailyCapacityMinutes: 480,
    },
    'joinery-bench': {
      id: 'joinery-bench',
      name: 'Joinery bench',
      setupMinutes: 10,
      machineCostPerHour: 5,
      laborCostPerHour: 25,
      dailyCapacityMinutes: 1440,
    },
    [QC_PACK.id]: QC_PACK,
    [SITE_INSTALL.id]: SITE_INSTALL,
  },
  tooling: {},
};

export const CABINET_TEMPLATE: ProductTemplate = {
  id: 'cabinet-carcass',
  version: 1,
  name: 'Cabinet — carcass with doors',
  description:
    'Base or wall cabinet in MFC or sprayed MDF: CNC-cut panels, edge band or lacquer, hardware, bench assembly, optional site install.',
  currency: 'AED',
  blankPreview: null,

  parameters: [
    { key: 'width_mm', label: 'Width', type: 'NUMBER', unit: 'mm', defaultValue: 600, min: 200, max: 1200 },
    { key: 'height_mm', label: 'Height', type: 'NUMBER', unit: 'mm', defaultValue: 720, min: 200, max: 2400 },
    { key: 'depth_mm', label: 'Depth', type: 'NUMBER', unit: 'mm', defaultValue: 560, min: 250, max: 700 },
    { key: 'shelves', label: 'Shelves', type: 'NUMBER', defaultValue: 1, min: 0, max: 8 },
    { key: 'doors', label: 'Doors', type: 'NUMBER', defaultValue: 2, min: 0, max: 4 },
    {
      key: 'board',
      label: 'Board',
      type: 'ENUM',
      options: ['white melamine', 'sprayed MDF'],
      defaultValue: 'white melamine',
    },
    { key: 'install', label: 'Site install', type: 'BOOLEAN', defaultValue: false },
  ],

  derived: [
    // Two sides, top and bottom, and the shelves.
    {
      key: 'carcass_m2',
      unit: 'm²',
      formula: '(2 * height_mm * depth_mm + (2 + shelves) * width_mm * depth_mm) / 1000000',
    },
    { key: 'door_m2', unit: 'm²', formula: 'doors > 0 ? width_mm * height_mm / 1000000 : 0' },
    { key: 'back_m2', unit: 'm²', formula: 'width_mm * height_mm / 1000000' },
    // Front edges of the carcass and shelves, and all four edges of every door.
    {
      key: 'edge_m',
      unit: 'm',
      formula:
        '(2 * height_mm + (2 + shelves) * width_mm) / 1000 + (doors > 0 ? 2 * doors * height_mm + 2 * width_mm : 0) / 1000',
    },
    { key: 'board_yield', label: 'Nesting yield', formula: '0.82' },
    { key: 'hinges', formula: 'doors * (height_mm > 900 ? 3 : 2)' },
  ],

  materials: [
    {
      key: 'mfc',
      label: 'Carcass and door board — melamine',
      materialId: 'mfc-18-white',
      mode: 'PER_UNIT',
      condition: "board == 'white melamine'",
      quantityFormula: `(carcass_m2 + door_m2) / ${SHEET_M2.toFixed(4)} / board_yield`,
    },
    {
      key: 'mdf',
      label: 'Carcass and door board — MDF',
      materialId: 'mdf-18-mr',
      mode: 'PER_UNIT',
      condition: "board == 'sprayed MDF'",
      quantityFormula: `(carcass_m2 + door_m2) / ${SHEET_M2.toFixed(4)} / board_yield`,
    },
    {
      key: 'back',
      label: 'Back panel',
      materialId: 'hdf-6-back',
      mode: 'PER_UNIT',
      quantityFormula: `back_m2 / ${SHEET_M2.toFixed(4)} / board_yield`,
    },
    {
      key: 'edge',
      label: 'Edge band',
      materialId: 'edge-pvc-22',
      mode: 'PER_UNIT',
      condition: "board == 'white melamine'",
      quantityFormula: 'edge_m',
    },
    {
      key: 'lacquer',
      label: 'Primer and lacquer',
      materialId: 'pu-lacquer',
      mode: 'PER_UNIT',
      condition: "board == 'sprayed MDF'",
      // Doors both faces, the carcass front edges and outer sides once.
      quantityFormula: '(door_m2 * 2 + carcass_m2 * 0.4) * 0.3',
    },
    {
      key: 'hinge',
      label: 'Hinges',
      materialId: 'hinge-soft-close',
      mode: 'PER_UNIT',
      condition: 'doors > 0',
      quantityFormula: 'hinges',
    },
    {
      key: 'handle',
      label: 'Handles',
      materialId: 'handle-128',
      mode: 'PER_UNIT',
      condition: 'doors > 0',
      quantityFormula: 'doors',
    },
    {
      key: 'fixings',
      label: 'Fixings kit',
      materialId: 'cabinet-fixings',
      mode: 'PER_UNIT',
      quantityFormula: '1',
    },
  ],

  operations: [
    {
      key: 'cnc',
      label: 'Nest and cut panels',
      workCenterId: 'cnc-nesting',
      sequence: 10,
      runMinutesFormula: 'quantity * (carcass_m2 + door_m2 + back_m2) * 4',
    },
    {
      key: 'edgeband',
      label: 'Edge band',
      workCenterId: 'edge-bander',
      sequence: 20,
      condition: "board == 'white melamine'",
      runMinutesFormula: 'quantity * edge_m * 0.5',
    },
    {
      key: 'spray',
      label: 'Prime, sand and lacquer',
      workCenterId: 'spray-booth',
      sequence: 20,
      condition: "board == 'sprayed MDF'",
      runMinutesFormula: 'quantity * (door_m2 * 2 + carcass_m2 * 0.4) * 25',
    },
    {
      key: 'assemble',
      label: 'Assemble and fit hardware',
      workCenterId: 'joinery-bench',
      sequence: 30,
      runMinutesFormula: 'quantity * (40 + doors * 10 + shelves * 5)',
    },
    {
      key: 'pack',
      label: 'Inspect and wrap',
      workCenterId: 'qc-pack',
      sequence: 40,
      runMinutesFormula: 'quantity * 10',
    },
    {
      key: 'install',
      label: 'Install on site',
      workCenterId: 'site-install',
      sequence: 50,
      condition: 'install',
      runMinutesFormula: 'quantity * 45',
    },
  ],

  pricing: { method: 'MARGIN', rate: 0.35, overheadPct: 0.15, minCharge: 1500, roundUnitPriceTo: 5 },
};
