import { describe, expect, it } from 'vitest';
import {
  EXPENSE_CATEGORIES,
  EXPENSE_CATEGORY_GROUPS,
  normaliseExpenseCategory,
} from './expense-categories';

describe('expense categories', () => {
  // The list was office-shaped, so a manufacturer filed every cost that
  // mattered under "Other" — which also made category budgets useless.
  it('covers what a manufacturer actually spends money on', () => {
    for (const category of [
      'Raw materials',
      'Freight & shipping',
      'Subcontract',
      'Consumables',
      'Tooling',
      'Packaging',
    ]) {
      expect(EXPENSE_CATEGORIES).toContain(category);
    }
  });

  it('has no duplicates across groups', () => {
    expect(new Set(EXPENSE_CATEGORIES).size).toBe(EXPENSE_CATEGORIES.length);
    expect(EXPENSE_CATEGORY_GROUPS.length).toBeGreaterThan(1);
  });

  // Claims were filed under `Travel` while the budget guarding them was
  // `Travel & Lodging`, so the two could never be compared.
  it('maps the pre-merge short values onto the canonical names', () => {
    expect(normaliseExpenseCategory('Travel')).toBe('Travel & Lodging');
    expect(normaliseExpenseCategory('Hardware')).toBe('Hardware & Equipment');
    expect(normaliseExpenseCategory('Marketing')).toBe('Marketing & Advertising');
    expect(normaliseExpenseCategory('Utilities')).toBe('Utilities & Telecom');
  });

  it('leaves a category it does not know alone', () => {
    expect(normaliseExpenseCategory('Kiln firing')).toBe('Kiln firing');
  });
});
