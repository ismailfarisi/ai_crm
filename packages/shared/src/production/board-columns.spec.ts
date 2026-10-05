import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BOARD_COLUMNS,
  updateBoardColumnsSchema,
  updateWorkOrderColumnSchema,
} from './board-columns';

describe('Production Board Columns', () => {
  it('provides default columns covering all 4 core statuses', () => {
    expect(DEFAULT_BOARD_COLUMNS).toHaveLength(4);
    const statuses = DEFAULT_BOARD_COLUMNS.map((c) => c.status);
    expect(statuses).toEqual(['PLANNED', 'RELEASED', 'IN_PROGRESS', 'COMPLETE']);
    expect(DEFAULT_BOARD_COLUMNS.every((c) => c.isDefault)).toBe(true);
  });

  describe('updateBoardColumnsSchema', () => {
    it('validates a valid set of custom columns', () => {
      const valid = [
        { id: 'col-1', name: 'Planned', status: 'PLANNED', color: 'slate', sequence: 0, isDefault: true },
        { id: 'col-2', name: 'Released', status: 'RELEASED', color: 'blue', sequence: 1, isDefault: true },
        { id: 'col-3', name: 'In progress', status: 'IN_PROGRESS', color: 'amber', sequence: 2, isDefault: true },
        { id: 'col-qc', name: 'Quality Inspection', status: 'IN_PROGRESS', color: 'purple', sequence: 3, isDefault: false },
        { id: 'col-4', name: 'Complete', status: 'COMPLETE', color: 'emerald', sequence: 4, isDefault: true },
      ];
      const result = updateBoardColumnsSchema.safeParse({ columns: valid });
      expect(result.success).toBe(true);
    });

    it('rejects if a core status is missing a default column', () => {
      const invalid = [
        { id: 'col-1', name: 'Planned', status: 'PLANNED', color: 'slate', sequence: 0, isDefault: true },
        { id: 'col-2', name: 'Released', status: 'RELEASED', color: 'blue', sequence: 1, isDefault: true },
        // IN_PROGRESS missing!
        { id: 'col-4', name: 'Complete', status: 'COMPLETE', color: 'emerald', sequence: 2, isDefault: true },
      ];
      const result = updateBoardColumnsSchema.safeParse({ columns: invalid });
      expect(result.success).toBe(false);
    });

    it('rejects duplicate column ids', () => {
      const invalid = [
        { id: 'col-dup', name: 'Planned', status: 'PLANNED', color: 'slate', sequence: 0, isDefault: true },
        { id: 'col-dup', name: 'Released', status: 'RELEASED', color: 'blue', sequence: 1, isDefault: true },
        { id: 'col-3', name: 'In progress', status: 'IN_PROGRESS', color: 'amber', sequence: 2, isDefault: true },
        { id: 'col-4', name: 'Complete', status: 'COMPLETE', color: 'emerald', sequence: 3, isDefault: true },
      ];
      const result = updateBoardColumnsSchema.safeParse({ columns: invalid });
      expect(result.success).toBe(false);
    });

    it('rejects invalid colors or empty column names', () => {
      const invalid = [
        { id: 'col-1', name: '', status: 'PLANNED', color: 'hotpink', sequence: 0, isDefault: true },
        { id: 'col-2', name: 'Released', status: 'RELEASED', color: 'blue', sequence: 1, isDefault: true },
        { id: 'col-3', name: 'In progress', status: 'IN_PROGRESS', color: 'amber', sequence: 2, isDefault: true },
        { id: 'col-4', name: 'Complete', status: 'COMPLETE', color: 'emerald', sequence: 3, isDefault: true },
      ];
      const result = updateBoardColumnsSchema.safeParse({ columns: invalid });
      expect(result.success).toBe(false);
    });
  });

  describe('updateWorkOrderColumnSchema', () => {
    it('validates columnId payload', () => {
      expect(updateWorkOrderColumnSchema.safeParse({ columnId: 'col-qc' }).success).toBe(true);
      expect(updateWorkOrderColumnSchema.safeParse({ columnId: '' }).success).toBe(false);
    });
  });
});
