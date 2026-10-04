import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { QuoteStatusPipeline } from './quote-status-pipeline';
import { QuoteLinesTable } from './quote-editor/quote-lines-table';
import { QuoteTotalsCard } from './quote-editor/quote-totals-card';
import { QuoteTabsSection } from './quote-editor/quote-tabs-section';
import { QuotePrintModal } from './quote-editor/quote-print-modal';
import { DocumentTemplateSheet } from '../documents/document-template-sheet';
import { DEFAULT_DOCUMENT_TEMPLATE_CONFIG, type QuoteLineItem } from '@saas/shared';

function renderWithClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

describe('QuoteStatusPipeline', () => {
  it('renders all pipeline stages for DRAFT', () => {
    render(<QuoteStatusPipeline status="DRAFT" />);
    expect(screen.getByText('Quotation (Draft)')).toBeDefined();
    expect(screen.getByText('Awaiting Approval')).toBeDefined();
    expect(screen.getByText('Quotation Confirmed')).toBeDefined();
  });

  it('renders rejected badge when status is REJECTED', () => {
    render(<QuoteStatusPipeline status="REJECTED" />);
    expect(screen.getByText(/Rejected \/ Revision Needed/i)).toBeDefined();
  });
});

describe('QuoteLinesTable', () => {
  const sampleItems: QuoteLineItem[] = [
    {
      id: 'sec-1',
      type: 'section',
      description: 'Phase 1: Architecture',
    },
    {
      id: 'prod-1',
      type: 'product',
      description: 'System Setup',
      quantity: 2,
      uom: 'Units',
      unitPrice: 500,
      discount: 10,
      taxRate: 5,
      subtotal: 900,
    },
    {
      id: 'note-1',
      type: 'note',
      description: 'Standard SLA applies',
    },
  ];

  it('renders sections, products, and notes', () => {
    const handleChange = vi.fn();
    render(<QuoteLinesTable items={sampleItems} onChange={handleChange} currency="USD" />);

    expect(screen.getByDisplayValue('Phase 1: Architecture')).toBeDefined();
    expect(screen.getByDisplayValue('System Setup')).toBeDefined();
    expect(screen.getByDisplayValue('Standard SLA applies')).toBeDefined();
    expect(screen.getByText('$900.00')).toBeDefined();
  });

  it('allows adding product, section, and note when not read-only', () => {
    const handleChange = vi.fn();
    render(<QuoteLinesTable items={[]} onChange={handleChange} currency="USD" />);

    const addProductBtn = screen.getByText('Add a product');
    fireEvent.click(addProductBtn);
    expect(handleChange).toHaveBeenCalledTimes(1);

    const addSectionBtn = screen.getByText('Add a section');
    fireEvent.click(addSectionBtn);
    expect(handleChange).toHaveBeenCalledTimes(2);

    const addNoteBtn = screen.getByText('Add a note');
    fireEvent.click(addNoteBtn);
    expect(handleChange).toHaveBeenCalledTimes(3);
  });

  it('hides add buttons when readOnly is true', () => {
    const handleChange = vi.fn();
    render(<QuoteLinesTable items={sampleItems} onChange={handleChange} readOnly={true} />);

    expect(screen.queryByText('Add a product')).toBeNull();
    expect(screen.queryByText('Add a section')).toBeNull();
    expect(screen.queryByText('Add a note')).toBeNull();
  });
});

describe('QuoteTotalsCard', () => {
  it('renders financial summary and totals accurately', () => {
    render(
      <QuoteTotalsCard
        totals={{
          subtotalAmount: 1000,
          discountAmount: 100,
          taxAmount: 50,
          totalAmount: 1050,
          costAmount: 600,
          marginAmount: 400,
          marginPct: 0.4,
          hasCompleteCost: true,
        }}
        currency="USD"
      />,
    );

    expect(screen.getByText('Untaxed Amount')).toBeDefined();
    expect(screen.getByText('$1,000.00')).toBeDefined();
    expect(screen.getByText('Total Discount')).toBeDefined();
    expect(screen.getByText('-$100.00')).toBeDefined();
    expect(screen.getByText('Taxes')).toBeDefined();
    expect(screen.getByText('$50.00')).toBeDefined();
    expect(screen.getByText('$1,050.00')).toBeDefined();
  });
});

describe('QuoteTabsSection', () => {
  it('switches between Terms and Notes tabs', () => {
    const handleChangeTerms = vi.fn();
    const handleChangeNotes = vi.fn();

    render(
      <QuoteTabsSection
        termsAndConditions="Custom payment schedule."
        notes="Internal target margin: 40%."
        onChangeTerms={handleChangeTerms}
        onChangeNotes={handleChangeNotes}
      />,
    );

    // Initial tab is Terms
    expect(screen.getByDisplayValue('Custom payment schedule.')).toBeDefined();

    // Click Internal Notes tab
    fireEvent.click(screen.getByText('Internal Notes'));
    expect(screen.getByDisplayValue('Internal target margin: 40%.')).toBeDefined();
  });
});

describe('QuotePrintModal', () => {
  const dummyHeader = {
    title: 'Dundu company',
    quoteNumber: 'QT-2026-0030',
    customerId: 'cust-1',
    customerName: 'S7 Berlin GmbH',
    customerEmail: 'ismailfarisi@gmail.com',
    paymentTerms: 'NET_60',
    currency: 'USD',
  };

  const dummyItems: QuoteLineItem[] = [
    {
      id: 'item-1',
      type: 'product',
      description: 'Carton',
      quantity: 1,
      uom: 'Units',
      unitPrice: 10,
      discount: 5,
      taxRate: 5,
      subtotal: 9.5,
    },
  ];

  const dummyTotals = {
    subtotalAmount: 9.5,
    discountAmount: 0.5,
    taxAmount: 0.48,
    totalAmount: 9.97,
    costAmount: 0,
    marginAmount: 9.5,
    marginPct: 1,
    hasCompleteCost: true,
  };

  it('renders quotation preview document and buttons when open', () => {
    const handleClose = vi.fn();
    renderWithClient(
      <QuotePrintModal
        open={true}
        onClose={handleClose}
        headerData={dummyHeader}
        items={dummyItems}
        totals={dummyTotals}
        termsAndConditions="Payment due according to agreed payment terms."
      />
    );

    expect(screen.getByText('QUOTE Document Preview')).toBeDefined();
    expect(screen.getByText('S7 Berlin GmbH')).toBeDefined();
    expect(screen.getByText('Carton')).toBeDefined();
    expect(screen.getByText('$9.97')).toBeDefined();
    expect(screen.getByText('Payment due according to agreed payment terms.')).toBeDefined();
    expect(screen.getByText('Authorized Signature')).toBeDefined();

    expect(screen.getByText('Print / Save as PDF')).toBeDefined();
    expect(screen.getByText('Download PDF')).toBeDefined();
    expect(document.body.classList.contains('quote-print-modal-open')).toBe(true);
  });

  it('triggers window.print when Print / Save as PDF is clicked', () => {
    const printSpy = vi.spyOn(window, 'print').mockImplementation(() => {});
    renderWithClient(
      <QuotePrintModal
        open={true}
        onClose={vi.fn()}
        headerData={dummyHeader}
        items={dummyItems}
        totals={dummyTotals}
      />
    );

    fireEvent.click(screen.getByText('Print / Save as PDF'));
    expect(printSpy).toHaveBeenCalled();
    printSpy.mockRestore();
  });

  it('does not render when open is false', () => {
    renderWithClient(
      <QuotePrintModal
        open={false}
        onClose={vi.fn()}
        headerData={dummyHeader}
        items={dummyItems}
        totals={dummyTotals}
      />
    );

    expect(screen.queryByText('QUOTE Document Preview')).toBeNull();
  });
});

describe('DocumentTemplateSheet', () => {
  const dummyInvoiceData = {
    type: 'INVOICE' as const,
    number: 'INV-2026-0042',
    status: 'ISSUED',
    issuedAt: new Date('2026-10-01'),
    dueDate: new Date('2026-10-31'),
    currency: 'USD',
    organization: {
      name: 'Acme Corp Global',
      address: '742 Industrial Pkwy, Austin, TX',
      phone: '+1 512 555-0199',
      email: 'billing@acmecorp.com',
      taxId: 'US-99238411',
    },
    party: {
      name: 'Apex Supplies LLC',
      address: '100 Logistics Way, Chicago, IL',
      email: 'accounts@apex.example',
    },
    items: [
      {
        code: 'BOX-01',
        description: 'Corrugated Box',
        quantity: 100,
        unitPrice: 2.5,
        discount: 0,
        taxRate: 10,
        amount: 250,
      },
    ],
    totals: {
      subtotal: 250,
      discounts: 0,
      taxes: [{ rate: 10, label: 'VAT 10%', amount: 25 }],
      total: 275,
      balanceDue: 275,
    },
    notes: 'Thank you for your business.',
    paymentTerms: 'NET 30',
  };

  it('renders split header layout by default', () => {
    render(
      <DocumentTemplateSheet
        data={dummyInvoiceData}
        config={{
          ...DEFAULT_DOCUMENT_TEMPLATE_CONFIG,
          header: {
            ...DEFAULT_DOCUMENT_TEMPLATE_CONFIG.header,
            layout: 'split',
          },
        }}
      />
    );

    expect(screen.getByText('TAX INVOICE')).toBeDefined();
    expect(screen.getByText('INV-2026-0042')).toBeDefined();
    expect(screen.getByText('Apex Supplies LLC')).toBeDefined();
    expect(screen.getByText('Corrugated Box')).toBeDefined();
    expect(screen.getByText('$275.00')).toBeDefined();
  });

  it('renders banner header layout with primaryColor background', () => {
    render(
      <DocumentTemplateSheet
        data={dummyInvoiceData}
        config={{
          ...DEFAULT_DOCUMENT_TEMPLATE_CONFIG,
          branding: {
            ...DEFAULT_DOCUMENT_TEMPLATE_CONFIG.branding,
            primaryColor: '#059669',
          },
          header: {
            ...DEFAULT_DOCUMENT_TEMPLATE_CONFIG.header,
            layout: 'banner',
          },
        }}
      />
    );

    expect(screen.getByText('TAX INVOICE')).toBeDefined();
    expect(screen.getByText('Acme Corp Global')).toBeDefined();
    expect(screen.getByText('Apex Supplies LLC')).toBeDefined();
  });

  it('renders centered header layout', () => {
    render(
      <DocumentTemplateSheet
        data={dummyInvoiceData}
        config={{
          ...DEFAULT_DOCUMENT_TEMPLATE_CONFIG,
          header: {
            ...DEFAULT_DOCUMENT_TEMPLATE_CONFIG.header,
            layout: 'centered',
          },
        }}
      />
    );

    expect(screen.getByText('TAX INVOICE')).toBeDefined();
    expect(screen.getByText('Acme Corp Global')).toBeDefined();
  });
});
