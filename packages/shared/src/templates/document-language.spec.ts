import { describe, expect, it } from 'vitest';
import {
  arabicTaxLabel,
  DEFAULT_DOCUMENT_TEMPLATE_CONFIG,
  documentLabel,
  documentTemplateConfigSchema,
  localizedLabel,
  resolveDocumentLanguage,
  toArabicIndicDigits,
  updateCustomerSchema,
  createCustomerSchema,
} from '../index';

describe('document language', () => {
  it("prefers the customer's language, then the template's, then English", () => {
    expect(resolveDocumentLanguage('ar', 'bilingual')).toBe('ar');
    expect(resolveDocumentLanguage(null, 'bilingual')).toBe('bilingual');
    expect(resolveDocumentLanguage(undefined, undefined)).toBe('en');
  });

  it('defaults templates to English with Western digits, including old saved configs', () => {
    expect(DEFAULT_DOCUMENT_TEMPLATE_CONFIG.localization).toEqual({ language: 'en', digits: 'western' });
    const { localization: _omit, ...legacy } = DEFAULT_DOCUMENT_TEMPLATE_CONFIG;
    expect(documentTemplateConfigSchema.parse(legacy).localization.language).toBe('en');
  });

  it('prints UAE tax invoice wording in each language', () => {
    expect(documentLabel('taxInvoice', 'en')).toBe('TAX INVOICE');
    expect(documentLabel('taxInvoice', 'ar')).toBe('فاتورة ضريبية');
    expect(documentLabel('trn', 'bilingual')).toBe('TRN / رقم التسجيل الضريبي');
    expect(localizedLabel('Customer', 'العميل', 'bilingual', '\n')).toBe('Customer\nالعميل');
    expect(arabicTaxLabel('VAT 5%')).toBe('ضريبة القيمة المضافة 5%');
    expect(arabicTaxLabel('Tax (5%)')).toBe('ضريبة القيمة المضافة (5%)');
  });

  it('swaps only the digits for Arabic-Indic ones', () => {
    expect(toArabicIndicDigits('AED 1,234.50')).toBe('AED ١,٢٣٤.٥٠');
  });

  it('accepts a customer language and Arabic name, and clears them with null', () => {
    const created = createCustomerSchema.parse({
      companyName: 'Al Noor Sweets',
      companyNameAr: 'حلويات النور',
      documentLanguage: 'bilingual',
    });
    expect(created).toMatchObject({ companyNameAr: 'حلويات النور', documentLanguage: 'bilingual' });
    expect(updateCustomerSchema.parse({ documentLanguage: null, addressAr: '' })).toMatchObject({
      documentLanguage: null,
      addressAr: null,
    });
    expect(() => createCustomerSchema.parse({ companyName: 'X', documentLanguage: 'fr' })).toThrow();
  });
});
