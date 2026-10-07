import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ContactsView } from './contacts-view';

const mockUseContacts = vi.fn();
const mockUpdateContact = vi.fn();

vi.mock('@/lib/session-context', () => ({
  useSession: () => ({
    can: () => true,
    check: () => true,
    session: { user: { id: 'u-1', teamId: 't-1' } },
  }),
}));

vi.mock('@/hooks/use-contacts', () => ({
  useContacts: () => mockUseContacts(),
  useCreateContact: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteContact: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateContact: () => ({ mutateAsync: mockUpdateContact, isPending: false }),
}));

vi.mock('@/hooks/use-saved-views', () => ({
  useSavedViews: () => ({
    views: [],
    activeView: null,
    setActiveViewId: vi.fn(),
    isLoading: false,
  }),
}));

vi.mock('@/lib/api/endpoints', () => ({
  api: {
    users: { list: vi.fn().mockResolvedValue([]) },
    contacts: {
      list: vi.fn(),
      update: vi.fn(),
      remove: vi.fn(),
    },
  },
  queryKeys: {
    users: ['users'],
    contacts: (p: any) => ['contacts', p],
  },
}));

function renderWithClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

describe('ContactsView', () => {
  const sampleContacts = [
    {
      id: 'c-1',
      tenantId: 'tenant-1',
      fullName: 'Alice Johnson',
      email: 'alice@example.com',
      company: 'Acme Corp',
      jobTitle: 'Head of Ops',
      status: 'lead' as const,
      source: 'website' as const,
      createdAt: '2026-10-01T00:00:00Z',
      updatedAt: '2026-10-01T00:00:00Z',
    },
    {
      id: 'c-2',
      tenantId: 'tenant-1',
      fullName: 'Bob Smith',
      email: 'bob@example.com',
      company: 'Beta LLC',
      jobTitle: 'VP Engineering',
      status: 'qualified' as const,
      source: 'referral' as const,
      createdAt: '2026-10-02T00:00:00Z',
      updatedAt: '2026-10-02T00:00:00Z',
    },
  ];

  it('renders Table and Pipeline view switchers and contact data in table view', () => {
    mockUseContacts.mockReturnValue({
      data: { items: sampleContacts, total: 2 },
      isPending: false,
      isError: false,
      error: null,
    });

    renderWithClient(<ContactsView />);

    expect(screen.getByText('Table')).toBeDefined();
    expect(screen.getByText('Pipeline')).toBeDefined();
    expect(screen.getByText('Alice Johnson')).toBeDefined();
    expect(screen.getByText('Bob Smith')).toBeDefined();
  });

  it('switches to Pipeline view and displays Kanban columns', () => {
    mockUseContacts.mockReturnValue({
      data: { items: sampleContacts, total: 2 },
      isPending: false,
      isError: false,
      error: null,
    });

    renderWithClient(<ContactsView />);

    const pipelineButton = screen.getByText('Pipeline');
    fireEvent.click(pipelineButton);

    expect(screen.getByRole('region', { name: 'Lead column' })).toBeDefined();
    expect(screen.getByRole('region', { name: 'Qualified column' })).toBeDefined();
    expect(screen.getByRole('region', { name: 'Customer column' })).toBeDefined();
    expect(screen.getByRole('region', { name: 'Churned column' })).toBeDefined();
    expect(screen.getByRole('region', { name: 'Archived column' })).toBeDefined();
  });

  it('allows moving contact stage in Kanban via drop', async () => {
    mockUseContacts.mockReturnValue({
      data: { items: sampleContacts, total: 2 },
      isPending: false,
      isError: false,
      error: null,
    });

    renderWithClient(<ContactsView />);

    const pipelineButton = screen.getByText('Pipeline');
    fireEvent.click(pipelineButton);

    const qualifiedColumn = screen.getByRole('region', { name: 'Qualified column' });
    fireEvent.drop(qualifiedColumn, {
      dataTransfer: {
        getData: (format: string) => (format === 'text/plain' ? 'c-1' : ''),
      },
    });

    expect(mockUpdateContact).toHaveBeenCalledWith({
      id: 'c-1',
      input: { status: 'qualified' },
    });
  });
});
