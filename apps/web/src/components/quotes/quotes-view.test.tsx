import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Quote } from '@/hooks/use-quotes';
import { QuotesTable } from './quotes-table';
import { QuotesView } from './quotes-view';

const mockUseQuotes = vi.fn();
vi.mock('@/hooks/use-quotes', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/use-quotes')>();
  return {
    ...actual,
    useQuotes: () => mockUseQuotes(),
    useDownloadQuotePdf: () => vi.fn(),
  };
});

vi.mock('@/hooks/use-organization', () => ({
  useOrganization: () => ({
    data: { name: 'Test Org', baseCurrency: 'AED' },
    isLoading: false,
  }),
}));

vi.mock('@/hooks/use-catalog', () => ({
  useCostingPolicy: () => ({
    policy: { enforce: true, minMarginPct: 0.2, maxDiscountPct: 100 },
    isLoading: false,
  }),
}));

const granted = { current: new Set<string>() };
vi.mock('@/lib/session-context', () => ({
  useSession: () => ({
    check: ({ permission }: { permission: string }) => granted.current.has(permission),
    can: (p: string) => granted.current.has(p),
  }),
}));

function renderWithClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

let seq = 0;
function quote(overrides: Partial<Quote>): Quote {
  seq += 1;
  return {
    id: `q-${seq}`,
    tenantId: 't-1',
    quoteNumber: `QT-2026-00${seq}`,
    title: `Quote ${seq}`,
    customerName: 'Al Noor Sweets',
    createdBy: 'HUMAN',
    status: 'DRAFT',
    paymentTerms: 'immediate',
    currency: 'AED',
    items: [],
    subtotalAmount: 0,
    discountAmount: 0,
    taxAmount: 0,
    totalAmount: 0,
    acceptedAt: null,
    createdAt: '2026-10-04T00:00:00Z',
    updatedAt: '2026-10-04T00:00:00Z',
    ...overrides,
  } as Quote;
}

beforeEach(() => {
  granted.current = new Set();
});

describe('QuotesTable', () => {
  it('formats totalAmount correctly with commas and decimals when value is string or number', () => {
    const sampleQuotes = [
      quote({ currency: 'USD', totalAmount: '9.50' as unknown as number }),
      quote({ currency: 'USD', totalAmount: '6250.00' as unknown as number }),
    ];

    render(<QuotesTable quotes={sampleQuotes} />);
    expect(screen.getByText('$9.50')).toBeDefined();
    expect(screen.getByText('$6,250.00')).toBeDefined();
  });
});

describe('QuotesView', () => {
  it('counts only open quotes in base currency as open value, and names the rest', () => {
    mockUseQuotes.mockReturnValue({
      quotes: [
        // Counted: awaiting approval, and approved but not yet accepted.
        quote({ status: 'AWAITING_APPROVAL', totalAmount: '1000.00' as unknown as number }),
        quote({ status: 'APPROVED', totalAmount: 250.5 }),
        // Not counted: a draft, a rejection, an accepted quote, an old version.
        quote({ status: 'DRAFT', totalAmount: 9000 }),
        quote({ status: 'REJECTED', totalAmount: 7000 }),
        quote({ status: 'APPROVED', totalAmount: 5000, acceptedAt: '2026-10-10T00:00:00Z' }),
        quote({ status: 'APPROVED', totalAmount: 3000, supersededAt: '2026-10-11T00:00:00Z' }),
        // Not added in: another currency.
        quote({ status: 'AWAITING_APPROVAL', currency: 'USD', totalAmount: 400 }),
      ],
      isLoading: false,
      createQuote: vi.fn(),
      sendSignal: vi.fn(),
      refresh: vi.fn(),
    });

    renderWithClient(<QuotesView />);
    expect(screen.getByText(/1,250\.50/)).toBeDefined();
    expect(screen.getByText('Plus 1 quote in other currencies')).toBeDefined();
  });

  it('works the figures out from the rows the search leaves', () => {
    mockUseQuotes.mockReturnValue({
      quotes: [
        quote({ status: 'AWAITING_APPROVAL', customerName: 'Gulf Cartons', totalAmount: 800 }),
        quote({ status: 'AWAITING_APPROVAL', customerName: 'Al Noor Sweets', totalAmount: 1200 }),
      ],
      isLoading: false,
      createQuote: vi.fn(),
      sendSignal: vi.fn(),
      refresh: vi.fn(),
    });

    renderWithClient(<QuotesView />);
    expect(screen.getByText(/2,000\.00/)).toBeDefined();

    fireEvent.change(screen.getByPlaceholderText('Search...'), { target: { value: 'gulf' } });
    expect(screen.getByText(/800\.00/, { selector: 'p' })).toBeDefined();
    expect(screen.queryByText(/2,000\.00/)).toBeNull();
  });

  it('asks before approving from a row, showing the total and the margin against the floor', async () => {
    granted.current = new Set(['quote:approve', 'quote:view_cost']);
    const sendSignal = vi.fn().mockResolvedValue({});
    const awaiting = quote({
      status: 'AWAITING_APPROVAL',
      quoteNumber: 'QT-2026-0042',
      subtotalAmount: 1000,
      totalAmount: 1050,
      items: [
        {
          id: 'l-1',
          type: 'product',
          description: 'Rigid box',
          quantity: 100,
          unitPrice: 10,
          discount: 0,
          taxRate: 5,
          subtotal: 1000,
          cost: { unitCost: 9, totalCost: 900, source: 'COMPUTED' },
        },
      ],
    });
    mockUseQuotes.mockReturnValue({
      quotes: [awaiting],
      isLoading: false,
      createQuote: vi.fn(),
      sendSignal,
      refresh: vi.fn(),
    });

    renderWithClient(<QuotesView />);
    fireEvent.click(screen.getByRole('button', { name: 'Approve QT-2026-0042' }));
    expect(sendSignal).not.toHaveBeenCalled();

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Approve QT-2026-0042?')).toBeDefined();
    expect(within(dialog).getByText(/1,050\.00/)).toBeDefined();
    expect(within(dialog).getByTestId('decision-margin-status').textContent).toBe('Below 20% floor');

    fireEvent.click(within(dialog).getByRole('button', { name: 'Approve quote' }));
    await waitFor(() => expect(sendSignal).toHaveBeenCalledWith(awaiting.id, 'APPROVE'));
  });

  it('confirms a rejection with a danger button, and hides margin from someone without cost access', async () => {
    granted.current = new Set(['quote:approve']);
    const awaiting = quote({ status: 'AWAITING_APPROVAL', quoteNumber: 'QT-2026-0043', totalAmount: 500 });
    mockUseQuotes.mockReturnValue({
      quotes: [awaiting],
      isLoading: false,
      createQuote: vi.fn(),
      sendSignal: vi.fn(),
      refresh: vi.fn(),
    });

    renderWithClient(<QuotesView />);
    fireEvent.click(screen.getByRole('button', { name: 'Reject QT-2026-0043' }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('button', { name: 'Reject quote' }).className).toContain('bg-danger');
    expect(within(dialog).queryByTestId('decision-margin-status')).toBeNull();
  });

  it('offers no approve or reject to someone who cannot approve', () => {
    mockUseQuotes.mockReturnValue({
      quotes: [quote({ status: 'AWAITING_APPROVAL', quoteNumber: 'QT-2026-0044' })],
      isLoading: false,
      createQuote: vi.fn(),
      sendSignal: vi.fn(),
      refresh: vi.fn(),
    });

    renderWithClient(<QuotesView />);
    expect(screen.queryByRole('button', { name: 'Approve QT-2026-0044' })).toBeNull();
  });

  it('renders Table and Pipeline view switcher buttons', () => {
    mockUseQuotes.mockReturnValue({
      quotes: [],
      isLoading: false,
      createQuote: vi.fn(),
      sendSignal: vi.fn(),
      refresh: vi.fn(),
    });

    renderWithClient(<QuotesView />);
    expect(screen.getByText('Table')).toBeDefined();
    expect(screen.getByText('Pipeline')).toBeDefined();
  });
});
