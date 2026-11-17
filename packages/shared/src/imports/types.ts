import type { ImportDuplicateMode, ImportEntity, ImportMapping } from './definitions';
import type { ImportRowIssue } from './matching';

/** new: will be created; existing: matches a saved record; repeat: an earlier row in this file has the same key. */
export type ImportRowMatch = 'new' | 'existing' | 'repeat';

export interface ImportPreviewRow {
  /** The row number in the spreadsheet, header = 1. */
  rowNumber: number;
  values: Record<string, string>;
  issues: ImportRowIssue[];
  match: ImportRowMatch;
  /** What the row matched, e.g. "Al Noor Sweets LLC". */
  matchLabel: string | null;
}

export interface ImportPreviewDto {
  entity: ImportEntity;
  fileName: string;
  headers: string[];
  mapping: ImportMapping;
  totalRows: number;
  counts: { valid: number; invalid: number; existing: number; repeats: number };
  rows: ImportPreviewRow[];
}

export interface ImportFailure {
  rowNumber: number;
  values: Record<string, string>;
  issues: ImportRowIssue[];
}

export interface ImportRunDto {
  id: string;
  entity: ImportEntity;
  fileName: string;
  onDuplicate: ImportDuplicateMode;
  totalRows: number;
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  failures: ImportFailure[];
  createdById: string | null;
  createdByName: string | null;
  createdAt: string;
}
