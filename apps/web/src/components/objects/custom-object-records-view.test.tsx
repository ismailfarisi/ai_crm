import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CustomObjectRecordsView } from './custom-object-records-view';
import { CustomRecordFormDialog } from './custom-record-form-dialog';
import * as customObjectsHooks from '@/hooks/use-custom-objects';
import type { CustomAttributeDefinitionDto } from '@saas/shared';

vi.mock('@/hooks/use-saved-views', () => ({
  useSavedViews: () => ({ views: [], activeView: null, setActiveViewId: vi.fn() }),
}));

vi.mock('@/hooks/use-custom-objects', () => ({
  useCustomRecords: vi.fn(),
  useCreateCustomRecord: vi.fn(),
  useUpdateCustomRecord: vi.fn(),
}));

function renderWithClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

const mockObject = {
  id: 'obj-1',
  tenantId: 'tenant-1',
  name: 'Machinery',
  singularName: 'Machine',
  slug: 'machinery',
  icon: 'Box',
  primaryAttributeSlug: 'name',
  isArchived: false,
  attributes: [
    { id: 'a1', name: 'Name', slug: 'name', type: 'text', isRequired: true, sortOrder: 0 },
    { id: 'a2', name: 'Serial', slug: 'serial', type: 'text', isRequired: false, sortOrder: 1 },
    {
      id: 'a3',
      name: 'Status',
      slug: 'status',
      type: 'select',
      isRequired: false,
      options: [
        { label: 'Operational', value: 'operational' },
        { label: 'Maintenance', value: 'maintenance' },
      ],
      sortOrder: 2,
    },
  ],
};

const mockRecords = [
  {
    id: 'rec-1',
    tenantId: 'tenant-1',
    objectId: 'obj-1',
    values: { name: 'Line A Packer', serial: 'SN-001', status: 'operational' },
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
  },
];

describe('CustomObjectRecordsView', () => {
  const mockCreateRecord = { mutateAsync: vi.fn().mockResolvedValue({ id: 'rec-2' }), isPending: false };
  const mockUpdateRecord = { mutateAsync: vi.fn().mockResolvedValue({ id: 'rec-1' }), isPending: false };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(customObjectsHooks.useCustomRecords).mockReturnValue({
      data: {
        items: mockRecords,
        total: 1,
        page: 1,
        limit: 50,
        object: mockObject,
      },
      isLoading: false,
    } as any);

    vi.mocked(customObjectsHooks.useCreateCustomRecord).mockReturnValue(mockCreateRecord as any);
    vi.mocked(customObjectsHooks.useUpdateCustomRecord).mockReturnValue(mockUpdateRecord as any);
  });

  it('renders records table with dynamic column headers and values', () => {
    renderWithClient(<CustomObjectRecordsView slug="machinery" />);

    expect(screen.getByText('Line A Packer')).toBeInTheDocument();
    expect(screen.getByText('SN-001')).toBeInTheDocument();
    expect(screen.getByText('Name')).toBeInTheDocument();
    expect(screen.getByText('Serial')).toBeInTheDocument();

    const link = screen.getByRole('link', { name: 'Line A Packer' });
    expect(link).toHaveAttribute('href', '/objects/machinery/rec-1');
  });

  it('opens CustomRecordFormDialog when clicking New button and submits record', async () => {
    renderWithClient(<CustomObjectRecordsView slug="machinery" />);

    const newBtn = screen.getByRole('button', { name: /new machine/i });
    fireEvent.click(newBtn);

    expect(screen.getByRole('heading', { name: /new record/i })).toBeInTheDocument();

    const nameInput = screen.getByLabelText(/name/i);
    fireEvent.change(nameInput, { target: { value: 'Line B Sealer' } });

    const saveBtn = screen.getByRole('button', { name: /save/i });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(mockCreateRecord.mutateAsync).toHaveBeenCalledWith({
        values: expect.objectContaining({ name: 'Line B Sealer' }),
      });
    });
  });

  it('switches to pipeline/kanban view and renders columns from select attribute', async () => {
    renderWithClient(<CustomObjectRecordsView slug="machinery" />);

    const pipelineBtn = screen.getByRole('button', { name: /pipeline/i });
    fireEvent.click(pipelineBtn);

    expect(screen.getByText('Operational')).toBeInTheDocument();
    expect(screen.getByText('Maintenance')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Line A Packer' })).toHaveAttribute('href', '/objects/machinery/rec-1');
  });

  it('handles kanban stage move via drop', async () => {
    renderWithClient(<CustomObjectRecordsView slug="machinery" />);

    const pipelineBtn = screen.getByRole('button', { name: /pipeline/i });
    fireEvent.click(pipelineBtn);

    const maintenanceCol = screen.getByLabelText('Maintenance column');
    fireEvent.drop(maintenanceCol, {
      dataTransfer: {
        getData: (format: string) => (format === 'text/plain' ? 'rec-1' : ''),
      },
    });

    await waitFor(() => {
      expect(mockUpdateRecord.mutateAsync).toHaveBeenCalledWith({
        id: 'rec-1',
        data: {
          values: {
            status: 'maintenance',
          },
        },
      });
    });
  });

  it('falls back to "All Records" column when no select attribute exists in kanban', () => {
    vi.mocked(customObjectsHooks.useCustomRecords).mockReturnValue({
      data: {
        items: mockRecords,
        total: 1,
        page: 1,
        limit: 50,
        object: {
          ...mockObject,
          attributes: [
            { id: 'a1', name: 'Name', slug: 'name', type: 'text', isRequired: true, sortOrder: 0 },
          ],
        },
      },
      isLoading: false,
    } as any);

    renderWithClient(<CustomObjectRecordsView slug="machinery" />);

    const pipelineBtn = screen.getByRole('button', { name: /pipeline/i });
    fireEvent.click(pipelineBtn);

    expect(screen.getByText('All Records')).toBeInTheDocument();
  });

  it('filters records using search input', () => {
    renderWithClient(<CustomObjectRecordsView slug="machinery" />);

    const searchInput = screen.getByPlaceholderText('Search...');
    fireEvent.change(searchInput, { target: { value: 'Packer' } });

    expect(customObjectsHooks.useCustomRecords).toHaveBeenCalledWith('machinery', { search: 'Packer' });
  });

  it('triggers inline update when editing a cell', async () => {
    renderWithClient(<CustomObjectRecordsView slug="machinery" />);

    const serialCell = screen.getByText('SN-001');
    fireEvent.doubleClick(serialCell);

    const input = screen.getByDisplayValue('SN-001');
    fireEvent.change(input, { target: { value: 'SN-002' } });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });

    await waitFor(() => {
      expect(mockUpdateRecord.mutateAsync).toHaveBeenCalledWith({
        id: 'rec-1',
        data: {
          values: {
            serial: 'SN-002',
          },
        },
      });
    });
  });
});

describe('CustomRecordFormDialog', () => {
  const diverseAttributes: CustomAttributeDefinitionDto[] = [
    {
      id: 'attr-num',
      tenantId: 'tenant-1',
      objectId: 'obj-1',
      name: 'Capacity',
      slug: 'capacity',
      type: 'number',
      isRequired: true,
      isUnique: false,
      isSearchable: false,
      sortOrder: 0,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    },
    {
      id: 'attr-bool',
      tenantId: 'tenant-1',
      objectId: 'obj-1',
      name: 'Active',
      slug: 'active',
      type: 'boolean',
      isRequired: false,
      isUnique: false,
      isSearchable: false,
      sortOrder: 1,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    },
    {
      id: 'attr-sel',
      tenantId: 'tenant-1',
      objectId: 'obj-1',
      name: 'Category',
      slug: 'category',
      type: 'select',
      isRequired: false,
      isUnique: false,
      isSearchable: true,
      options: [
        { label: 'Heavy', value: 'heavy' },
        { label: 'Light', value: 'light' },
      ],
      sortOrder: 2,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    },
    {
      id: 'attr-multi',
      tenantId: 'tenant-1',
      objectId: 'obj-1',
      name: 'Tags',
      slug: 'tags',
      type: 'multiselect',
      isRequired: false,
      isUnique: false,
      isSearchable: true,
      options: [
        { label: 'Tag 1', value: 't1' },
        { label: 'Tag 2', value: 't2' },
      ],
      sortOrder: 3,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    },
  ];

  it('renders diverse attribute inputs and submits structured values', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();

    render(
      <CustomRecordFormDialog
        open={true}
        onClose={onClose}
        attributes={diverseAttributes}
        onSubmit={onSubmit}
      />,
    );

    const capInput = screen.getByLabelText(/capacity/i);
    fireEvent.change(capInput, { target: { value: '450' } });

    const activeCheckbox = screen.getByLabelText(/active/i);
    fireEvent.click(activeCheckbox);

    const categorySelect = screen.getByLabelText(/category/i);
    fireEvent.change(categorySelect, { target: { value: 'heavy' } });

    const saveBtn = screen.getByRole('button', { name: /save/i });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          capacity: 450,
          active: true,
          category: 'heavy',
        }),
      );
    });

    expect(onClose).toHaveBeenCalled();
  });

  it('displays error message if submit rejects', async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error('Validation failure'));
    const onClose = vi.fn();

    render(
      <CustomRecordFormDialog
        open={true}
        onClose={onClose}
        attributes={diverseAttributes}
        onSubmit={onSubmit}
      />,
    );

    const capInput = screen.getByLabelText(/capacity/i);
    fireEvent.change(capInput, { target: { value: '100' } });

    const saveBtn = screen.getByRole('button', { name: /save/i });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(screen.getByText('Validation failure')).toBeInTheDocument();
    });

    expect(onClose).not.toHaveBeenCalled();
  });

  it('returns null when open is false', () => {
    const { container } = render(
      <CustomRecordFormDialog
        open={false}
        onClose={vi.fn()}
        attributes={diverseAttributes}
        onSubmit={vi.fn()}
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });
});
