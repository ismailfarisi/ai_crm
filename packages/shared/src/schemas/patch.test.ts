import { describe, expect, it } from 'vitest';
import {
  updateCatalogItemSchema,
  updateMaterialSchema,
  updateToolingSchema,
  updateWorkCenterSchema,
} from './catalog';

describe('catalog patches', () => {
  it('carry only the fields that were sent — no defaults written over saved values', () => {
    expect(updateWorkCenterSchema.parse({ scrapPct: 0.1 })).toEqual({ scrapPct: 0.1 });
    expect(updateMaterialSchema.parse({ costPerUom: 2.5 })).toEqual({ costPerUom: 2.5 });
    expect(updateToolingSchema.parse({ cost: 900 })).toEqual({ cost: 900 });
    expect(updateCatalogItemSchema.parse({ listPrice: 12 })).toEqual({ listPrice: 12 });
  });

  it('still validates and coerces what was sent', () => {
    expect(updateWorkCenterSchema.parse({ setupMinutes: '15' })).toEqual({ setupMinutes: 15 });
    expect(updateWorkCenterSchema.safeParse({ scrapPct: 2 }).success).toBe(false);
  });

  it('keeps the sheet rule when a patch makes a material a sheet', () => {
    expect(updateMaterialSchema.safeParse({ uom: 'SHEET' }).success).toBe(false);
    expect(updateMaterialSchema.safeParse({ uom: 'SHEET', sheetWidthMm: 700, sheetHeightMm: 1000 }).success).toBe(true);
  });
});
