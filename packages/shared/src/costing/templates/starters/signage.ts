import type { CostingCatalog, ProductTemplate } from '../../types';
import { SITE_INSTALL } from './shared-primitives';

/**
 * A cut acrylic backing panel with laser-cut 3D acrylic letters, optionally
 * lit from behind with LED modules, optionally installed on site. The panel
 * and the letters are cut at the same time on different machines.
 */
export const ACRYLIC_SIGN_CATALOG: CostingCatalog = {
  materials: {
    'acrylic-5-clear': {
      id: 'acrylic-5-clear',
      sku: 'ACR-5-CLR-2440X1220',
      name: 'Cast acrylic 5 mm clear, 2440 × 1220',
      uom: 'SHEET',
      costPerUom: 260,
      sheetWidthMm: 2440,
      sheetHeightMm: 1220,
      grain: 'NONE',
    },
    'acrylic-10-colour': {
      id: 'acrylic-10-colour',
      sku: 'ACR-10-COL-2440X1220',
      name: 'Cast acrylic 10 mm colour, 2440 × 1220',
      uom: 'SHEET',
      costPerUom: 520,
      sheetWidthMm: 2440,
      sheetHeightMm: 1220,
      grain: 'NONE',
    },
    'led-module': {
      id: 'led-module',
      sku: 'LED-MOD-12V',
      name: 'LED module 12 V, 3-chip',
      uom: 'EACH',
      costPerUom: 4.5,
      wastePct: 0.05,
    },
    'led-driver': {
      id: 'led-driver',
      sku: 'LED-DRV-12V-60W',
      name: 'LED driver 12 V 60 W, outdoor',
      uom: 'EACH',
      costPerUom: 85,
    },
    'standoff-set': {
      id: 'standoff-set',
      sku: 'STANDOFF-25-SS',
      name: 'Stainless stand-off fixing 25 mm',
      uom: 'EACH',
      costPerUom: 12,
    },
  },
  workCenters: {
    'cnc-router-sign': {
      id: 'cnc-router-sign',
      name: 'CNC router',
      setupMinutes: 15,
      machineCostPerHour: 120,
      laborCostPerHour: 25,
      minChargeMinutes: 30,
      dailyCapacityMinutes: 480,
    },
    'co2-laser': {
      id: 'co2-laser',
      name: 'CO2 laser cutter',
      setupMinutes: 10,
      machineCostPerHour: 80,
      laborCostPerHour: 25,
      scrapPct: 0.03,
      minChargeMinutes: 15,
      dailyCapacityMinutes: 480,
    },
    'sign-bench': {
      id: 'sign-bench',
      name: 'Sign finishing bench',
      setupMinutes: 10,
      machineCostPerHour: 0,
      laborCostPerHour: 22,
      dailyCapacityMinutes: 960,
    },
    'sign-electrical': {
      id: 'sign-electrical',
      name: 'Sign electrical assembly',
      setupMinutes: 10,
      machineCostPerHour: 0,
      laborCostPerHour: 30,
      minChargeMinutes: 30,
      dailyCapacityMinutes: 480,
    },
    [SITE_INSTALL.id]: SITE_INSTALL,
  },
  tooling: {},
};

export const ACRYLIC_SIGN_TEMPLATE: ProductTemplate = {
  id: 'acrylic-letter-sign',
  version: 1,
  name: 'Sign — acrylic panel with 3D letters',
  description:
    'Clear acrylic backing panel with laser-cut 10 mm acrylic letters, optional LED backlight and site install.',
  currency: 'AED',
  blankPreview: null,

  parameters: [
    { key: 'width_mm', label: 'Panel width', type: 'NUMBER', unit: 'mm', defaultValue: 1200, min: 200, max: 2400 },
    { key: 'height_mm', label: 'Panel height', type: 'NUMBER', unit: 'mm', defaultValue: 400, min: 100, max: 1200 },
    { key: 'letters', label: 'Number of letters', type: 'NUMBER', defaultValue: 8, min: 1, max: 60 },
    { key: 'letter_h_mm', label: 'Letter height', type: 'NUMBER', unit: 'mm', defaultValue: 200, min: 30, max: 1000 },
    { key: 'lit', label: 'LED backlit', type: 'BOOLEAN', defaultValue: false },
    { key: 'install', label: 'Site install', type: 'BOOLEAN', defaultValue: false },
  ],

  derived: [
    // An average letter is about 0.8 of its height wide; nest a box that size.
    { key: 'letter_w_mm', unit: 'mm', formula: 'round(letter_h_mm * 0.8)' },
    { key: 'panel_perimeter_m', unit: 'm', formula: '2 * (width_mm + height_mm) / 1000' },
    { key: 'fixings', formula: 'width_mm > 1500 ? 6 : 4' },
  ],

  materials: [
    {
      key: 'panel',
      label: 'Backing panel',
      materialId: 'acrylic-5-clear',
      mode: 'SHEET_NEST',
      blankWidthFormula: 'width_mm',
      blankHeightFormula: 'height_mm',
      marginMm: 5,
    },
    {
      key: 'letter_stock',
      label: 'Letter acrylic',
      materialId: 'acrylic-10-colour',
      mode: 'FIXED',
      // Letters are offcut-friendly: buy the sheet area they need, with a
      // third again for the shapes, rounded up to whole sheets.
      quantityFormula: 'ceil(quantity * letters * letter_w_mm * letter_h_mm * 1.33 / (2440 * 1220))',
    },
    {
      key: 'leds',
      label: 'LED modules',
      materialId: 'led-module',
      mode: 'PER_UNIT',
      condition: 'lit',
      quantityFormula: 'ceil(letters * letter_h_mm / 60)',
    },
    {
      key: 'driver',
      label: 'LED driver',
      materialId: 'led-driver',
      mode: 'PER_UNIT',
      condition: 'lit',
      quantityFormula: '1',
    },
    {
      key: 'standoffs',
      label: 'Stand-off fixings',
      materialId: 'standoff-set',
      mode: 'PER_UNIT',
      quantityFormula: 'fixings',
    },
  ],

  operations: [
    {
      key: 'route_panel',
      label: 'Route panel and drill fixings',
      workCenterId: 'cnc-router-sign',
      sequence: 10,
      branch: 'panel',
      runMinutesFormula: 'quantity * (panel_perimeter_m * 2 + fixings * 1.5)',
    },
    {
      key: 'laser_letters',
      label: 'Laser-cut letters',
      workCenterId: 'co2-laser',
      sequence: 10,
      branch: 'letters',
      runMinutesFormula: 'quantity * letters * letter_h_mm / 200 * 1.5',
    },
    {
      key: 'finish',
      label: 'Flame-polish edges and fix letters',
      workCenterId: 'sign-bench',
      sequence: 20,
      runMinutesFormula: 'quantity * (15 + letters * 4)',
    },
    {
      key: 'wire',
      label: 'Fit and wire LEDs',
      workCenterId: 'sign-electrical',
      sequence: 30,
      condition: 'lit',
      runMinutesFormula: 'quantity * (20 + letters * 6)',
    },
    {
      key: 'install',
      label: 'Install on site',
      workCenterId: 'site-install',
      sequence: 40,
      condition: 'install',
      runMinutesFormula: 'quantity * 90',
    },
  ],

  pricing: { method: 'MARGIN', rate: 0.4, overheadPct: 0.15, minCharge: 750, roundUnitPriceTo: 5 },
};
