import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { QuoteEditorPage } from './quote-editor-page';
import { api } from '@/lib/api/endpoints';
import { useSession } from '@/lib/session-context';
import { useQuoteSalesOrder } from '@/hooks/use-sales-orders';
import { toast } from 'sonner';
import { PERMISSIONS, type QuoteDto, type Permission } from '@saas/shared';

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    back: vi.fn(),
  }),
}));

vi.mock('@/lib/api/endpoints', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/endpoints')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      quotes: {
        get: vi.fn(),
        update: vi.fn(),
        create: vi.fn(),
        signal: vi.fn(),
        getNextNumber: vi.fn().mockResolvedValue({ nextNumber: 'QT-2026-0001' }),
        downloadPdf: vi.fn(),
      },
      quoteAcceptance: {
        createLink: vi.fn(),
        send: vi.fn(),
        revise: vi.fn(),
        markAccepted: vi.fn(),
      },
      documentTemplates: {
        resolve: vi.fn().mockResolvedValue(null),
      },
    },
  };
});

vi.mock('@/hooks/use-catalog', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/use-catalog')>();
  return {
    ...actual,
    useCostingPolicy: () => ({ policy: null, isLoading: false }),
    useLineResolver: () => ({ resolve: vi.fn(), isResolving: false }),
    useCatalogSearch: () => ({ items: [], templates: [], isLoading: false }),
  };
});

vi.mock('@/hooks/use-credits', () => ({
  useTaxCodes: () => ({ data: [], isLoading: false }),
}));

vi.mock('@/hooks/use-organization', () => ({
  useOrganization: () => ({ data: { name: 'Acme Corp' }, isLoading: false }),
}));

vi.mock('@/hooks/use-sales-orders', () => ({
  useQuoteSalesOrder: vi.fn(() => ({ data: null, isLoading: false, refetch: vi.fn() })),
}));

vi.mock('sonner', async (importOriginal) => {
  const actual = await importOriginal<typeof import('sonner')>();
  return {
    ...actual,
    toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), warning: vi.fn() }),
  };
});

vi.mock('@/components/platform/attachments-panel', () => ({
  AttachmentsPanel: () => <div data-testid="attachments-panel">Attachments</div>,
}));

vi.mock('@/components/platform/activity-timeline', () => ({
  ActivityTimeline: () => <div data-testid="activity-timeline">Timeline</div>,
}));

vi.mock('@/lib/session-context', () => ({
  useSession: vi.fn(),
  useCan: vi.fn(),
}));

const useSessionMock = vi.mocked(useSession);

function mockSession(permissions: Permission[]) {
  useSessionMock.mockReturnValue({
    check: (rule: {
      permission?: Permission | Permission[];
      anyOf?: Permission[];
      role?: string[];
    }) => {
      const held = (p: Permission) => permissions.includes(p);
      if (rule.permission) {
        const list = Array.isArray(rule.permission) ? rule.permission : [rule.permission];
        return list.every(held);
      }
      if (rule.anyOf) return rule.anyOf.some(held);
      return false;
    },
  } as never);
}

function renderWithClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

const sampleQuote: QuoteDto = {
  id: 'quote-123',
  tenantId: 'tenant-1',
  quoteNumber: 'QT-2026-0050',
  title: 'Cloud Migration Project',
  customerId: 'cust-1',
  customerName: 'Acme Corp',
  customerEmail: 'contact@acme.com',
  status: 'AWAITING_APPROVAL',
  createdBy: 'HUMAN',
  validUntil: '2026-11-01',
  paymentTerms: 'net_30',
  currency: 'USD',
  items: [
    {
      id: 'line-1',
      type: 'product',
      description: 'Consulting Hours',
      quantity: 10,
      uom: 'Hours',
      unitPrice: 150,
      discount: 0,
      taxRate: 0,
      subtotal: 1500,
    },
  ],
  subtotalAmount: 1500,
  discountAmount: 0,
  taxAmount: 0,
  totalAmount: 1500,
  termsAndConditions: 'Standard terms',
  notes: 'Client requested fast turnaround',
  billingSchedule: null,
  acceptedAt: null,
  acceptedByName: null,
  supersededAt: null,
  version: 1,
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-01T00:00:00Z',
};

describe('QuoteEditorPage - Awaiting Approval & Edit Save', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession([PERMISSIONS.QUOTE_READ, PERMISSIONS.QUOTE_UPDATE]);
  });

  it('renders "Save Draft" and "Submit for Approval" when status is DRAFT', () => {
    const draftQuote: QuoteDto = {
      ...sampleQuote,
      status: 'DRAFT',
    };

    renderWithClient(<QuoteEditorPage initialQuote={draftQuote} />);

    expect(screen.getByRole('button', { name: /save draft/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /submit for approval/i })).toBeDefined();
  });

  it('renders "Save Changes" button when status is AWAITING_APPROVAL and allows saving edits', async () => {
    const mockUpdate = vi.mocked(api.quotes.update);
    mockUpdate.mockResolvedValueOnce({
      ...sampleQuote,
      title: 'Cloud Migration Project - Updated',
    });

    renderWithClient(<QuoteEditorPage initialQuote={sampleQuote} />);

    // Save button must exist!
    const saveBtn = screen.getByRole('button', { name: /save changes/i });
    expect(saveBtn).toBeDefined();

    // Click Save Changes
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(mockUpdate).toHaveBeenCalledTimes(1);
      expect(mockUpdate).toHaveBeenCalledWith(
        'quote-123',
        expect.objectContaining({
          title: 'Cloud Migration Project',
          subtotalAmount: 1500,
          totalAmount: 1500,
        }),
      );
    });
  });

  it('offers "Revert to Draft" under More actions when status is AWAITING_APPROVAL', async () => {
    const mockUpdate = vi.mocked(api.quotes.update);
    mockUpdate.mockResolvedValueOnce({
      ...sampleQuote,
      status: 'DRAFT',
    });

    renderWithClient(<QuoteEditorPage initialQuote={sampleQuote} />);

    fireEvent.click(screen.getByRole('button', { name: /more actions/i }));
    const revertBtn = screen.getByRole('menuitem', { name: /revert to draft/i });
    expect(revertBtn).toBeDefined();

    fireEvent.click(revertBtn);

    await waitFor(() => {
      expect(mockUpdate).toHaveBeenCalledWith(
        'quote-123',
        expect.objectContaining({
          status: 'DRAFT',
        }),
      );
    });
  });

  it('only shows Approve and Reject buttons to users with QUOTE_APPROVE permission', () => {
    // Non-approver: only has QUOTE_READ and QUOTE_UPDATE
    mockSession([PERMISSIONS.QUOTE_READ, PERMISSIONS.QUOTE_UPDATE]);

    const { rerender } = renderWithClient(<QuoteEditorPage initialQuote={sampleQuote} />);

    expect(screen.queryByRole('button', { name: /approve quote/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /reject/i })).toBeNull();

    // Approver: has QUOTE_APPROVE
    mockSession([PERMISSIONS.QUOTE_READ, PERMISSIONS.QUOTE_UPDATE, PERMISSIONS.QUOTE_APPROVE]);

    rerender(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <QuoteEditorPage initialQuote={sampleQuote} />
      </QueryClientProvider>,
    );

    expect(screen.getByRole('button', { name: /approve quote/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /reject/i })).toBeDefined();
  });
});

describe('QuoteEditorPage - approve, then send', () => {
  const draft: QuoteDto = { ...sampleQuote, status: 'DRAFT' };
  const approved: QuoteDto = { ...sampleQuote, status: 'APPROVED' };

  beforeEach(() => {
    vi.clearAllMocks();
    mockSession([PERMISSIONS.QUOTE_READ, PERMISSIONS.QUOTE_UPDATE]);
  });

  /** Every quote is signed off before a customer sees it. */
  it('offers no way to send a quote that is not approved', () => {
    renderWithClient(<QuoteEditorPage initialQuote={draft} />);
    expect(screen.queryByRole('button', { name: /send to customer/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /copy link/i })).toBeNull();
    expect(screen.getByRole('button', { name: /submit for approval/i })).toBeDefined();
  });

  it('asks before sending an approved quote, showing who gets it and for how much', async () => {
    vi.mocked(api.quoteAcceptance.send).mockResolvedValueOnce({
      sentTo: 'contact@acme.com',
      url: 'https://app.example.test/q/token',
      expiresAt: '2026-11-01T00:00:00Z',
    });
    renderWithClient(<QuoteEditorPage initialQuote={approved} />);
    expect(screen.getByText(/their acceptance raises the sales order/i)).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: /send to customer/i }));
    expect(api.quoteAcceptance.send).not.toHaveBeenCalled();
    expect(screen.getByText('Send QT-2026-0050 to Acme Corp?')).toBeDefined();
    expect(screen.getAllByText('contact@acme.com').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: /^send quote$/i }));
    await waitFor(() => expect(api.quoteAcceptance.send).toHaveBeenCalledWith('quote-123'));
  });

  it('records an acceptance given another way', async () => {
    vi.mocked(api.quoteAcceptance.markAccepted).mockResolvedValueOnce({
      ...approved,
      acceptedAt: '2026-10-30T09:00:00Z',
      acceptedByName: 'Fatima, PO 4471',
    });
    renderWithClient(<QuoteEditorPage initialQuote={approved} />);

    fireEvent.click(screen.getByRole('button', { name: /mark as accepted/i }));
    fireEvent.change(screen.getByLabelText(/who accepted it/i), { target: { value: 'Fatima, PO 4471' } });
    fireEvent.click(screen.getByRole('button', { name: /record acceptance/i }));

    await waitFor(() =>
      expect(api.quoteAcceptance.markAccepted).toHaveBeenCalledWith('quote-123', { name: 'Fatima, PO 4471' }),
    );
    await waitFor(() => expect(screen.getByText(/Accepted by/)).toBeDefined());
  });
});

describe('QuoteEditorPage - orders, costs and undo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useQuoteSalesOrder).mockReturnValue({ data: null, isLoading: false, refetch: vi.fn() } as never);
  });

  /** Approved before orders waited for acceptance: the order is there, so nothing is left to send. */
  it('shows the order, not Send, on an approved quote that already has one', () => {
    mockSession([PERMISSIONS.QUOTE_READ, PERMISSIONS.QUOTE_UPDATE, PERMISSIONS.QUOTE_CREATE]);
    vi.mocked(useQuoteSalesOrder).mockReturnValue({
      data: { order: { id: 'so-1', orderNumber: 'SO-2026-0001' } },
      isLoading: false,
      refetch: vi.fn(),
    } as never);
    renderWithClient(<QuoteEditorPage initialQuote={{ ...sampleQuote, status: 'APPROVED' }} />);

    expect(screen.getByText('Order raised')).toBeDefined();
    expect(screen.getByRole('link', { name: /SO-2026-0001/ })).toBeDefined();
    expect(screen.queryByRole('button', { name: /send to customer/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /mark as accepted/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /revise/i })).toBeNull();
  });

  /** 500 boxes used to carry the cost of one. */
  it('re-costs a catalog line when its quantity changes, and says when it loses money', () => {
    mockSession([PERMISSIONS.QUOTE_READ, PERMISSIONS.QUOTE_UPDATE, PERMISSIONS.QUOTE_VIEW_COST]);
    const draft: QuoteDto = {
      ...sampleQuote,
      status: 'DRAFT',
      items: [
        {
          id: 'line-1',
          type: 'product',
          description: 'Rigid box',
          catalogItemId: '11111111-1111-4111-8111-111111111111',
          quantity: 1,
          uom: 'boxes',
          unitPrice: 4.6,
          discount: 0,
          taxRate: 0,
          subtotal: 4.6,
          cost: { unitCost: 3.18, totalCost: 3.18, source: 'STANDARD' },
        },
      ],
    };
    renderWithClient(<QuoteEditorPage initialQuote={draft} />);

    fireEvent.change(screen.getByLabelText('Quantity, line 1'), { target: { value: '500' } });
    expect(screen.getByText('Cost $1,590.00')).toBeDefined();
    expect(screen.getByText('30.9% margin')).toBeDefined();

    fireEvent.change(screen.getByLabelText('Discount percent, line 1'), { target: { value: '35' } });
    expect(screen.getByText('−6.4% loss')).toBeDefined();
    expect(screen.getAllByText('· Loss').length).toBeGreaterThan(0);
  });

  it('takes a removed line back on Undo', () => {
    mockSession([PERMISSIONS.QUOTE_READ, PERMISSIONS.QUOTE_UPDATE]);
    renderWithClient(<QuoteEditorPage initialQuote={{ ...sampleQuote, status: 'DRAFT' }} />);

    fireEvent.click(screen.getByRole('button', { name: /remove line 1/i }));
    expect(screen.queryByDisplayValue('Consulting Hours')).toBeNull();

    const [message, options] = vi.mocked(toast).mock.calls.at(-1)!;
    expect(message).toBe('Removed "Consulting Hours"');
    act(() => (options as unknown as { action: { onClick: () => void } }).action.onClick());
    expect(screen.getByDisplayValue('Consulting Hours')).toBeDefined();
  });
});
