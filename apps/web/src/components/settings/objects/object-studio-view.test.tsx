import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { CustomObjectDefinitionDto } from '@saas/shared';
import { ObjectStudioView } from './object-studio-view';
import { api } from '@/lib/api/endpoints';
import { toast } from 'sonner';

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@/lib/api/endpoints', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/endpoints')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      customObjects: {
        list: vi.fn(),
        getBySlug: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        archive: vi.fn(),
        addAttribute: vi.fn(),
        deleteAttribute: vi.fn(),
        listRecords: vi.fn(),
        getRecord: vi.fn(),
        createRecord: vi.fn(),
        updateRecord: vi.fn(),
        deleteRecord: vi.fn(),
        getReverseLinks: vi.fn(),
      },
    },
  };
});

function renderWithClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
      },
      mutations: {
        retry: false,
      },
    },
  });

  return {
    queryClient,
    ...render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>),
  };
}

const mockObject: CustomObjectDefinitionDto = {
  id: 'obj-1',
  tenantId: 'tenant-1',
  name: 'Vehicles',
  singularName: 'Vehicle',
  slug: 'vehicles',
  icon: 'Box',
  description: 'Fleet vehicle registry',
  primaryAttributeSlug: 'vin',
  isArchived: false,
  attributes: [
    {
      id: 'attr-1',
      tenantId: 'tenant-1',
      objectId: 'obj-1',
      name: 'VIN',
      slug: 'vin',
      type: 'text',
      isRequired: true,
      isUnique: true,
      isSearchable: true,
      sortOrder: 0,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    },
    {
      id: 'attr-2',
      tenantId: 'tenant-1',
      objectId: 'obj-1',
      name: 'Mileage',
      slug: 'mileage',
      type: 'number',
      isRequired: false,
      isUnique: false,
      isSearchable: false,
      sortOrder: 1,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    },
  ],
  relationships: [
    {
      id: 'rel-1',
      tenantId: 'tenant-1',
      sourceObjectId: 'obj-1',
      targetType: 'core_entity',
      targetCoreEntity: 'customer',
      name: 'Assigned Customer',
      slug: 'assigned-customer',
      cardinality: 'many_to_one',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    },
  ],
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

describe('ObjectStudioView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders loading state when fetching custom objects', () => {
    vi.mocked(api.customObjects.list).mockReturnValue(new Promise(() => {}));
    renderWithClient(<ObjectStudioView />);

    expect(screen.getByTestId('object-studio-loading')).toBeInTheDocument();
  });

  it('renders empty state when no custom objects exist', async () => {
    vi.mocked(api.customObjects.list).mockResolvedValue([]);
    renderWithClient(<ObjectStudioView />);

    await waitFor(() => {
      expect(screen.getByText('No custom objects yet')).toBeInTheDocument();
    });
    expect(screen.getAllByRole('button', { name: /new object/i }).length).toBeGreaterThanOrEqual(1);
  });

  it('renders custom object cards with details', async () => {
    vi.mocked(api.customObjects.list).mockResolvedValue([mockObject]);
    renderWithClient(<ObjectStudioView />);

    await waitFor(() => {
      expect(screen.getByText('Vehicles')).toBeInTheDocument();
    });

    expect(screen.getByText('/vehicles')).toBeInTheDocument();
    expect(screen.getByText(/2 attributes/i)).toBeInTheDocument();
    expect(screen.getByText(/1 relationship/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /configure fields/i })).toBeInTheDocument();
  });

  it('opens CreateObjectDialog, auto-slugifies input, and submits successfully', async () => {
    vi.mocked(api.customObjects.list).mockResolvedValue([]);
    vi.mocked(api.customObjects.create).mockResolvedValue({
      ...mockObject,
      name: 'Equipment Assets',
      singularName: 'Equipment Asset',
      slug: 'equipment-assets',
      primaryAttributeSlug: 'serial-number',
    });

    const { queryClient } = renderWithClient(<ObjectStudioView />);

    await waitFor(() => {
      expect(screen.getByText('No custom objects yet')).toBeInTheDocument();
    });

    const newObjButton = screen.getAllByRole('button', { name: /new object/i })[0];
    fireEvent.click(newObjButton);

    expect(screen.getByRole('heading', { name: /create custom object/i })).toBeInTheDocument();

    const pluralInput = screen.getByLabelText(/plural name/i);
    const singularInput = screen.getByLabelText(/singular name/i);
    const slugInput = screen.getByLabelText(/^slug/i);
    const primaryAttrInput = screen.getByLabelText(/primary.*attribute/i);

    fireEvent.change(pluralInput, { target: { value: 'Equipment Assets' } });
    // Slug should auto-slugify
    expect(slugInput).toHaveValue('equipment-assets');

    fireEvent.change(singularInput, { target: { value: 'Equipment Asset' } });
    fireEvent.change(primaryAttrInput, { target: { value: 'serial-number' } });

    const submitBtn = screen.getByRole('button', { name: /create object/i });
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(api.customObjects.create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Equipment Assets',
          singularName: 'Equipment Asset',
          slug: 'equipment-assets',
          primaryAttributeSlug: 'serial-number',
        }),
      );
    });

    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: ['custom-objects'] }),
    );
    expect(toast.success).toHaveBeenCalledWith(expect.stringMatching(/created/i));
  });

  it('opens AttributeEditorDrawer when clicking Configure Fields and manages attributes', async () => {
    vi.mocked(api.customObjects.list).mockResolvedValue([mockObject]);
    vi.mocked(api.customObjects.getBySlug).mockResolvedValue(mockObject);
    vi.mocked(api.customObjects.addAttribute).mockResolvedValue({
      id: 'attr-3',
      tenantId: 'tenant-1',
      objectId: 'obj-1',
      name: 'Fuel Type',
      slug: 'fuel-type',
      type: 'select',
      isRequired: true,
      isUnique: false,
      isSearchable: true,
      sortOrder: 2,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    });
    vi.mocked(api.customObjects.deleteAttribute).mockResolvedValue();

    const { queryClient } = renderWithClient(<ObjectStudioView />);

    await waitFor(() => {
      expect(screen.getByText('Vehicles')).toBeInTheDocument();
    });

    const configureBtn = screen.getByRole('button', { name: /configure fields/i });
    fireEvent.click(configureBtn);

    // Drawer should show object attributes
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /vehicles fields/i })).toBeInTheDocument();
    });

    expect(screen.getByText('VIN')).toBeInTheDocument();
    expect(screen.getByText('Mileage')).toBeInTheDocument();

    // Adding a new attribute
    const attrNameInput = screen.getByLabelText(/attribute name/i);
    const attrSlugInput = screen.getByLabelText(/attribute slug/i);
    const attrTypeSelect = screen.getByLabelText(/attribute type/i);

    fireEvent.change(attrNameInput, { target: { value: 'Fuel Type' } });
    expect(attrSlugInput).toHaveValue('fuel-type');

    fireEvent.change(attrTypeSelect, { target: { value: 'select' } });

    const addAttrBtn = screen.getByRole('button', { name: /add attribute/i });
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    fireEvent.click(addAttrBtn);

    await waitFor(() => {
      expect(api.customObjects.addAttribute).toHaveBeenCalledWith(
        'vehicles',
        expect.objectContaining({
          name: 'Fuel Type',
          slug: 'fuel-type',
          type: 'select',
        }),
      );
    });
    expect(toast.success).toHaveBeenCalledWith(expect.stringMatching(/attribute added/i));
    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: ['custom-objects'] }),
    );

    // Deleting an attribute
    const deleteMileageBtn = screen.getByTestId('delete-attribute-mileage');
    fireEvent.click(deleteMileageBtn);

    await waitFor(() => {
      expect(api.customObjects.deleteAttribute).toHaveBeenCalledWith('vehicles', 'mileage');
    });
    expect(toast.success).toHaveBeenCalledWith(expect.stringMatching(/attribute deleted/i));

    // Close drawer
    const closeBtn = screen.getByRole('button', { name: /close drawer/i });
    fireEvent.click(closeBtn);

    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: /vehicles fields/i })).not.toBeInTheDocument();
    });
  });
});
