import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { QuotesTable } from './quotes-table';
import { QuotesView } from './quotes-view';

const mockUseQuotes = vi.fn();
vi.mock('@/hooks/use-quotes', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/use-quotes')>();
  return {
    ...actual,
    useQuotes: () => mockUseQuotes(),
    useDownloadQuotePdf: () => ({ downloadPdf: vi.fn(), isDownloading: false }),
  };
});

vi.mock('@/hooks/use-organization', () => ({
  useOrganization: () => ({
    data: { name: 'Test Org' },
    isLoading: false,
  }),
}));

function renderWithClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

describe('QuotesTable', () => {
  it('formats totalAmount correctly with commas and decimals when value is string or number', () => {
    const sampleQuotes = [
      {
        id: 'q-1',
        tenantId: 't-1',
        quoteNumber: 'QT-2026-0030',
        title: 'Dundu company',
        customerName: 'S7 Berlin GmbH',
        createdBy: 'HUMAN' as const,
        status: 'DRAFT' as const,
        paymentTerms: 'immediate',
        currency: 'USD',
        items: [{ id: '1', type: 'product' as const, description: 'Item 1', quantity: 1, unitPrice: 9.5, discount: 0, taxRate: 0, subtotal: 9.5 }],
        subtotalAmount: 9.5,
        discountAmount: 0,
        taxAmount: 0,
        totalAmount: '9.50' as unknown as number,
        createdAt: '2026-10-04T00:00:00Z',
        updatedAt: '2026-10-04T00:00:00Z',
      },
      {
        id: 'q-2',
        tenantId: 't-1',
        quoteNumber: 'QT-2026-0029',
        title: 'Sales Quote for Acme Corp',
        customerName: 'Acme Corp',
        createdBy: 'HUMAN' as const,
        status: 'DRAFT' as const,
        paymentTerms: 'immediate',
        currency: 'USD',
        items: [],
        subtotalAmount: 6250,
        discountAmount: 0,
        taxAmount: 0,
        totalAmount: '6250.00' as unknown as number,
        createdAt: '2026-10-02T00:00:00Z',
        updatedAt: '2026-10-02T00:00:00Z',
      },
    ];

    render(<QuotesTable quotes={sampleQuotes} />);
    expect(screen.getByText('$9.50')).toBeDefined();
    expect(screen.getByText('$6,250.00')).toBeDefined();
  });
});

describe('QuotesView', () => {
  it('calculates Total Value correctly using numeric sum instead of string concatenation', () => {
    mockUseQuotes.mockReturnValue({
      quotes: [
        {
          id: 'q-1',
          tenantId: 't-1',
          quoteNumber: 'QT-2026-0030',
          title: 'Dundu company',
          customerName: 'S7 Berlin GmbH',
          createdBy: 'HUMAN' as const,
          status: 'DRAFT' as const,
          paymentTerms: 'immediate',
          currency: 'USD',
          items: [],
          subtotalAmount: 9.5,
          discountAmount: 0,
          taxAmount: 0,
          totalAmount: '9.50' as unknown as number,
          createdAt: '2026-10-04T00:00:00Z',
          updatedAt: '2026-10-04T00:00:00Z',
        },
        {
          id: 'q-2',
          tenantId: 't-1',
          quoteNumber: 'QT-2026-0029',
          title: 'Sales Quote for Acme Corp',
          customerName: 'Acme Corp',
          createdBy: 'HUMAN' as const,
          status: 'DRAFT' as const,
          paymentTerms: 'immediate',
          currency: 'USD',
          items: [],
          subtotalAmount: 6250,
          discountAmount: 0,
          taxAmount: 0,
          totalAmount: '6250.00' as unknown as number,
          createdAt: '2026-10-02T00:00:00Z',
          updatedAt: '2026-10-02T00:00:00Z',
        },
        {
          id: 'q-3',
          tenantId: 't-1',
          quoteNumber: 'QT-2026-0028',
          title: 'Test quote in switeaz',
          customerName: 'Switeaz Customer',
          createdBy: 'HUMAN' as const,
          status: 'DRAFT' as const,
          paymentTerms: 'immediate',
          currency: 'USD',
          items: [],
          subtotalAmount: 0,
          discountAmount: 0,
          taxAmount: 0,
          totalAmount: '0.00' as unknown as number,
          createdAt: '2026-10-02T00:00:00Z',
          updatedAt: '2026-10-02T00:00:00Z',
        },
      ],
      isLoading: false,
      createQuote: vi.fn(),
      sendSignal: vi.fn(),
    });

    renderWithClient(<QuotesView />);
    // 9.50 + 6250.00 + 0.00 = 6,259.50
    // Must NOT be "$09.506250.000.00"
    expect(screen.getByText('$6,259.50')).toBeDefined();
    expect(screen.queryByText(/09\.506250/)).toBeNull();
  });
});
