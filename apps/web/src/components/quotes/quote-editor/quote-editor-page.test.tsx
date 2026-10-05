import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { QuoteEditorPage } from './quote-editor-page';
import { api } from '@/lib/api/endpoints';
import { useSession } from '@/lib/session-context';
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
  useQuoteSalesOrder: () => ({ data: null, isLoading: false }),
}));

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

  it('renders "Revert to Draft" button when status is AWAITING_APPROVAL', async () => {
    const mockUpdate = vi.mocked(api.quotes.update);
    mockUpdate.mockResolvedValueOnce({
      ...sampleQuote,
      status: 'DRAFT',
    });

    renderWithClient(<QuoteEditorPage initialQuote={sampleQuote} />);

    const revertBtn = screen.getByRole('button', { name: /revert to draft/i });
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
