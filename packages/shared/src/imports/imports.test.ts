import { describe, expect, it } from 'vitest';
import {
  IMPORT_DEFINITIONS,
  importKeys,
  importTemplate,
  normaliseHeader,
  readRow,
  suggestMapping,
  validateImportRow,
} from './index';

describe('header matching', () => {
  it('ignores case, spacing and punctuation', () => {
    expect(normaliseHeader(' Company_Name ')).toBe('companyname');
    expect(normaliseHeader('E-mail')).toBe('email');
    expect(normaliseHeader('Waste %')).toBe('wastepct');
  });

  it('maps the headers people actually use', () => {
    const mapping = suggestMapping('customers', ['Customer Name', 'E-mail', 'Mobile', 'TRN', 'Notes']);
    expect(mapping.companyName).toBe(0);
    expect(mapping.email).toBe(1);
    expect(mapping.phone).toBe(2);
    expect(mapping.taxId).toBe(3);
    expect(mapping.notes).toBe(4);
    expect(mapping.city).toBeNull();
  });

  it('prefers an exact name over an alias and uses each column once', () => {
    // "Description" is an alias for a material's name, but "Name" is exact.
    const mapping = suggestMapping('materials', ['Description', 'Name', 'Unit', 'Cost']);
    expect(mapping.name).toBe(1);
    expect(mapping.uom).toBe(2);
    expect(mapping.costPerUom).toBe(3);
  });

  it('reads its own template back', () => {
    for (const definition of Object.values(IMPORT_DEFINITIONS)) {
      const { headers } = importTemplate(definition.entity);
      const mapping = suggestMapping(definition.entity, headers);
      definition.fields.forEach((field, i) => expect(mapping[field.key]).toBe(i));
    }
  });
});

describe('row validation uses the form schemas', () => {
  it('applies the customer form rules, including the UAE TRN', () => {
    const bad = validateImportRow('customers', { companyName: 'Al Noor', country: 'UAE', taxId: '1234' });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.issues[0]).toMatchObject({ field: 'taxId', message: 'A UAE TRN is 15 digits' });

    const good = validateImportRow('customers', {
      companyName: 'Al Noor',
      country: 'United Arab Emirates',
      email: 'Orders@AlNoor.ae',
      emirate: 'sharjah',
      paymentTermsDays: '30',
    });
    expect(good.ok).toBe(true);
    if (good.ok) {
      expect(good.value).toMatchObject({ country: 'AE', email: 'orders@alnoor.ae', emirate: 'SHJ', paymentTermsDays: 30 });
    }
  });

  it('names a missing required column', () => {
    const result = validateImportRow('contacts', { firstName: 'Fatima' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues).toContainEqual({ field: 'lastName', message: 'Required' });
  });

  it('lets blank cells fall back to the form defaults', () => {
    const result = validateImportRow('work-centres', { name: 'Die cutter' });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toMatchObject({ setupMinutes: 0, dailyCapacityMinutes: 480, isActive: true });
  });

  it('converts spreadsheet spellings of numbers, percentages, booleans and units', () => {
    const result = validateImportRow('materials', {
      name: 'Greyboard',
      uom: 'Sheet',
      costPerUom: 'AED 1,250.50',
      sheetWidthMm: '1000',
      sheetHeightMm: '700',
      wastePct: '5%',
      isActive: 'No',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toMatchObject({ uom: 'SHEET', costPerUom: 1250.5, wastePct: 0.05, isActive: false });
    }
  });

  it('says what a blank or unknown unit should be', () => {
    const blank = validateImportRow('materials', { name: 'Vinyl', uom: '', costPerUom: '1' });
    const odd = validateImportRow('materials', { name: 'Vinyl', uom: 'roll', costPerUom: '1' });
    if (!blank.ok) expect(blank.issues).toContainEqual({ field: 'uom', message: 'Required' });
    if (!odd.ok) expect(odd.issues).toContainEqual({ field: 'uom', message: 'Use Sheet, Metre, KG or Each' });
    expect(blank.ok || odd.ok).toBe(false);
  });

  it('keeps the cross-field sheet rule', () => {
    const result = validateImportRow('materials', { name: 'Greyboard', uom: 'sheet', costPerUom: '4' });
    expect(result.ok).toBe(false);
  });

  it('reads cells through the mapping and drops blanks', () => {
    const values = readRow('products', ['BOX-1', '', '12.5'], { sku: 0, name: 1, listPrice: 2 });
    expect(values).toEqual({ sku: 'BOX-1', listPrice: '12.5' });
  });
});

describe('natural keys', () => {
  it('matches people by email first, then name', () => {
    expect(importKeys('customers', { email: 'A@x.ae', companyName: 'Al Noor' })).toEqual(['email:a@x.ae', 'name:al noor']);
    expect(importKeys('contacts', { email: null, firstName: 'Fatima', lastName: 'Khan' })).toEqual(['name:fatima khan']);
    expect(importKeys('contacts', { email: 'f@x.ae', firstName: 'Fatima', lastName: 'Khan' })).toEqual(['email:f@x.ae']);
  });

  it('matches stock records by SKU', () => {
    expect(importKeys('products', { sku: 'Box-1' })).toEqual(['sku:box-1']);
    expect(importKeys('materials', { sku: null, name: 'Greyboard' })).toEqual(['name:greyboard']);
  });
});
