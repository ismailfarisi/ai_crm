export type ViewLayoutType = 'table' | 'kanban';

export type FilterOperator =
  | 'eq'
  | 'neq'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'contains'
  | 'in';

export interface ColumnConfig {
  key: string;
  visible: boolean;
  width?: number;
  sortOrder?: number;
}

export interface FilterRule {
  field: string;
  operator: FilterOperator;
  value: any;
}

export interface SortConfig {
  field: string;
  direction: 'asc' | 'desc';
}

export interface KanbanConfig {
  groupField: string;
  collapsedColumns?: string[];
}

export interface SavedViewConfig {
  columns?: ColumnConfig[];
  filters?: FilterRule[];
  sort?: SortConfig;
  kanban?: KanbanConfig;
}

export interface SavedViewDto {
  id: string;
  tenantId: string;
  userId: string;
  entityType: string;
  name: string;
  viewType: ViewLayoutType;
  isDefault: boolean;
  isShared: boolean;
  config: SavedViewConfig;
  createdAt: string;
  updatedAt: string;
}
