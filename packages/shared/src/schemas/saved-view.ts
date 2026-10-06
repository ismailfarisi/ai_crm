import { z } from 'zod';

export const VIEW_LAYOUT_TYPES = ['table', 'kanban'] as const;
export const FILTER_OPERATORS = [
  'eq',
  'neq',
  'gt',
  'gte',
  'lt',
  'lte',
  'contains',
  'in',
] as const;

export const columnConfigSchema = z.object({
  key: z.string().trim().min(1),
  visible: z.boolean(),
  width: z.number().positive().optional(),
  sortOrder: z.number().int().optional(),
});

export const filterRuleSchema = z.object({
  field: z.string().trim().min(1),
  operator: z.enum(FILTER_OPERATORS),
  value: z.any(),
});

export const sortConfigSchema = z.object({
  field: z.string().trim().min(1),
  direction: z.enum(['asc', 'desc']),
});

export const kanbanConfigSchema = z.object({
  groupField: z.string().trim().min(1),
  collapsedColumns: z.array(z.string()).optional(),
});

export const savedViewConfigSchema = z.object({
  columns: z.array(columnConfigSchema).optional(),
  filters: z.array(filterRuleSchema).optional(),
  sort: sortConfigSchema.optional(),
  kanban: kanbanConfigSchema.optional(),
});

export const createSavedViewSchema = z.object({
  entityType: z.string().trim().min(1).max(40),
  name: z.string().trim().min(1, 'View name is required').max(80),
  viewType: z.enum(VIEW_LAYOUT_TYPES).default('table'),
  isDefault: z.boolean().default(false),
  isShared: z.boolean().default(false),
  config: savedViewConfigSchema.default({}),
});

export const updateSavedViewSchema = createSavedViewSchema.partial();

export type CreateSavedViewPayload = z.output<typeof createSavedViewSchema>;
export type UpdateSavedViewPayload = z.output<typeof updateSavedViewSchema>;
