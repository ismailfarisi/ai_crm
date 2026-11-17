import { z } from 'zod';
import { PERMISSIONS, type Permission } from '../rbac/permissions';
import { CONTACT_SOURCES, CONTACT_SOURCE_LABELS, CONTACT_STATUSES, CONTACT_STATUS_LABELS, createContactSchema } from '../schemas/contact';
import { createCustomerSchema } from '../schemas/customer';
import { createCatalogItemSchema, createMaterialSchema, createWorkCenterSchema } from '../schemas/catalog';
import { EMIRATES, EMIRATE_NAMES, VAT_STATUSES } from '../tax/uae';

/**
 * Importing records from a spreadsheet.
 *
 * Every row is validated with the same create schema the form uses, so an
 * imported customer obeys exactly the rules a typed-in one does. This file
 * only describes the columns: their names, the header spellings we recognise,
 * and how a spreadsheet cell becomes a form value.
 */

export const IMPORT_ENTITIES = [
  'customers',
  'contacts',
  'products',
  'materials',
  'work-centres',
  'opening-stock',
] as const;
export type ImportEntity = (typeof IMPORT_ENTITIES)[number];

export const IMPORT_LIMITS = {
  /** Upload cap. A 5,000-row customer list is well under 1 MB as CSV. */
  maxBytes: 5 * 1024 * 1024,
  maxRows: 5000,
  /** Rows committed per transaction. */
  batchSize: 200,
} as const;

export const IMPORT_DUPLICATE_MODES = ['skip', 'update'] as const;
export type ImportDuplicateMode = (typeof IMPORT_DUPLICATE_MODES)[number];

export type ImportFieldType = 'text' | 'number' | 'percent' | 'boolean' | 'enum';

export interface ImportField {
  key: string;
  label: string;
  type?: ImportFieldType;
  required?: boolean;
  /** Other header spellings, matched ignoring case, spaces and punctuation. */
  aliases?: string[];
  /** For `enum` fields: accepted spellings (lowercase) to stored value. */
  options?: Record<string, string>;
  example?: string;
  hint?: string;
}

export interface ImportEntityDefinition {
  entity: ImportEntity;
  label: string;
  /** "customer", for "3 customers will be created". */
  noun: string;
  nounPlural: string;
  fields: ImportField[];
  /** Plain words for how an existing record is recognised. */
  matchedBy: string;
  /** Needed to import at all. */
  createPermission: Permission;
  /** Also needed to update existing records. */
  updatePermission: Permission;
  /** Whether existing records can be updated rather than only skipped. */
  canUpdate: boolean;
  /** The create schema, applied to each row after cells are converted. */
  schema: z.ZodType;
}

const enumOptions = (values: readonly string[], labels: Record<string, string> = {}) => {
  const out: Record<string, string> = {};
  for (const value of values) {
    out[value.toLowerCase()] = value;
    const label = labels[value];
    if (label) out[label.toLowerCase()] = value;
  }
  return out;
};

const vatStatusOptions = {
  ...enumOptions(VAT_STATUSES),
  registered: 'REGISTERED',
  'not registered': 'NOT_REGISTERED',
  unregistered: 'NOT_REGISTERED',
  'outside uae': 'OUTSIDE_UAE',
};

const customerFields: ImportField[] = [
  { key: 'companyName', label: 'Company name', required: true, aliases: ['company', 'customer', 'customer name', 'name', 'account', 'account name', 'business name'], example: 'Al Noor Sweets LLC' },
  { key: 'contactName', label: 'Contact name', aliases: ['contact', 'contact person', 'attention'], example: 'Fatima Khan' },
  { key: 'email', label: 'Email', aliases: ['email address', 'e-mail', 'mail'], example: 'orders@alnoor.ae' },
  { key: 'phone', label: 'Phone', aliases: ['phone number', 'mobile', 'telephone', 'tel', 'whatsapp'], example: '+971 50 123 4567' },
  { key: 'addressLine1', label: 'Address line 1', aliases: ['address', 'address 1', 'street'], example: 'Warehouse 12, Industrial Area 4' },
  { key: 'addressLine2', label: 'Address line 2', aliases: ['address 2'] },
  { key: 'city', label: 'City', aliases: ['town'], example: 'Sharjah' },
  { key: 'postalCode', label: 'Postal code', aliases: ['po box', 'postcode', 'zip', 'zip code'] },
  { key: 'country', label: 'Country', aliases: ['country code'], example: 'AE', hint: 'Code or name, e.g. AE or United Arab Emirates.' },
  { key: 'taxId', label: 'Tax ID', aliases: ['trn', 'vat number', 'tax number', 'tax registration number', 'vat trn'], example: '100123456700003', hint: 'A UAE TRN is 15 digits.' },
  { key: 'emirate', label: 'Emirate', type: 'enum', options: enumOptions(EMIRATES, EMIRATE_NAMES), example: 'Sharjah' },
  { key: 'vatStatus', label: 'VAT status', type: 'enum', options: vatStatusOptions, hint: 'Registered, Not registered or Outside UAE. Left blank, Kerf works it out.' },
  { key: 'currency', label: 'Currency', aliases: ['currency code'], example: 'AED' },
  { key: 'paymentTermsDays', label: 'Payment terms (days)', type: 'number', aliases: ['payment terms', 'terms', 'credit days'], example: '30' },
  { key: 'notes', label: 'Notes', aliases: ['note', 'comments', 'remarks'] },
];

const contactFields: ImportField[] = [
  { key: 'firstName', label: 'First name', required: true, aliases: ['first', 'given name', 'forename'], example: 'Fatima' },
  { key: 'lastName', label: 'Last name', required: true, aliases: ['last', 'surname', 'family name'], example: 'Khan' },
  { key: 'email', label: 'Email', aliases: ['email address', 'e-mail', 'mail'], example: 'fatima@alnoor.ae' },
  { key: 'phone', label: 'Phone', aliases: ['phone number', 'mobile', 'telephone', 'tel', 'whatsapp'], example: '+971 50 123 4567' },
  { key: 'company', label: 'Company', aliases: ['company name', 'organisation', 'organization', 'account'], example: 'Al Noor Sweets LLC' },
  { key: 'jobTitle', label: 'Job title', aliases: ['title', 'position', 'role', 'designation'], example: 'Purchasing manager' },
  { key: 'status', label: 'Status', type: 'enum', options: enumOptions(CONTACT_STATUSES, CONTACT_STATUS_LABELS), example: 'Lead' },
  { key: 'source', label: 'Source', type: 'enum', options: enumOptions(CONTACT_SOURCES, CONTACT_SOURCE_LABELS), aliases: ['lead source'], example: 'Referral' },
  { key: 'notes', label: 'Notes', aliases: ['note', 'comments', 'remarks'] },
  { key: 'ownerEmail', label: 'Owner email', aliases: ['owner', 'assigned to', 'sales rep', 'salesperson'], hint: 'A team member. Only people who can assign contacts to others can use it.' },
];

const productFields: ImportField[] = [
  { key: 'sku', label: 'SKU', required: true, aliases: ['code', 'item code', 'product code', 'part number', 'item no', 'item number'], example: 'BOX-RIG-200' },
  { key: 'name', label: 'Name', required: true, aliases: ['product', 'product name', 'item', 'item name'], example: 'Rigid gift box 200 mm' },
  { key: 'description', label: 'Description', aliases: ['details'] },
  { key: 'uom', label: 'Unit', aliases: ['uom', 'unit of measure', 'units'], example: 'Units' },
  { key: 'listPrice', label: 'List price', type: 'number', required: true, aliases: ['price', 'selling price', 'sale price', 'unit price', 'rate'], example: '12.50' },
  { key: 'standardCost', label: 'Standard cost', type: 'number', aliases: ['cost', 'unit cost', 'cost price'], example: '7.20' },
  { key: 'taxRate', label: 'Tax rate (%)', type: 'number', aliases: ['tax', 'vat', 'vat rate', 'tax rate'], example: '5' },
  { key: 'leadTimeDays', label: 'Lead time (days)', type: 'number', aliases: ['lead time'], example: '7' },
  { key: 'isActive', label: 'Active', type: 'boolean', aliases: ['is active', 'enabled'], example: 'Yes' },
];

const materialFields: ImportField[] = [
  { key: 'name', label: 'Name', required: true, aliases: ['material', 'material name', 'description'], example: 'Greyboard 2 mm' },
  { key: 'sku', label: 'SKU', aliases: ['code', 'item code', 'material code'], example: 'GB-2MM' },
  { key: 'uom', label: 'Unit', type: 'enum', required: true, aliases: ['uom', 'unit of measure'], options: { sheet: 'SHEET', sheets: 'SHEET', metre: 'METRE', meter: 'METRE', m: 'METRE', metres: 'METRE', kg: 'KG', kilogram: 'KG', each: 'EACH', ea: 'EACH', pcs: 'EACH', piece: 'EACH' }, example: 'Sheet', hint: 'Sheet, Metre, KG or Each.' },
  { key: 'costPerUom', label: 'Cost per unit', type: 'number', required: true, aliases: ['cost', 'unit cost', 'price', 'cost per uom', 'cost per sheet'], example: '4.80' },
  { key: 'sheetWidthMm', label: 'Sheet width (mm)', type: 'number', aliases: ['width', 'width mm', 'sheet width'], example: '1000' },
  { key: 'sheetHeightMm', label: 'Sheet height (mm)', type: 'number', aliases: ['height', 'length', 'height mm', 'sheet height', 'sheet length'], example: '700' },
  { key: 'grain', label: 'Grain', type: 'enum', options: { none: 'NONE', length: 'LENGTH', width: 'WIDTH', long: 'LENGTH', short: 'WIDTH' }, example: 'None' },
  { key: 'wastePct', label: 'Waste (%)', type: 'percent', aliases: ['waste', 'waste %', 'wastage'], example: '5%' },
  { key: 'isActive', label: 'Active', type: 'boolean', aliases: ['is active', 'enabled'], example: 'Yes' },
];

const workCentreFields: ImportField[] = [
  { key: 'name', label: 'Name', required: true, aliases: ['work centre', 'work center', 'machine', 'station', 'work centre name'], example: 'Die cutter' },
  { key: 'setupMinutes', label: 'Setup (minutes)', type: 'number', aliases: ['setup', 'setup time', 'setup mins'], example: '20' },
  { key: 'machineCostPerHour', label: 'Machine cost per hour', type: 'number', aliases: ['machine rate', 'machine cost', 'machine hourly rate'], example: '85' },
  { key: 'laborCostPerHour', label: 'Labour cost per hour', type: 'number', aliases: ['labour rate', 'labor rate', 'labour cost', 'labor cost', 'labor cost per hour'], example: '35' },
  { key: 'scrapPct', label: 'Scrap (%)', type: 'percent', aliases: ['scrap', 'scrap %'], example: '2%' },
  { key: 'minChargeMinutes', label: 'Minimum charge (minutes)', type: 'number', aliases: ['min charge', 'minimum minutes'], example: '30' },
  { key: 'dailyCapacityMinutes', label: 'Daily capacity (minutes)', type: 'number', aliases: ['capacity', 'daily capacity'], example: '480' },
  { key: 'isActive', label: 'Active', type: 'boolean', aliases: ['is active', 'enabled'], example: 'Yes' },
];

const openingStockFields: ImportField[] = [
  { key: 'sku', label: 'Material SKU', required: true, aliases: ['sku', 'code', 'material code', 'item code'], example: 'GB-2MM' },
  { key: 'quantity', label: 'Quantity on hand', type: 'number', required: true, aliases: ['quantity', 'qty', 'on hand', 'stock', 'count'], example: '250' },
  { key: 'unitCost', label: 'Unit cost', type: 'number', required: true, aliases: ['cost', 'unit cost', 'cost per unit', 'value per unit'], example: '4.80', hint: 'What one unit is worth today.' },
];

/** Contacts take an owner by email; the API turns it into a user id. */
const contactImportSchema = createContactSchema.omit({ ownerId: true }).extend({
  ownerEmail: z
    .string()
    .trim()
    .toLowerCase()
    .nullish()
    .transform((v) => (v == null || v === '' ? null : v))
    .refine((v) => v === null || z.email().safeParse(v).success, 'Enter a valid email address'),
});

/**
 * An opening count. The API resolves the SKU to a material and books it
 * through the same stock adjustment the Stock screen uses.
 */
export const openingStockImportSchema = z.object({
  sku: z.string().trim().min(1, 'Material SKU is required').max(60),
  quantity: z.coerce.number().positive('Quantity must be above zero').max(100_000_000),
  unitCost: z.coerce.number().min(0).max(1_000_000_000),
});

export const IMPORT_DEFINITIONS: Record<ImportEntity, ImportEntityDefinition> = {
  customers: {
    entity: 'customers',
    label: 'Customers',
    noun: 'customer',
    nounPlural: 'customers',
    fields: customerFields,
    matchedBy: 'email, or company name when there is no email',
    createPermission: PERMISSIONS.CUSTOMER_CREATE,
    updatePermission: PERMISSIONS.CUSTOMER_UPDATE,
    canUpdate: true,
    schema: createCustomerSchema,
  },
  contacts: {
    entity: 'contacts',
    label: 'Contacts',
    noun: 'contact',
    nounPlural: 'contacts',
    fields: contactFields,
    matchedBy: 'email, or first and last name when there is no email',
    createPermission: PERMISSIONS.CONTACT_CREATE,
    updatePermission: PERMISSIONS.CONTACT_UPDATE,
    canUpdate: true,
    schema: contactImportSchema,
  },
  products: {
    entity: 'products',
    label: 'Catalog products',
    noun: 'product',
    nounPlural: 'products',
    fields: productFields,
    matchedBy: 'SKU',
    createPermission: PERMISSIONS.CATALOG_MANAGE,
    updatePermission: PERMISSIONS.CATALOG_MANAGE,
    canUpdate: true,
    schema: createCatalogItemSchema,
  },
  materials: {
    entity: 'materials',
    label: 'Materials',
    noun: 'material',
    nounPlural: 'materials',
    fields: materialFields,
    matchedBy: 'SKU, or name when there is no SKU',
    createPermission: PERMISSIONS.CATALOG_MANAGE,
    updatePermission: PERMISSIONS.CATALOG_MANAGE,
    canUpdate: true,
    schema: createMaterialSchema,
  },
  'work-centres': {
    entity: 'work-centres',
    label: 'Work centres',
    noun: 'work centre',
    nounPlural: 'work centres',
    fields: workCentreFields,
    matchedBy: 'name',
    createPermission: PERMISSIONS.CATALOG_MANAGE,
    updatePermission: PERMISSIONS.CATALOG_MANAGE,
    canUpdate: true,
    schema: createWorkCenterSchema,
  },
  'opening-stock': {
    entity: 'opening-stock',
    label: 'Opening stock',
    noun: 'stock count',
    nounPlural: 'stock counts',
    fields: openingStockFields,
    matchedBy: 'material SKU. A material that already has stock is skipped',
    createPermission: PERMISSIONS.INVENTORY_ADJUST,
    updatePermission: PERMISSIONS.INVENTORY_ADJUST,
    // Changing a count that already exists is a stock adjustment, with a
    // reason, on the Stock screen, not a re-import.
    canUpdate: false,
    schema: openingStockImportSchema,
  },
};

export const isImportEntity = (value: unknown): value is ImportEntity =>
  typeof value === 'string' && (IMPORT_ENTITIES as readonly string[]).includes(value);

/** The fields an import may read: one column per field, or none. */
export const importMappingSchema = z.record(z.string().max(60), z.number().int().min(0).max(500).nullable());
export type ImportMapping = z.infer<typeof importMappingSchema>;

export const importOptionsSchema = z.object({
  mapping: importMappingSchema.optional(),
  onDuplicate: z.enum(IMPORT_DUPLICATE_MODES).default('skip'),
});
export type ImportOptionsPayload = z.output<typeof importOptionsSchema>;
