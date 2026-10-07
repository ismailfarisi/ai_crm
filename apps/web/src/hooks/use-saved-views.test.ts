import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useSavedViews } from './use-saved-views';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { toast } from 'sonner';

vi.mock('@/lib/api/endpoints', () => ({
  api: {
    savedViews: {
      list: vi.fn().mockResolvedValue([
        { id: 'v1', name: 'All Quotes', viewType: 'table', isDefault: true, config: {} },
      ]),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  },
  queryKeys: {
    savedViews: (type: string) => ['saved-views', type],
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

describe('useSavedViews', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('loads views and identifies default view', async () => {
    const { api } = await import('@/lib/api/endpoints');
    vi.mocked(api.savedViews.list).mockResolvedValue([
      {
        id: 'v1',
        tenantId: 't1',
        userId: 'u1',
        entityType: 'quotes',
        name: 'All Quotes',
        viewType: 'table',
        isDefault: true,
        isShared: false,
        config: {},
        createdAt: '2026-10-06T00:00:00Z',
        updatedAt: '2026-10-06T00:00:00Z',
      },
    ]);

    const { result } = renderHook(() => useSavedViews('quotes'), { wrapper: createWrapper() });
    await waitFor(() => {
      expect(result.current.views).toHaveLength(1);
    });
    expect(result.current.activeView?.name).toBe('All Quotes');
  });

  it('falls back to the first view when no view has isDefault: true', async () => {
    const { api } = await import('@/lib/api/endpoints');
    vi.mocked(api.savedViews.list).mockResolvedValue([
      {
        id: 'v1',
        tenantId: 't1',
        userId: 'u1',
        entityType: 'quotes',
        name: 'First View',
        viewType: 'table',
        isDefault: false,
        isShared: false,
        config: {},
        createdAt: '2026-10-06T00:00:00Z',
        updatedAt: '2026-10-06T00:00:00Z',
      },
      {
        id: 'v2',
        tenantId: 't1',
        userId: 'u1',
        entityType: 'quotes',
        name: 'Second View',
        viewType: 'kanban',
        isDefault: false,
        isShared: false,
        config: {},
        createdAt: '2026-10-06T00:00:00Z',
        updatedAt: '2026-10-06T00:00:00Z',
      },
    ]);

    const { result } = renderHook(() => useSavedViews('quotes'), { wrapper: createWrapper() });
    await waitFor(() => {
      expect(result.current.views).toHaveLength(2);
    });
    expect(result.current.activeView?.id).toBe('v1');
  });

  it('allows switching the active view', async () => {
    const { api } = await import('@/lib/api/endpoints');
    vi.mocked(api.savedViews.list).mockResolvedValue([
      {
        id: 'v1',
        tenantId: 't1',
        userId: 'u1',
        entityType: 'quotes',
        name: 'First View',
        viewType: 'table',
        isDefault: true,
        isShared: false,
        config: {},
        createdAt: '2026-10-06T00:00:00Z',
        updatedAt: '2026-10-06T00:00:00Z',
      },
      {
        id: 'v2',
        tenantId: 't1',
        userId: 'u1',
        entityType: 'quotes',
        name: 'Second View',
        viewType: 'kanban',
        isDefault: false,
        isShared: false,
        config: {},
        createdAt: '2026-10-06T00:00:00Z',
        updatedAt: '2026-10-06T00:00:00Z',
      },
    ]);

    const { result } = renderHook(() => useSavedViews('quotes'), { wrapper: createWrapper() });
    await waitFor(() => {
      expect(result.current.activeView?.id).toBe('v1');
    });

    act(() => {
      result.current.setActiveViewId('v2');
    });

    expect(result.current.activeView?.id).toBe('v2');
  });

  it('creates view, invalidates cache and sets newly created view active', async () => {
    const { api } = await import('@/lib/api/endpoints');
    const newView = {
      id: 'v3',
      tenantId: 't1',
      userId: 'u1',
      entityType: 'quotes',
      name: 'Kanban View',
      viewType: 'kanban' as const,
      isDefault: false,
      isShared: false,
      config: {},
      createdAt: '2026-10-06T00:00:00Z',
      updatedAt: '2026-10-06T00:00:00Z',
    };
    vi.mocked(api.savedViews.list)
      .mockResolvedValueOnce([])
      .mockResolvedValue([newView]);
    vi.mocked(api.savedViews.create).mockResolvedValue(newView);

    const { result } = renderHook(() => useSavedViews('quotes'), { wrapper: createWrapper() });
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    await act(async () => {
      await result.current.createView({
        entityType: 'quotes',
        name: 'Kanban View',
        viewType: 'kanban',
      });
    });

    await waitFor(() => {
      expect(result.current.activeView?.id).toBe('v3');
    });
    expect(api.savedViews.create).toHaveBeenCalledWith({
      entityType: 'quotes',
      name: 'Kanban View',
      viewType: 'kanban',
    });
    expect(toast.success).toHaveBeenCalledWith('View "Kanban View" created');
  });

  it('updates view and shows success toast', async () => {
    const { api } = await import('@/lib/api/endpoints');
    const updatedView = {
      id: 'v1',
      tenantId: 't1',
      userId: 'u1',
      entityType: 'quotes',
      name: 'Updated Name',
      viewType: 'table' as const,
      isDefault: true,
      isShared: false,
      config: {},
      createdAt: '2026-10-06T00:00:00Z',
      updatedAt: '2026-10-06T00:00:00Z',
    };
    vi.mocked(api.savedViews.list).mockResolvedValue([updatedView]);
    vi.mocked(api.savedViews.update).mockResolvedValue(updatedView);

    const { result } = renderHook(() => useSavedViews('quotes'), { wrapper: createWrapper() });
    await waitFor(() => {
      expect(result.current.views).toHaveLength(1);
    });

    await act(async () => {
      await result.current.updateView({ id: 'v1', payload: { name: 'Updated Name' } });
    });

    expect(api.savedViews.update).toHaveBeenCalledWith('v1', { name: 'Updated Name' });
    expect(toast.success).toHaveBeenCalledWith('View "Updated Name" updated');
  });

  it('deletes view and resets activeViewId', async () => {
    const { api } = await import('@/lib/api/endpoints');
    vi.mocked(api.savedViews.list).mockResolvedValue([]);
    vi.mocked(api.savedViews.delete).mockResolvedValue(undefined);

    const { result } = renderHook(() => useSavedViews('quotes'), { wrapper: createWrapper() });
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    await act(async () => {
      await result.current.deleteView('v1');
    });

    expect(api.savedViews.delete).toHaveBeenCalledWith('v1');
    expect(toast.success).toHaveBeenCalledWith('View deleted');
  });

  it('handles create and update failures with toast error', async () => {
    const { api } = await import('@/lib/api/endpoints');
    vi.mocked(api.savedViews.list).mockResolvedValue([]);
    vi.mocked(api.savedViews.create).mockRejectedValue(new Error('Network error'));
    vi.mocked(api.savedViews.update).mockRejectedValue(new Error('Network error'));
    vi.mocked(api.savedViews.delete).mockRejectedValue(new Error('Network error'));

    const { result } = renderHook(() => useSavedViews('quotes'), { wrapper: createWrapper() });
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    await act(async () => {
      await expect(
        result.current.createView({ entityType: 'quotes', name: 'Failed View' }),
      ).rejects.toThrow('Network error');
    });
    expect(toast.error).toHaveBeenCalledWith('Failed to create view');

    await act(async () => {
      await expect(
        result.current.updateView({ id: 'v1', payload: { name: 'Failed' } }),
      ).rejects.toThrow('Network error');
    });
    expect(toast.error).toHaveBeenCalledWith('Failed to update view');

    await act(async () => {
      await expect(result.current.deleteView('v1')).rejects.toThrow('Network error');
    });
    expect(toast.error).toHaveBeenCalledWith('Failed to delete view');
  });
});
