import { describe, it, expect } from 'vitest';
import { createSavedViewSchema, updateSavedViewSchema } from './saved-view';

describe('SavedView Zod Schemas', () => {
  it('validates a valid create saved view payload', () => {
    const input = {
      entityType: 'quotes',
      name: 'High Value Quotes',
      viewType: 'kanban',
      isDefault: false,
      isShared: true,
      config: {
        columns: [{ key: 'title', visible: true, width: 200 }],
        filters: [{ field: 'totalAmount', operator: 'gte', value: 10000 }],
        sort: { field: 'totalAmount', direction: 'desc' },
      },
    };
    const result = createSavedViewSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe('High Value Quotes');
      expect(result.data.viewType).toBe('kanban');
    }
  });

  it('rejects an invalid viewType', () => {
    const input = {
      entityType: 'quotes',
      name: 'Test View',
      viewType: 'invalid_layout',
    };
    const result = createSavedViewSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it('applies defaults for optional fields', () => {
    const input = {
      entityType: 'contacts',
      name: 'All Contacts',
    };
    const result = createSavedViewSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.viewType).toBe('table');
      expect(result.data.isDefault).toBe(false);
      expect(result.data.isShared).toBe(false);
      expect(result.data.config).toEqual({});
    }
  });

  it('rejects empty name or invalid string constraints', () => {
    const input = {
      entityType: 'quotes',
      name: '   ',
    };
    const result = createSavedViewSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it('validates kanban configuration in config', () => {
    const input = {
      entityType: 'quotes',
      name: 'Pipeline',
      viewType: 'kanban',
      config: {
        kanban: {
          groupField: 'status',
          collapsedColumns: ['draft', 'cancelled'],
        },
      },
    };
    const result = createSavedViewSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.config?.kanban?.groupField).toBe('status');
      expect(result.data.config?.kanban?.collapsedColumns).toEqual(['draft', 'cancelled']);
    }
  });

  it('validates a partial update schema', () => {
    const input = {
      name: 'Renamed View',
      isShared: false,
    };
    const result = updateSavedViewSchema.safeParse(input);
    expect(result.success).toBe(true);
  });
});
