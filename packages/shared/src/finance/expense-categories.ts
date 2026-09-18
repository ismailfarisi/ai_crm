/**
 * What money spent inside the business is filed under.
 *
 * Two problems, both fixed here. The list was office-shaped — Travel, Meals,
 * Office Supplies, Software, Hardware, Marketing, Professional Services,
 * Utilities, Other — so a manufacturer had no Raw materials, Freight,
 * Subcontract or Consumables and filed everything under "Other", which also
 * made the Category Budgets page useless for the costs that actually matter.
 *
 * And there were two lists, with different values for the same thing: an
 * expense claim was filed under `Travel` while the budget guarding it was
 * `Travel & Lodging`, so the two could never match and no budget was ever
 * measured against the spending it was set for. One list now serves both, with
 * the value and the label the same string.
 *
 * Not a closed set: `category` is a free string end to end and both pickers
 * are comboboxes, so a trade with a cost of its own can type it.
 */
export interface ExpenseCategoryGroup {
  label: string;
  categories: string[];
}

export const EXPENSE_CATEGORY_GROUPS: readonly ExpenseCategoryGroup[] = [
  {
    label: 'Cost of sales',
    categories: [
      'Raw materials',
      'Packaging',
      'Consumables',
      'Subcontract',
      'Freight & shipping',
      'Tooling',
    ],
  },
  {
    label: 'Operations',
    categories: [
      'Plant & machinery',
      'Repairs & maintenance',
      'Rent & premises',
      'Utilities & Telecom',
      'Insurance',
      'Waste & recycling',
    ],
  },
  {
    label: 'People',
    categories: [
      'Payroll & Contractors',
      'Training',
      'Travel & Lodging',
      'Meals & Entertainment',
    ],
  },
  {
    label: 'Overheads',
    categories: [
      'Office Supplies',
      'Software & SaaS',
      'Hardware & Equipment',
      'Marketing & Advertising',
      'Professional Services',
      'Bank charges',
      'Other',
    ],
  },
];

/** Flattened, in group order. */
export const EXPENSE_CATEGORIES: readonly string[] =
  EXPENSE_CATEGORY_GROUPS.flatMap((group) => group.categories);

/**
 * The short values the expense form used before the lists were merged.
 *
 * Kept so rows already filed under them are counted against the budget that
 * was always meant to guard them, rather than silently falling outside it.
 */
const LEGACY_CATEGORY_ALIASES: Record<string, string> = {
  Travel: 'Travel & Lodging',
  Hardware: 'Hardware & Equipment',
  Marketing: 'Marketing & Advertising',
  Utilities: 'Utilities & Telecom',
};

/** The canonical name for a category, resolving the pre-merge short values. */
export function normaliseExpenseCategory(category: string): string {
  const trimmed = category.trim();
  return LEGACY_CATEGORY_ALIASES[trimmed] ?? trimmed;
}
