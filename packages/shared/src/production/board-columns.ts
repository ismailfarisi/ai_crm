import { z } from 'zod';
import type { WorkOrderStatus } from './work-orders';

export const BOARD_COLUMN_COLORS = [
  'slate',
  'blue',
  'amber',
  'purple',
  'emerald',
  'rose',
  'cyan',
] as const;

export type BoardColumnColor = (typeof BOARD_COLUMN_COLORS)[number];

export interface ProductionBoardColumn {
  id: string;
  name: string;
  status: WorkOrderStatus;
  color: BoardColumnColor;
  sequence: number;
  isDefault?: boolean;
}

export const DEFAULT_BOARD_COLUMNS: ProductionBoardColumn[] = [
  { id: 'planned', name: 'Planned', status: 'PLANNED', color: 'slate', sequence: 0, isDefault: true },
  { id: 'released', name: 'Released', status: 'RELEASED', color: 'blue', sequence: 1, isDefault: true },
  { id: 'in_progress', name: 'In progress', status: 'IN_PROGRESS', color: 'amber', sequence: 2, isDefault: true },
  { id: 'complete', name: 'Complete', status: 'COMPLETE', color: 'emerald', sequence: 3, isDefault: true },
];

const boardColumnSchema = z.object({
  id: z.string().trim().min(1, 'Column ID is required').max(60),
  name: z.string().trim().min(1, 'Column name is required').max(60),
  status: z.enum(['PLANNED', 'RELEASED', 'IN_PROGRESS', 'COMPLETE']),
  color: z.enum(BOARD_COLUMN_COLORS),
  sequence: z.number().int().min(0),
  isDefault: z.boolean().optional(),
});

export const updateBoardColumnsSchema = z.object({
  columns: z
    .array(boardColumnSchema)
    .min(4, 'Board must have at least 4 columns')
    .refine(
      (cols) => {
        const ids = new Set(cols.map((c) => c.id));
        return ids.size === cols.length;
      },
      { message: 'Column IDs must be unique' },
    )
    .refine(
      (cols) => {
        const requiredStatuses: WorkOrderStatus[] = ['PLANNED', 'RELEASED', 'IN_PROGRESS', 'COMPLETE'];
        return requiredStatuses.every((status) =>
          cols.some((c) => c.status === status && c.isDefault === true),
        );
      },
      { message: 'Each core status (PLANNED, RELEASED, IN_PROGRESS, COMPLETE) must have a default column' },
    ),
});

export const updateWorkOrderColumnSchema = z.object({
  columnId: z.string().trim().min(1, 'Column ID is required').max(60),
});

export type UpdateBoardColumnsPayload = z.output<typeof updateBoardColumnsSchema>;
export type UpdateWorkOrderColumnPayload = z.output<typeof updateWorkOrderColumnSchema>;
