import { describe, expect, it } from 'vitest';
import {
  EXPENSE_CATEGORIES,
  EXPENSE_CATEGORY_GROUPS,
  LEGACY_SUBSCRIPTION_CATEGORIES,
  expenseCategoryRole,
  normaliseExpenseCategory,
} from './expense-categories';
import { LEDGER_ROLES } from './ledger';

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

  describe('expenseCategoryRole', () => {
    it.each([
      ['Raw materials', LEDGER_ROLES.COGS],
      ['Freight & shipping', LEDGER_ROLES.COGS],
      ['Rent & premises', LEDGER_ROLES.RENT],
      ['Utilities & Telecom', LEDGER_ROLES.UTILITIES],
      ['Payroll & Contractors', LEDGER_ROLES.SALARIES],
      ['Plant & machinery', LEDGER_ROLES.REPAIRS],
      ['Meals & Entertainment', LEDGER_ROLES.TRAVEL],
      ['Hardware & Equipment', LEDGER_ROLES.SOFTWARE_IT],
      ['Bank charges', LEDGER_ROLES.BANK_CHARGES],
      ['Office Supplies', LEDGER_ROLES.OPERATING_EXPENSE],
    ])('%s → %s', (category, role) => {
      expect(expenseCategoryRole(category)).toBe(role);
    });

    it('resolves legacy short names first', () => {
      expect(expenseCategoryRole('Travel')).toBe(LEDGER_ROLES.TRAVEL);
      expect(expenseCategoryRole(' Utilities ')).toBe(LEDGER_ROLES.UTILITIES);
    });

    it('falls back to operating expense for anything unknown or empty', () => {
      expect(expenseCategoryRole('Kiln firing')).toBe(LEDGER_ROLES.OPERATING_EXPENSE);
      expect(expenseCategoryRole('')).toBe(LEDGER_ROLES.OPERATING_EXPENSE);
      expect(expenseCategoryRole(null)).toBe(LEDGER_ROLES.OPERATING_EXPENSE);
    });

    it('does not resolve Object.prototype names as categories', () => {
      expect(expenseCategoryRole('toString')).toBe(LEDGER_ROLES.OPERATING_EXPENSE);
      expect(expenseCategoryRole('constructor')).toBe(LEDGER_ROLES.OPERATING_EXPENSE);
    });

    it('maps every old subscription-modal category onto the shared list', () => {
      for (const target of Object.values(LEGACY_SUBSCRIPTION_CATEGORIES)) {
        expect(EXPENSE_CATEGORIES).toContain(target);
      }
    });
  });
});
