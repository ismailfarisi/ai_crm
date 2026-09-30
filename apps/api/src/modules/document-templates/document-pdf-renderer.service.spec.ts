import { DocumentPdfRendererService } from './document-pdf-renderer.service';
import {
  DEFAULT_DOCUMENT_TEMPLATE_CONFIG,
  DocumentTemplateConfig,
  UniversalDocumentData,
} from '@saas/shared';

describe('DocumentPdfRendererService', () => {
  let renderer: DocumentPdfRendererService;

  beforeEach(() => {
    renderer = new DocumentPdfRendererService();
  });

  const baseDoc: UniversalDocumentData = {
    type: 'INVOICE',
    number: 'INV-2026-0099',
    status: 'ISSUED',
    issuedAt: new Date('2026-09-30'),
    dueDate: new Date('2026-10-30'),
    currency: 'USD',
    organization: {
      name: 'Northwind Traders',
      address: '123 Market St, London, UK',
      taxId: 'GB123456789',
      phone: '+44 20 7946 0912',
      email: 'billing@northwind.com',
    },
    party: {
      name: 'Acme Corporation',
      companyName: 'Acme Corp',
      address: '456 Industrial Way, Suite 100',
      email: 'accounts@acme.com',
      taxId: 'US-987654321',
    },
    items: [
      {
        code: 'SVC-001',
        description:
          'Cloud Infrastructure Consulting - Initial Architecture Assessment and Setup',
        quantity: 40,
        unitPrice: 150,
        amount: 6000,
      },
      {
        code: 'SVC-002',
        description: 'Database Optimization and Index Tuning',
        quantity: 15,
        unitPrice: 160,
        amount: 2400,
      },
    ],
    totals: {
      subtotal: 8400,
      taxes: [{ rate: 20, label: 'VAT 20%', amount: 1680 }],
      total: 10080,
      balanceDue: 10080,
    },
    notes: 'Payment required within net 30 days.',
  };

  it('should render a valid PDF buffer for an Invoice', async () => {
    const buffer = await renderer.render(
      baseDoc,
      DEFAULT_DOCUMENT_TEMPLATE_CONFIG,
    );
    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBeGreaterThan(1000);
    // PDF Magic bytes: %PDF-
    expect(buffer.subarray(0, 5).toString('ascii')).toBe('%PDF-');
  });

  it('should render valid PDF buffer for Quote, Statement, Delivery Note and Purchase Order', async () => {
    const docTypes: UniversalDocumentData['type'][] = [
      'QUOTE',
      'STATEMENT',
      'DELIVERY_NOTE',
      'PURCHASE_ORDER',
    ];

    for (const type of docTypes) {
      const doc: UniversalDocumentData = {
        ...baseDoc,
        type,
        statementSummary:
          type === 'STATEMENT'
            ? {
                openingBalance: 1200,
                closingBalance: 11280,
                periodFrom: new Date('2026-09-01'),
                periodTo: new Date('2026-09-30'),
                aging: {
                  current: 10080,
                  days30: 1200,
                  days60: 0,
                  days90Plus: 0,
                },
              }
            : undefined,
        secondaryParty:
          type === 'DELIVERY_NOTE'
            ? {
                label: 'Shipping Carrier',
                name: 'FastCourier Ltd',
                carrier: 'DHL Express',
                trackingReference: 'TRK-99887766',
              }
            : undefined,
      };
      const buffer = await renderer.render(
        doc,
        DEFAULT_DOCUMENT_TEMPLATE_CONFIG,
      );
      expect(buffer).toBeInstanceOf(Buffer);
      expect(buffer.subarray(0, 5).toString('ascii')).toBe('%PDF-');
      expect(buffer.length).toBeGreaterThan(1000);
    }
  });

  it('should cleanly handle multi-page pagination for many line items', async () => {
    const manyItems = Array.from({ length: 45 }, (_, i) => ({
      code: `SKU-${i + 1}`,
      description: `Product description for item #${i + 1} with extra details that wrap across multiple lines of text and test row wrapping`,
      quantity: i + 1,
      unitPrice: 25.5,
      amount: (i + 1) * 25.5,
    }));

    const longDoc: UniversalDocumentData = {
      ...baseDoc,
      items: manyItems,
      totals: {
        subtotal: 26000,
        total: 26000,
      },
    };

    const buffer = await renderer.render(
      longDoc,
      DEFAULT_DOCUMENT_TEMPLATE_CONFIG,
    );
    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBeGreaterThan(5000);
    expect(buffer.subarray(0, 5).toString('ascii')).toBe('%PDF-');
  });

  it('should support custom branding colors, fonts, and header layouts', async () => {
    const centeredConfig: DocumentTemplateConfig = {
      ...DEFAULT_DOCUMENT_TEMPLATE_CONFIG,
      branding: {
        ...DEFAULT_DOCUMENT_TEMPLATE_CONFIG.branding,
        fontFamily: 'Times-Roman',
        primaryColor: '#7c3aed',
        secondaryColor: '#a78bfa',
      },
      header: {
        ...DEFAULT_DOCUMENT_TEMPLATE_CONFIG.header,
        layout: 'centered',
      },
      footer: {
        ...DEFAULT_DOCUMENT_TEMPLATE_CONFIG.footer,
        showSignatureBlock: true,
        signatureLabel: 'Customer Acceptance',
      },
    };

    const buf1 = await renderer.render(baseDoc, centeredConfig);
    expect(buf1).toBeInstanceOf(Buffer);
    expect(buf1.subarray(0, 5).toString('ascii')).toBe('%PDF-');

    const bannerConfig: DocumentTemplateConfig = {
      ...DEFAULT_DOCUMENT_TEMPLATE_CONFIG,
      branding: {
        ...DEFAULT_DOCUMENT_TEMPLATE_CONFIG.branding,
        fontFamily: 'Courier',
        primaryColor: '#059669',
        secondaryColor: '#10b981',
      },
      header: {
        ...DEFAULT_DOCUMENT_TEMPLATE_CONFIG.header,
        layout: 'banner',
      },
      itemsTable: {
        ...DEFAULT_DOCUMENT_TEMPLATE_CONFIG.itemsTable,
        zebraStriping: true,
        headerBackgroundColor: '#059669',
        headerTextColor: '#ffffff',
      },
    };

    const buf2 = await renderer.render(baseDoc, bannerConfig);
    expect(buf2).toBeInstanceOf(Buffer);
    expect(buf2.subarray(0, 5).toString('ascii')).toBe('%PDF-');
  });

  it('should safely fall back if logoUrl fails or fields are missing without crashing', async () => {
    const docWithLogo: UniversalDocumentData = {
      ...baseDoc,
      organization: {
        ...baseDoc.organization,
        logoUrl: 'https://invalid-host-name-never-exists.example/logo.png',
      },
      items: [],
      totals: {
        total: 0,
      },
      notes: undefined,
    };

    const buffer = await renderer.render(docWithLogo);
    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.subarray(0, 5).toString('ascii')).toBe('%PDF-');
  });

  it('should render successfully with a valid data URI base64 logo', async () => {
    const pngBase64 =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const docWithBase64Logo: UniversalDocumentData = {
      ...baseDoc,
      organization: {
        ...baseDoc.organization,
        logoUrl: pngBase64,
      },
    };

    const buffer = await renderer.render(docWithBase64Logo);
    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.subarray(0, 5).toString('ascii')).toBe('%PDF-');
  });

  it('should render bank details, custom payment terms, and string dates', async () => {
    const docWithStringDates: UniversalDocumentData = {
      ...baseDoc,
      issuedAt: '2026-09-30T00:00:00.000Z',
      dueDate: '2026-10-30T00:00:00.000Z',
      validUntil: '2026-11-15T00:00:00.000Z',
      paymentTerms: 'Due upon receipt',
      notes: 'Custom notes on document',
    };

    const configWithBank: DocumentTemplateConfig = {
      ...DEFAULT_DOCUMENT_TEMPLATE_CONFIG,
      footer: {
        ...DEFAULT_DOCUMENT_TEMPLATE_CONFIG.footer,
        bankDetails: {
          bankName: 'Barclays International',
          accountName: 'Northwind Ltd',
          accountNumber: '12345678',
          routingOrIban: 'GB29BARC20000012345678',
          swiftBic: 'BARCGB22',
        },
      },
    };

    const buffer = await renderer.render(docWithStringDates, configWithBank);
    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.subarray(0, 5).toString('ascii')).toBe('%PDF-');
  });
});
