import {
  DEFAULT_DOCUMENT_TEMPLATE_CONFIG,
  UniversalDocumentData,
} from '@saas/shared';
import { localizeDocument } from './document-localization.service';

const base: UniversalDocumentData = {
  type: 'QUOTE',
  number: 'Q-1',
  issuedAt: '2026-11-17',
  currency: 'AED',
  organization: { name: 'Meridian' },
  party: { name: 'Al Noor Sweets' },
  items: [],
  totals: { subtotal: 0, taxes: [], total: 0 },
};

const bilingualTemplate = {
  ...DEFAULT_DOCUMENT_TEMPLATE_CONFIG,
  localization: { language: 'bilingual' as const, digits: 'western' as const },
};

describe('localizeDocument', () => {
  it("uses the customer's language over the template's", () => {
    const out = localizeDocument(base, bilingualTemplate, null, {
      companyNameAr: null,
      addressAr: null,
      documentLanguage: 'ar',
    });
    expect(out.language).toBe('ar');
  });

  it("falls back to the template's language", () => {
    expect(localizeDocument(base, bilingualTemplate, null, null).language).toBe(
      'bilingual',
    );
    expect(localizeDocument(base, null, null, null).language).toBe('en');
  });

  it('fills the Arabic names and addresses from the records, ignoring blanks', () => {
    const out = localizeDocument(
      base,
      bilingualTemplate,
      { legalNameAr: 'ميريديان', addressAr: '' },
      {
        companyNameAr: 'حلويات النور',
        addressAr: 'دبي',
        documentLanguage: null,
      },
    );
    expect(out.organization).toMatchObject({ nameAr: 'ميريديان' });
    expect(out.organization.addressAr).toBeUndefined();
    expect(out.party).toMatchObject({
      nameAr: 'حلويات النور',
      addressAr: 'دبي',
    });
  });
});
