import { LEDGER_ROLES, type LedgerRole } from './ledger';

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

/**
 * The subscription modal's old private list, mapped onto the shared one (used by the migration and the form).
 */
export const LEGACY_SUBSCRIPTION_CATEGORIES: Record<string, string> = {
  'Cloud Infrastructure': 'Software & SaaS',
  'Marketing Tools': 'Marketing & Advertising',
  'Security & Compliance': 'Software & SaaS',
  'Communication & Collaboration': 'Software & SaaS',
  'Customer Support': 'Software & SaaS',
  'Design & Creative': 'Software & SaaS',
  'Office Utilities': 'Utilities & Telecom',
};

/** The canonical name for a category, resolving the pre-merge short values. */
export function normaliseExpenseCategory(category: string): string {
  const trimmed = category.trim();
  return LEGACY_CATEGORY_ALIASES[trimmed] ?? LEGACY_SUBSCRIPTION_CATEGORIES[trimmed] ?? trimmed;
}

/**
 * Which account a category posts to. Cost-of-sales categories are direct
 * costs and land in COGS so gross margin is real; overheads land in their own
 * account under 6000. Anything unrecognised — the list is open, people type
 * their own — falls back to 6000 so a posting never fails on a label.
 */
const CATEGORY_ROLE: Record<string, LedgerRole> = {
  'Raw materials': LEDGER_ROLES.COGS,
  Packaging: LEDGER_ROLES.COGS,
  Consumables: LEDGER_ROLES.COGS,
  Subcontract: LEDGER_ROLES.COGS,
  'Freight & shipping': LEDGER_ROLES.COGS,
  Tooling: LEDGER_ROLES.COGS,
  'Rent & premises': LEDGER_ROLES.RENT,
  'Utilities & Telecom': LEDGER_ROLES.UTILITIES,
  'Payroll & Contractors': LEDGER_ROLES.SALARIES,
  'Repairs & maintenance': LEDGER_ROLES.REPAIRS,
  'Plant & machinery': LEDGER_ROLES.REPAIRS,
  Insurance: LEDGER_ROLES.INSURANCE,
  'Travel & Lodging': LEDGER_ROLES.TRAVEL,
  'Meals & Entertainment': LEDGER_ROLES.TRAVEL,
  'Software & SaaS': LEDGER_ROLES.SOFTWARE_IT,
  'Hardware & Equipment': LEDGER_ROLES.SOFTWARE_IT,
  'Marketing & Advertising': LEDGER_ROLES.MARKETING,
  'Professional Services': LEDGER_ROLES.PROFESSIONAL_FEES,
  'Bank charges': LEDGER_ROLES.BANK_CHARGES,
};

export function expenseCategoryRole(category: string | null | undefined): LedgerRole {
  if (!category) return LEDGER_ROLES.OPERATING_EXPENSE;
  return CATEGORY_ROLE[normaliseExpenseCategory(category)] ?? LEDGER_ROLES.OPERATING_EXPENSE;
}
