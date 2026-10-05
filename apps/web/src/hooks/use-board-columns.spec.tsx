import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { DEFAULT_BOARD_COLUMNS, type ProductionBoardColumn } from '@saas/shared';
import { toast } from 'sonner';
import { useBoardColumns } from './use-board-columns';

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

const mockColumns: ProductionBoardColumn[] = [
  { id: 'planned', name: 'Planned', status: 'PLANNED', color: 'slate', sequence: 0, isDefault: true },
  { id: 'released', name: 'Released', status: 'RELEASED', color: 'blue', sequence: 1, isDefault: true },
  { id: 'in_progress', name: 'In progress', status: 'IN_PROGRESS', color: 'amber', sequence: 2, isDefault: true },
  { id: 'complete', name: 'Complete', status: 'COMPLETE', color: 'emerald', sequence: 3, isDefault: true },
];

let currentCols = [...mockColumns];

vi.mock('@/lib/api/endpoints', () => ({
  api: {
    board: {
      getColumns: vi.fn().mockImplementation(async () => currentCols),
      updateColumns: vi.fn().mockImplementation(async (cols: ProductionBoardColumn[]) => {
        currentCols = [...cols];
        return currentCols;
      }),
    },
    production: {
      board: {
        getColumns: vi.fn().mockImplementation(async () => currentCols),
        updateColumns: vi.fn().mockImplementation(async (cols: ProductionBoardColumn[]) => {
          currentCols = [...cols];
          return currentCols;
        }),
      },
    },
  },
  productionKeys: {
    boardColumns: () => ['production-board-columns'] as const,
  },
}));

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

describe('useBoardColumns', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentCols = [...mockColumns];
  });

  it('loads default columns on initial render', async () => {
    const { result } = renderHook(() => useBoardColumns(), {
      wrapper: createWrapper(),
    });

    expect(result.current.columns).toEqual(DEFAULT_BOARD_COLUMNS);
    await waitFor(() => {
      expect(result.current.columns).toHaveLength(4);
    });
  });

  it('adds a new custom column and normalizes sequences', async () => {
    const { result } = renderHook(() => useBoardColumns(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.addColumn({
        name: 'QC Inspection',
        status: 'IN_PROGRESS',
        color: 'purple',
      });
    });

    await waitFor(() => {
      expect(result.current.columns).toHaveLength(5);
      const qc = result.current.columns.find((c) => c.name === 'QC Inspection');
      expect(qc).toBeDefined();
      expect(qc?.status).toBe('IN_PROGRESS');
      expect(qc?.color).toBe('purple');
      expect(qc?.sequence).toBe(4);
    });
  });

  it('edits an existing column', async () => {
    const { result } = renderHook(() => useBoardColumns(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.editColumn('in_progress', {
        name: 'Floor Active',
        status: 'IN_PROGRESS',
        color: 'cyan',
      });
    });

    await waitFor(() => {
      const col = result.current.columns.find((c) => c.id === 'in_progress');
      expect(col?.name).toBe('Floor Active');
      expect(col?.color).toBe('cyan');
    });
  });

  it('moves column left and right', async () => {
    const { result } = renderHook(() => useBoardColumns(), {
      wrapper: createWrapper(),
    });

    // Move 'released' (idx 1) left -> becomes idx 0
    await act(async () => {
      await result.current.moveColumn('released', 'left');
    });

    await waitFor(() => {
      expect(result.current.columns[0].id).toBe('released');
      expect(result.current.columns[1].id).toBe('planned');
    });

    // Move 'released' (idx 0) right -> back to idx 1
    await act(async () => {
      await result.current.moveColumn('released', 'right');
    });

    await waitFor(() => {
      expect(result.current.columns[0].id).toBe('planned');
      expect(result.current.columns[1].id).toBe('released');
    });
  });

  it('refuses deleting a default column when no other default exists for that status', async () => {
    const { result } = renderHook(() => useBoardColumns(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.deleteColumn('planned');
    });

    expect(toast.error).toHaveBeenCalledWith('Cannot delete default Planned column');
    expect(result.current.columns).toHaveLength(4);
  });

  it('deletes a custom non-default column', async () => {
    currentCols = [
      ...mockColumns,
      {
        id: 'col-qc',
        name: 'QC Inspection',
        status: 'IN_PROGRESS',
        color: 'purple',
        sequence: 4,
        isDefault: false,
      },
    ];

    const { result } = renderHook(() => useBoardColumns(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.deleteColumn('col-qc');
    });

    await waitFor(() => {
      expect(result.current.columns).toHaveLength(4);
      expect(result.current.columns.some((c) => c.id === 'col-qc')).toBe(false);
    });
  });
});
