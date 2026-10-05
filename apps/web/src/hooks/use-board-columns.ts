import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  DEFAULT_BOARD_COLUMNS,
  type BoardColumnColor,
  type ProductionBoardColumn,
  type WorkOrderStatus,
} from '@saas/shared';
import { api, productionKeys } from '@/lib/api/endpoints';

export function useBoardColumns() {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: productionKeys.boardColumns(),
    queryFn: () =>
      api.production?.board
        ? api.production.board.getColumns()
        : api.board.getColumns(),
    placeholderData: DEFAULT_BOARD_COLUMNS,
  });

  const columns = query.data || DEFAULT_BOARD_COLUMNS;

  const mutation = useMutation({
    mutationFn: (newColumns: ProductionBoardColumn[]) => {
      const normalized = newColumns.map((col, idx) => ({
        ...col,
        sequence: idx,
      }));
      return api.production?.board
        ? api.production.board.updateColumns(normalized)
        : api.board.updateColumns(normalized);
    },
    onSuccess: (updated) => {
      queryClient.setQueryData(productionKeys.boardColumns(), updated);
      queryClient.invalidateQueries({ queryKey: ['work-orders'] });
    },
    onError: (err: any) => {
      toast.error(err?.message || 'Failed to update board columns');
    },
  });

  const addColumn = async (newCol: {
    id?: string;
    name: string;
    status: WorkOrderStatus;
    color: BoardColumnColor;
  }) => {
    const slug = newCol.name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]/g, '_')
      .replace(/_+/g, '_')
      .slice(0, 30);
    const id = newCol.id || `col_${slug || 'custom'}_${Date.now().toString(36)}`;
    const fullCol: ProductionBoardColumn = {
      id,
      name: newCol.name.trim(),
      status: newCol.status,
      color: newCol.color,
      sequence: columns.length,
      isDefault: false,
    };
    return mutation.mutateAsync([...columns, fullCol]);
  };

  const editColumn = async (
    columnId: string,
    updates: {
      name: string;
      status: WorkOrderStatus;
      color: BoardColumnColor;
    },
  ) => {
    const updatedCols = columns.map((col) =>
      col.id === columnId
        ? {
            ...col,
            name: updates.name.trim(),
            status: updates.status,
            color: updates.color,
          }
        : col,
    );
    return mutation.mutateAsync(updatedCols);
  };

  const deleteColumn = async (columnId: string) => {
    const target = columns.find((c) => c.id === columnId);
    if (!target) return;
    if (target.isDefault) {
      // Check if there is another default column for this status
      const hasOtherDefault = columns.some(
        (c) => c.id !== columnId && c.status === target.status && c.isDefault,
      );
      if (!hasOtherDefault) {
        toast.error(`Cannot delete default ${target.name} column`);
        return;
      }
    }
    const filtered = columns
      .filter((c) => c.id !== columnId)
      .map((col, idx) => ({ ...col, sequence: idx }));
    return mutation.mutateAsync(filtered);
  };

  const moveColumn = async (columnId: string, direction: 'left' | 'right') => {
    const idx = columns.findIndex((c) => c.id === columnId);
    if (idx === -1) return;
    const targetIdx = direction === 'left' ? idx - 1 : idx + 1;
    if (targetIdx < 0 || targetIdx >= columns.length) return;

    const reordered = [...columns];
    const [moved] = reordered.splice(idx, 1);
    reordered.splice(targetIdx, 0, moved);

    const normalized = reordered.map((col, i) => ({ ...col, sequence: i }));
    return mutation.mutateAsync(normalized);
  };

  return {
    columns,
    isLoading: query.isLoading,
    updateColumns: mutation.mutateAsync,
    addColumn,
    editColumn,
    deleteColumn,
    moveColumn,
    isUpdating: mutation.isPending,
  };
}
