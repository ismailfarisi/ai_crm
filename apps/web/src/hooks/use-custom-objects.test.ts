import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { toast } from 'sonner';
import { apiFetch } from '@/lib/api/client';
import {
  api,
  queryKeys,
  customObjectsEndpoints,
  customObjectsKeys,
  customObjectsApi,
} from '@/lib/api/endpoints';
import {
  useCustomObjects,
  useCustomObject,
  useCustomRecords,
  useCreateCustomRecord,
  useUpdateCustomRecord,
  useCustomRecord,
  useDeleteCustomRecord,
  useReverseLinks,
} from './use-custom-objects';

vi.mock('@/lib/api/client', () => ({
  apiFetch: vi.fn(),
  ApiError: class ApiError extends Error {
    status: number;
    constructor(message: string, status = 400) {
      super(message);
      this.status = status;
    }
    get isForbidden() {
      return this.status === 403;
    }
  },
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

function createWrapper() {
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
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

describe('customObjectsEndpoints & customObjectsKeys', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('exposes customObjectsApi alias matching customObjectsEndpoints.customObjects', () => {
    expect(customObjectsApi).toBe(customObjectsEndpoints.customObjects);
    expect(api.customObjects).toBe(customObjectsEndpoints.customObjects);
  });

  it('customObjectsEndpoints invokes apiFetch with correct endpoints and payloads', async () => {
    const mockedApiFetch = vi.mocked(apiFetch);

    // list
    mockedApiFetch.mockResolvedValueOnce([]);
    await customObjectsEndpoints.customObjects.list();
    expect(mockedApiFetch).toHaveBeenCalledWith('/custom-objects');

    // getBySlug
    mockedApiFetch.mockResolvedValueOnce({ slug: 'equipment' });
    await customObjectsEndpoints.customObjects.getBySlug('equipment');
    expect(mockedApiFetch).toHaveBeenCalledWith('/custom-objects/equipment');

    // create
    const createData = {
      name: 'Equipments',
      singularName: 'Equipment',
      slug: 'equipment',
      icon: 'Box',
      primaryAttributeSlug: 'name',
    };
    mockedApiFetch.mockResolvedValueOnce({ ...createData, id: 'o1' });
    await customObjectsEndpoints.customObjects.create(createData);
    expect(mockedApiFetch).toHaveBeenCalledWith('/custom-objects', {
      method: 'POST',
      body: createData,
    });

    // update
    const updateData = { name: 'Machinery' };
    mockedApiFetch.mockResolvedValueOnce({ id: 'o1', ...updateData });
    await customObjectsEndpoints.customObjects.update('equipment', updateData);
    expect(mockedApiFetch).toHaveBeenCalledWith('/custom-objects/equipment', {
      method: 'PATCH',
      body: updateData,
    });

    // archive
    mockedApiFetch.mockResolvedValueOnce(undefined);
    await customObjectsEndpoints.customObjects.archive('equipment');
    expect(mockedApiFetch).toHaveBeenCalledWith('/custom-objects/equipment', {
      method: 'DELETE',
    });

    // addAttribute
    const attrData = {
      name: 'Serial Number',
      slug: 'serial_number',
      type: 'text' as const,
      isRequired: true,
      isUnique: false,
      isSearchable: true,
      sortOrder: 0,
    };
    mockedApiFetch.mockResolvedValueOnce({ id: 'a1', ...attrData });
    await customObjectsEndpoints.customObjects.addAttribute('equipment', attrData);
    expect(mockedApiFetch).toHaveBeenCalledWith('/custom-objects/equipment/attributes', {
      method: 'POST',
      body: attrData,
    });

    // deleteAttribute
    mockedApiFetch.mockResolvedValueOnce(undefined);
    await customObjectsEndpoints.customObjects.deleteAttribute('equipment', 'serial_number');
    expect(mockedApiFetch).toHaveBeenCalledWith('/custom-objects/equipment/attributes/serial_number', {
      method: 'DELETE',
    });

    // listRecords
    mockedApiFetch.mockResolvedValueOnce({ items: [], total: 0 });
    await customObjectsEndpoints.customObjects.listRecords('equipment', { page: 1, limit: 10, search: 'drill' });
    expect(mockedApiFetch).toHaveBeenCalledWith('/objects/equipment/records', {
      query: { page: 1, limit: 10, search: 'drill' },
    });

    // getRecord
    mockedApiFetch.mockResolvedValueOnce({ id: 'r1', values: {} });
    await customObjectsEndpoints.customObjects.getRecord('equipment', 'r1');
    expect(mockedApiFetch).toHaveBeenCalledWith('/objects/equipment/records/r1');

    // createRecord
    const recordPayload = { values: { serial_number: 'SN-100' } };
    mockedApiFetch.mockResolvedValueOnce({ id: 'r2', ...recordPayload });
    await customObjectsEndpoints.customObjects.createRecord('equipment', recordPayload);
    expect(mockedApiFetch).toHaveBeenCalledWith('/objects/equipment/records', {
      method: 'POST',
      body: recordPayload,
    });

    // updateRecord
    const updateRecordPayload = { values: { serial_number: 'SN-101' } };
    mockedApiFetch.mockResolvedValueOnce({ id: 'r2', ...updateRecordPayload });
    await customObjectsEndpoints.customObjects.updateRecord('equipment', 'r2', updateRecordPayload);
    expect(mockedApiFetch).toHaveBeenCalledWith('/objects/equipment/records/r2', {
      method: 'PATCH',
      body: updateRecordPayload,
    });

    // deleteRecord
    mockedApiFetch.mockResolvedValueOnce(undefined);
    await customObjectsEndpoints.customObjects.deleteRecord('equipment', 'r2');
    expect(mockedApiFetch).toHaveBeenCalledWith('/objects/equipment/records/r2', {
      method: 'DELETE',
    });

    // getReverseLinks
    mockedApiFetch.mockResolvedValueOnce([]);
    await customObjectsEndpoints.customObjects.getReverseLinks('customer', 'c1');
    expect(mockedApiFetch).toHaveBeenCalledWith('/objects/links/reverse', {
      query: { targetType: 'customer', targetId: 'c1' },
    });
  });

  it('customObjectsKeys generates correct query keys', () => {
    expect(customObjectsKeys.customObjects.all).toEqual(['custom-objects']);
    expect(queryKeys.customObjects.all).toEqual(['custom-objects']);

    expect(customObjectsKeys.customObjects.bySlug('equipment')).toEqual(['custom-objects', 'equipment']);
    expect(queryKeys.customObjects.bySlug('equipment')).toEqual(['custom-objects', 'equipment']);

    expect(customObjectsKeys.customObjects.records('equipment')).toEqual(['custom-objects', 'equipment', 'records']);
    expect(customObjectsKeys.customObjects.records('equipment', { page: 2 })).toEqual([
      'custom-objects',
      'equipment',
      'records',
      { page: 2 },
    ]);

    expect(customObjectsKeys.customObjects.record('equipment', 'r1')).toEqual([
      'custom-objects',
      'equipment',
      'records',
      'r1',
    ]);

    expect(customObjectsKeys.customObjects.reverseLinks('customer', 'c1')).toEqual([
      'custom-objects',
      'reverse-links',
      'customer',
      'c1',
    ]);
  });
});

describe('useCustomObjects hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('useCustomObjects loads custom objects list', async () => {
    const objects = [
      {
        id: 'o1',
        tenantId: 't1',
        name: 'Equipments',
        singularName: 'Equipment',
        slug: 'equipment',
        icon: 'Box',
        primaryAttributeSlug: 'name',
        isArchived: false,
        createdAt: '2026-10-07T00:00:00Z',
        updatedAt: '2026-10-07T00:00:00Z',
      },
    ];
    vi.mocked(apiFetch).mockResolvedValueOnce(objects);

    const { result } = renderHook(() => useCustomObjects(), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data).toEqual(objects);
    expect(apiFetch).toHaveBeenCalledWith('/custom-objects');
  });

  it('useCustomObject loads custom object by slug and respects enabled flag', async () => {
    const object = {
      id: 'o1',
      tenantId: 't1',
      name: 'Equipments',
      singularName: 'Equipment',
      slug: 'equipment',
      icon: 'Box',
      primaryAttributeSlug: 'name',
      isArchived: false,
      createdAt: '2026-10-07T00:00:00Z',
      updatedAt: '2026-10-07T00:00:00Z',
    };
    vi.mocked(apiFetch).mockResolvedValueOnce(object);

    const { result } = renderHook(() => useCustomObject('equipment'), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data).toEqual(object);
    expect(apiFetch).toHaveBeenCalledWith('/custom-objects/equipment');

    // Enabled check: empty slug should not fetch
    vi.clearAllMocks();
    const { result: disabledResult } = renderHook(() => useCustomObject(''), { wrapper: createWrapper() });
    expect(disabledResult.current.fetchStatus).toBe('idle');
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it('useCustomRecords loads records with params', async () => {
    const recordsResponse = {
      items: [
        {
          id: 'r1',
          tenantId: 't1',
          objectId: 'o1',
          values: { name: 'Generator 500' },
          createdAt: '2026-10-07T00:00:00Z',
          updatedAt: '2026-10-07T00:00:00Z',
        },
      ],
      total: 1,
      page: 1,
      limit: 25,
    };
    vi.mocked(apiFetch).mockResolvedValueOnce(recordsResponse);

    const params = { page: 1, limit: 25, search: 'Gen' };
    const { result } = renderHook(() => useCustomRecords('equipment', params), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data).toEqual(recordsResponse);
    expect(apiFetch).toHaveBeenCalledWith('/objects/equipment/records', { query: params });
  });

  it('useCreateCustomRecord creates record, invalidates queries and shows success toast', async () => {
    const createdRecord = {
      id: 'r1',
      tenantId: 't1',
      objectId: 'o1',
      values: { name: 'Bulldozer X' },
      createdAt: '2026-10-07T00:00:00Z',
      updatedAt: '2026-10-07T00:00:00Z',
    };
    vi.mocked(apiFetch).mockResolvedValueOnce(createdRecord);

    const { result } = renderHook(() => useCreateCustomRecord('equipment'), { wrapper: createWrapper() });

    await act(async () => {
      await result.current.mutateAsync({ values: { name: 'Bulldozer X' } });
    });

    expect(apiFetch).toHaveBeenCalledWith('/objects/equipment/records', {
      method: 'POST',
      body: { values: { name: 'Bulldozer X' } },
    });
    expect(toast.success).toHaveBeenCalledWith('Record created');
  });

  it('useCreateCustomRecord handles error with toast', async () => {
    vi.mocked(apiFetch).mockRejectedValueOnce(new Error('Validation failed'));

    const { result } = renderHook(() => useCreateCustomRecord('equipment'), { wrapper: createWrapper() });

    await act(async () => {
      await expect(result.current.mutateAsync({ values: {} })).rejects.toThrow('Validation failed');
    });

    expect(toast.error).toHaveBeenCalledWith('Failed to create record');
  });

  it('useUpdateCustomRecord updates record, invalidates queries and shows success toast', async () => {
    const updatedRecord = {
      id: 'r1',
      tenantId: 't1',
      objectId: 'o1',
      values: { name: 'Bulldozer X Updated' },
      createdAt: '2026-10-07T00:00:00Z',
      updatedAt: '2026-10-07T00:00:00Z',
    };
    vi.mocked(apiFetch).mockResolvedValueOnce(updatedRecord);

    const { result } = renderHook(() => useUpdateCustomRecord('equipment'), { wrapper: createWrapper() });

    await act(async () => {
      await result.current.mutateAsync({
        id: 'r1',
        data: { values: { name: 'Bulldozer X Updated' } },
      });
    });

    expect(apiFetch).toHaveBeenCalledWith('/objects/equipment/records/r1', {
      method: 'PATCH',
      body: { values: { name: 'Bulldozer X Updated' } },
    });
    expect(toast.success).toHaveBeenCalledWith('Record updated');
  });

  it('useUpdateCustomRecord handles error with toast', async () => {
    vi.mocked(apiFetch).mockRejectedValueOnce(new Error('Update failed'));

    const { result } = renderHook(() => useUpdateCustomRecord('equipment'), { wrapper: createWrapper() });

    await act(async () => {
      await expect(
        result.current.mutateAsync({ id: 'r1', data: { values: {} } }),
      ).rejects.toThrow('Update failed');
    });

    expect(toast.error).toHaveBeenCalledWith('Failed to update record');
  });

  it('useCustomRecord loads single record and respects enabled', async () => {
    const record = {
      id: 'r1',
      tenantId: 't1',
      objectId: 'o1',
      values: { name: 'Generator 500' },
      createdAt: '2026-10-07T00:00:00Z',
      updatedAt: '2026-10-07T00:00:00Z',
    };
    vi.mocked(apiFetch).mockResolvedValueOnce(record);

    const { result } = renderHook(() => useCustomRecord('equipment', 'r1'), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data).toEqual(record);
    expect(apiFetch).toHaveBeenCalledWith('/objects/equipment/records/r1');

    vi.clearAllMocks();
    const { result: disabled } = renderHook(() => useCustomRecord('', ''), { wrapper: createWrapper() });
    expect(disabled.current.fetchStatus).toBe('idle');
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it('useDeleteCustomRecord deletes record, invalidates queries and displays toast', async () => {
    vi.mocked(apiFetch).mockResolvedValueOnce(undefined);

    const { result } = renderHook(() => useDeleteCustomRecord('equipment'), { wrapper: createWrapper() });

    await act(async () => {
      await result.current.mutateAsync('r1');
    });

    expect(apiFetch).toHaveBeenCalledWith('/objects/equipment/records/r1', {
      method: 'DELETE',
    });
    expect(toast.success).toHaveBeenCalledWith('Record deleted');

    vi.mocked(apiFetch).mockRejectedValueOnce(new Error('Delete error'));
    await act(async () => {
      await expect(result.current.mutateAsync('r1')).rejects.toThrow('Delete error');
    });
    expect(toast.error).toHaveBeenCalledWith('Failed to delete record');
  });

  it('useReverseLinks loads reverse links and respects enabled', async () => {
    const links = [
      {
        id: 'l1',
        tenantId: 't1',
        relationshipId: 'rel1',
        sourceRecordId: 'r1',
        targetType: 'customer',
        targetRecordId: 'c1',
        createdAt: '2026-10-07T00:00:00Z',
      },
    ];
    vi.mocked(apiFetch).mockResolvedValueOnce(links);

    const { result } = renderHook(() => useReverseLinks('customer', 'c1'), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data).toEqual(links);
    expect(apiFetch).toHaveBeenCalledWith('/objects/links/reverse', {
      query: { targetType: 'customer', targetId: 'c1' },
    });

    vi.clearAllMocks();
    const { result: disabled } = renderHook(() => useReverseLinks('', ''), { wrapper: createWrapper() });
    expect(disabled.current.fetchStatus).toBe('idle');
    expect(apiFetch).not.toHaveBeenCalled();
  });
});
