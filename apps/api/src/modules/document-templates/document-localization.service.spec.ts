import {
  DEFAULT_DOCUMENT_TEMPLATE_CONFIG,
  UniversalDocumentData,
} from '@saas/shared';
import {
  DocumentLocalizationService,
  localizeDocument,
} from './document-localization.service';

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

describe('DocumentLocalizationService.orderLineDescriptionsAr', () => {
  it('maps order lines to their quote line Arabic text, scoped to the tenant', async () => {
    const quotes = {
      findOne: jest.fn().mockResolvedValue({
        items: [
          { id: 'q1', descriptionAr: ' علبة ' },
          { id: 'q2', descriptionAr: '' },
        ],
      }),
    };
    const orderLines = {
      find: jest.fn().mockResolvedValue([
        { id: 'sol-1', quoteLineId: 'q1' },
        { id: 'sol-2', quoteLineId: 'q2' },
        { id: 'sol-3', quoteLineId: null },
      ]),
    };
    const service = new DocumentLocalizationService(
      {} as never,
      {} as never,
      orderLines as never,
      quotes as never,
      {} as never,
    );

    const result = await service.orderLineDescriptionsAr('t1', 'quote-1', [
      'sol-1',
      'sol-2',
      'sol-3',
    ]);

    expect(quotes.findOne).toHaveBeenCalledWith({
      where: { id: 'quote-1', tenantId: 't1' },
    });
    expect(orderLines.find.mock.calls[0][0].where.tenantId).toBe('t1');
    expect([...result]).toEqual([['sol-1', 'علبة']]);
  });

  it('skips the lookup without a quote', async () => {
    const service = new DocumentLocalizationService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    expect(
      (await service.orderLineDescriptionsAr('t1', null, ['x'])).size,
    ).toBe(0);
  });
});
