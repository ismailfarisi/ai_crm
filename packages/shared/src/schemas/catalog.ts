import { z } from 'zod';

/**
 * Validation for the costing catalog and the quote-line resolver.
 *
 * These schemas are the contract the API and the web forms both enforce.
 * Formula strings are only checked for shape here — the costing engine is the
 * authority on whether a formula parses, because it owns the grammar.
 */

const identifierKey = z
  .string()
  .trim()
  .min(1, 'Key is required')
  .max(60)
  .regex(
    /^[A-Za-z_][A-Za-z0-9_]*$/,
    'Key must start with a letter or underscore and contain only letters, digits and underscores',
  );

const formula = z.string().trim().min(1, 'Formula is required').max(500);
const optionalFormula = formula.nullish().transform((v) => (v == null || v === '' ? undefined : v));

const money = z.coerce.number().min(0).max(1_000_000_000);
const fraction = z.coerce.number().min(0).max(1);

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v == null || v === '' ? null : v));

/**
 * Same, but blank becomes `undefined` rather than `null`.
 *
 * Used for fields inside the template model, where the shape is owned by the
 * costing engine's own interfaces (`TemplateParameter`, `DerivedVariable`, …)
 * and those declare optional properties. Emitting `null` here would make the
 * zod output structurally incompatible with the types the engine consumes.
 * Nullable *columns* keep `optionalText`.
 */
const optionalTemplateText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v == null || v === '' ? undefined : v));

/* ------------------------------------------------------------------ *
 * Materials
 * ------------------------------------------------------------------ */

export const materialUomSchema = z.enum(['SHEET', 'METRE', 'KG', 'EACH']);
export const grainDirectionSchema = z.enum(['NONE', 'LENGTH', 'WIDTH']);

/**
 * Kept unrefined so `.partial()` can derive the update schema — zod 4 refuses
 * to make a refined object partial, since a cross-field rule cannot be
 * evaluated when the fields it compares may be absent.
 */
const materialFields = z.object({
  name: z.string().trim().min(1, 'Name is required').max(160),
  sku: optionalText(60),
  uom: materialUomSchema,
  costPerUom: money,
  sheetWidthMm: z.coerce.number().positive().max(10_000).nullish(),
  sheetHeightMm: z.coerce.number().positive().max(10_000).nullish(),
  grain: grainDirectionSchema.default('NONE'),
  wastePct: fraction.default(0),
  isActive: z.boolean().default(true),
});

const sheetDimensionsRequired = {
  message: 'Sheet materials need a sheet width and height',
  path: ['sheetWidthMm'],
};

export const createMaterialSchema = materialFields.refine(
  (value) => value.uom !== 'SHEET' || (value.sheetWidthMm != null && value.sheetHeightMm != null),
  sheetDimensionsRequired,
);

/**
 * The same cross-field rule, but only when the patch actually sets `uom` to
 * SHEET. Patching just the name of an existing sheet material must not be
 * rejected for omitting dimensions it already has.
 */
export const updateMaterialSchema = materialFields
  .partial()
  .refine(
    (value) =>
      value.uom !== 'SHEET' || (value.sheetWidthMm != null && value.sheetHeightMm != null),
    sheetDimensionsRequired,
  );

/* ------------------------------------------------------------------ *
 * Work centres
 * ------------------------------------------------------------------ */

export const createWorkCenterSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(160),
  setupMinutes: z.coerce.number().min(0).max(10_000).default(0),
  machineCostPerHour: money.default(0),
  laborCostPerHour: money.default(0),
  scrapPct: fraction.default(0),
  minChargeMinutes: z.coerce.number().min(0).max(10_000).default(0),
  dailyCapacityMinutes: z.coerce.number().positive().max(10_000).default(480),
  isActive: z.boolean().default(true),
});

export const updateWorkCenterSchema = createWorkCenterSchema.partial();

/* ------------------------------------------------------------------ *
 * Tooling
 * ------------------------------------------------------------------ */

export const createToolingSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(160),
  cost: money,
  amortize: z.boolean().default(true),
  reusable: z.boolean().default(true),
  isActive: z.boolean().default(true),
});

export const updateToolingSchema = createToolingSchema.partial();

/* ------------------------------------------------------------------ *
 * Catalog items — the flat, non-parametric case
 * ------------------------------------------------------------------ */

export const createCatalogItemSchema = z.object({
  sku: z.string().trim().min(1, 'SKU is required').max(60),
  name: z.string().trim().min(1, 'Name is required').max(200),
  description: optionalText(1000),
  uom: z.string().trim().max(40).default('Units'),
  listPrice: money,
  standardCost: money.default(0),
  taxRate: z.coerce.number().min(0).max(100).default(0),
  leadTimeDays: z.coerce.number().int().min(0).max(3650).default(0),
  isActive: z.boolean().default(true),
});

export const updateCatalogItemSchema = createCatalogItemSchema.partial();

/* ------------------------------------------------------------------ *
 * Product templates
 * ------------------------------------------------------------------ */

export const templateParameterSchema = z.object({
  key: identifierKey,
  label: z.string().trim().min(1).max(120),
  type: z.enum(['NUMBER', 'ENUM', 'BOOLEAN']),
  unit: optionalTemplateText(20),
  defaultValue: z.union([z.number(), z.boolean(), z.string()]).optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  options: z.array(z.string().trim().min(1).max(60)).max(50).optional(),
  help: optionalTemplateText(300),
});

export const derivedVariableSchema = z.object({
  key: identifierKey,
  label: optionalTemplateText(120),
  formula,
  unit: optionalTemplateText(20),
});

export const templateMaterialSchema = z.object({
  key: identifierKey,
  label: z.string().trim().min(1).max(120),
  materialId: z.uuid(),
  mode: z.enum(['SHEET_NEST', 'PER_UNIT', 'FIXED']),
  blankWidthFormula: optionalFormula,
  blankHeightFormula: optionalFormula,
  marginMm: z.coerce.number().min(0).max(200).optional(),
  gutterMm: z.coerce.number().min(0).max(200).optional(),
  quantityFormula: optionalFormula,
  wastePctFormula: optionalFormula,
  condition: optionalFormula,
});

export const templateOperationSchema = z.object({
  key: identifierKey,
  label: z.string().trim().min(1).max(120),
  workCenterId: z.uuid(),
  sequence: z.coerce.number().int().min(0).max(10_000),
  setupMinutesFormula: optionalFormula,
  runMinutesFormula: formula,
  condition: optionalFormula,
  branch: optionalTemplateText(60),
});

export const templateToolingSchema = z.object({
  key: identifierKey,
  label: z.string().trim().min(1).max(120),
  toolingId: z.uuid(),
  condition: optionalFormula,
});

export const templatePricingSchema = z
  .object({
    method: z.enum(['MARGIN', 'MARKUP']),
    rate: z.coerce.number().min(0).max(100),
    overheadPct: fraction.default(0),
    minCharge: money.optional(),
    roundUnitPriceTo: z.coerce.number().min(0).max(1000).optional(),
  })
  .refine((value) => value.method !== 'MARGIN' || value.rate < 1, {
    // A 100% margin divides by zero. Markup has no such ceiling.
    message: 'Target margin must be below 1 (100%)',
    path: ['rate'],
  });

export const createProductTemplateSchema = z.object({
  templateKey: z
    .string()
    .trim()
    .min(1, 'Template key is required')
    .max(60)
    .regex(/^[a-z0-9][a-z0-9-]*$/, 'Use lowercase letters, digits and hyphens'),
  name: z.string().trim().min(1, 'Name is required').max(200),
  description: optionalText(1000),
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/, 'Enter a 3-letter currency code')
    .default('USD'),
  parameters: z.array(templateParameterSchema).max(60),
  derived: z.array(derivedVariableSchema).max(100).default([]),
  materials: z.array(templateMaterialSchema).max(100),
  operations: z.array(templateOperationSchema).min(1, 'A template needs at least one operation').max(100),
  tooling: z.array(templateToolingSchema).max(50).default([]),
  pricing: templatePricingSchema,
});

/**
 * Templates are versioned immutably, so an update publishes a new version
 * rather than editing the row a quote already points at. Only `isActive` and
 * the human-readable fields can change in place.
 */
export const updateProductTemplateSchema = createProductTemplateSchema
  .omit({ templateKey: true })
  .partial();

/* ------------------------------------------------------------------ *
 * The resolver
 * ------------------------------------------------------------------ */

const parameterValue = z.union([z.number(), z.boolean(), z.string().max(120)]);

export const resolveLineSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('CATALOG_ITEM'),
    catalogItemId: z.uuid(),
    quantity: z.coerce.number().positive().max(10_000_000),
    discount: z.coerce.number().min(0).max(100).default(0),
  }),
  z.object({
    kind: z.literal('TEMPLATE'),
    templateId: z.uuid(),
    quantity: z.coerce.number().int().positive().max(10_000_000),
    parameters: z.record(z.string().max(60), parameterValue).default({}),
    /** Dies the customer already paid for, so they are not charged twice. */
    toolingAlreadyOwned: z.array(z.uuid()).max(50).default([]),
    discount: z.coerce.number().min(0).max(100).default(0),
  }),
]);

export const resolveLinesSchema = z.object({
  lines: z.array(resolveLineSchema).min(1, 'Add at least one line').max(100),
});

export const priceBreaksSchema = z.object({
  parameters: z.record(z.string().max(60), parameterValue).default({}),
  quantities: z
    .array(z.coerce.number().int().positive().max(10_000_000))
    .min(1, 'Give at least one quantity')
    .max(12),
  toolingAlreadyOwned: z.array(z.uuid()).max(50).default([]),
});

export const updateCostingPolicySchema = z.object({
  minMarginPct: fraction.optional(),
  maxDiscountPct: z.coerce.number().min(0).max(100).optional(),
  requireKnownCost: z.boolean().optional(),
  enforce: z.boolean().optional(),
});

export const catalogSearchSchema = z.object({
  q: z.string().trim().max(120).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  includeInactive: z.coerce.boolean().default(false),
});

/* ------------------------------------------------------------------ *
 * Inferred payload types — output side, after transforms
 * ------------------------------------------------------------------ */

export type CreateMaterialPayload = z.output<typeof createMaterialSchema>;
export type UpdateMaterialPayload = z.output<typeof updateMaterialSchema>;
export type CreateWorkCenterPayload = z.output<typeof createWorkCenterSchema>;
export type UpdateWorkCenterPayload = z.output<typeof updateWorkCenterSchema>;
export type CreateToolingPayload = z.output<typeof createToolingSchema>;
export type UpdateToolingPayload = z.output<typeof updateToolingSchema>;
export type CreateCatalogItemPayload = z.output<typeof createCatalogItemSchema>;
export type UpdateCatalogItemPayload = z.output<typeof updateCatalogItemSchema>;
export type CreateProductTemplatePayload = z.output<typeof createProductTemplateSchema>;
export type UpdateProductTemplatePayload = z.output<typeof updateProductTemplateSchema>;
export type ResolveLineInput = z.output<typeof resolveLineSchema>;
export type ResolveLinesPayload = z.output<typeof resolveLinesSchema>;
export type PriceBreaksPayload = z.output<typeof priceBreaksSchema>;
export type CatalogSearchPayload = z.output<typeof catalogSearchSchema>;
export type UpdateCostingPolicyPayload = z.output<typeof updateCostingPolicySchema>;
