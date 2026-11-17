import type { Material, WorkCenter } from '../../types';

/**
 * Primitives more than one starter uses. They are defined once so that two
 * starters naming the same thing agree on it exactly: installing both into a
 * tenant matches the second one onto the rows the first one created.
 *
 * Every rate in the starter library is a placeholder in AED, shaped like a
 * small UAE shop. Replace them with your own prices before trusting a quote.
 */

export const PVA_GLUE: Material = {
  id: 'glue-pva',
  sku: 'GLUE-PVA',
  name: 'PVA adhesive',
  uom: 'KG',
  costPerUom: 15.5,
};

export const LAMINATOR: WorkCenter = {
  id: 'laminator',
  name: 'Laminator',
  setupMinutes: 20,
  machineCostPerHour: 90,
  laborCostPerHour: 22,
  minChargeMinutes: 20,
  dailyCapacityMinutes: 480,
};

export const DIE_CUTTER: WorkCenter = {
  id: 'diecutter',
  name: 'Die-cutter',
  setupMinutes: 35,
  machineCostPerHour: 120,
  laborCostPerHour: 22,
  scrapPct: 0.03,
  minChargeMinutes: 30,
  dailyCapacityMinutes: 480,
};

export const QC_PACK: WorkCenter = {
  id: 'qc-pack',
  name: 'QC and packing',
  setupMinutes: 5,
  machineCostPerHour: 0,
  laborCostPerHour: 18,
  dailyCapacityMinutes: 960,
};

/** Two fitters and a van, out of the workshop. */
export const SITE_INSTALL: WorkCenter = {
  id: 'site-install',
  name: 'Site install crew',
  setupMinutes: 45,
  machineCostPerHour: 40,
  laborCostPerHour: 70,
  minChargeMinutes: 120,
  dailyCapacityMinutes: 480,
};
