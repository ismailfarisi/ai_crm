import {
  DEFAULT_DOCUMENT_TEMPLATE_CONFIG,
  DocumentLanguage,
  DocumentTemplateConfig,
  UniversalDocumentData,
} from '@saas/shared';
import { DocumentPdfRendererService } from './document-pdf-renderer.service';
import { extractPdfText } from './pdf/pdf-text.testing';

const doc = (
  type: UniversalDocumentData['type'],
  language: DocumentLanguage,
): UniversalDocumentData => ({
  type,
  language,
  number: 'INV-2026-0042',
  status: 'ISSUED',
  issuedAt: '2026-11-17T08:00:00Z',
  dueDate: '2026-12-17T08:00:00Z',
  currency: 'AED',
  organization: {
    name: 'Meridian Packaging Co',
    nameAr: 'ميريديان للتغليف',
    address: 'Warehouse 12, Al Quoz 3, Dubai',
    addressAr: 'مستودع 12، القوز 3، دبي',
    taxId: '100234567800003',
  },
  party: {
    name: 'Al Noor Sweets LLC',
    nameAr: 'حلويات النور',
    address: 'Shop 4, Al Wasl Road, Dubai',
    taxId: '100998877600003',
  },
  items: [
    {
      code: 'BX-RIG',
      description: 'Rigid gift box',
      descriptionAr: 'صندوق هدايا صلب',
      quantity: 500,
      unitPrice: 12.5,
      taxRate: 5,
      amount: 6250,
    },
  ],
  totals: {
    subtotal: 6250,
    taxes: [{ rate: 5, label: 'VAT', amount: 312.5 }],
    total: 6562.5,
  },
});

const taxRegistered: DocumentTemplateConfig = {
  ...DEFAULT_DOCUMENT_TEMPLATE_CONFIG,
  header: {
    ...DEFAULT_DOCUMENT_TEMPLATE_CONFIG.header,
    customLabels: {
      ...DEFAULT_DOCUMENT_TEMPLATE_CONFIG.header.customLabels,
      invoice: 'TAX INVOICE',
    },
  },
};

describe('DocumentPdfRendererService in Arabic', () => {
  const renderer = new DocumentPdfRendererService();
  const text = async (
    type: UniversalDocumentData['type'],
    language: DocumentLanguage,
    config: DocumentTemplateConfig = DEFAULT_DOCUMENT_TEMPLATE_CONFIG,
  ) => extractPdfText(await renderer.render(doc(type, language), config));

  it('prints an English document without Arabic', async () => {
    const out = await text('INVOICE', 'en');
    expect(out).toContain('Rigid gift box');
    expect(out).not.toMatch(/[\u0600-\u06FF]/);
  });

  it('prints an Arabic tax invoice with Arabic labels, names and lines, and Western amounts', async () => {
    const out = await text('INVOICE', 'ar', taxRegistered);
    expect(out).toContain('فاتورة ضريبية');
    expect(out).toContain('رقم التسجيل الضريبي');
    expect(out).toContain('ميريديان للتغليف');
    expect(out).toContain('حلويات النور');
    expect(out).toContain('صندوق هدايا صلب');
    expect(out).toContain('100234567800003');
    expect(out).toMatch(/6,562\.50/);
    expect(out).not.toContain('Rigid gift box');
    expect(out).not.toContain('?');
  });

  it('prints both languages on a bilingual quote', async () => {
    const out = await text('QUOTE', 'bilingual');
    expect(out).toContain('QUOTATION');
    expect(out).toContain('عرض سعر');
    expect(out).toContain('Rigid gift box');
    expect(out).toContain('صندوق هدايا صلب');
    expect(out).toContain('Al Noor Sweets LLC');
    expect(out).toContain('حلويات النور');
  });

  it.each(['STATEMENT', 'DELIVERY_NOTE', 'PURCHASE_ORDER'] as const)(
    'titles a %s in Arabic',
    async (type) => {
      const titles = {
        STATEMENT: 'كشف حساب',
        DELIVERY_NOTE: 'إشعار تسليم',
        PURCHASE_ORDER: 'أمر شراء',
      };
      expect(await text(type, 'ar')).toContain(titles[type]);
    },
  );

  it('uses Arabic-Indic digits only when the template asks for them', async () => {
    const out = await text('INVOICE', 'ar', {
      ...DEFAULT_DOCUMENT_TEMPLATE_CONFIG,
      localization: { language: 'ar', digits: 'arabic-indic' },
    });
    expect(out).toMatch(/٦,٥٦٢\.٥٠/);
  });
});
