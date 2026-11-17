import { IMPORT_DEFINITIONS, type ImportEntity, type ImportField, type ImportMapping } from './definitions';

/** "Company Name ", "company_name" and "COMPANY-NAME" all become "companyname". */
export const normaliseHeader = (header: string): string =>
  header
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9%]/g, '')
    .replace(/%/g, 'pct');

const spellings = (field: ImportField): string[] =>
  [field.key, field.label, ...(field.aliases ?? [])].map(normaliseHeader);

/**
 * Pairs each field with a column. Exact spellings win over aliases, and a
 * column is used at most once, so "Name" lands on the field whose key or
 * label is "name" rather than whichever alias came first.
 */
export function suggestMapping(entity: ImportEntity, headers: string[]): ImportMapping {
  const fields = IMPORT_DEFINITIONS[entity].fields;
  const normalised = headers.map((h) => normaliseHeader(h ?? ''));
  const mapping: ImportMapping = Object.fromEntries(fields.map((f) => [f.key, null]));
  const used = new Set<number>();

  const claim = (field: ImportField, candidates: string[]) => {
    if (mapping[field.key] != null) return;
    const index = normalised.findIndex((h, i) => h !== '' && !used.has(i) && candidates.includes(h));
    if (index >= 0) {
      mapping[field.key] = index;
      used.add(index);
    }
  };

  for (const field of fields) claim(field, [normaliseHeader(field.key), normaliseHeader(field.label)]);
  for (const field of fields) claim(field, spellings(field));
  return mapping;
}

const TRUE = new Set(['yes', 'y', 'true', '1', 'active', 'on', 'x']);
const FALSE = new Set(['no', 'n', 'false', '0', 'inactive', 'off']);

/** "AED 1,250.50" → "1250.50". Leaves anything it does not recognise alone, for the schema to reject. */
const cleanNumber = (value: string): string => {
  const stripped = value.replace(/[\s,]/g, '').replace(/^[A-Za-z]{3}(?=[-\d.])/, '');
  return stripped;
};

/**
 * Turns one spreadsheet cell into what the form would have sent. A blank
 * cell is omitted so the schema's default applies, exactly as an untouched
 * form field would.
 */
export function cellToValue(field: ImportField, raw: string | undefined): unknown {
  const value = (raw ?? '').trim();
  if (value === '') return undefined;
  switch (field.type) {
    case 'number':
      return cleanNumber(value);
    case 'percent': {
      // Waste and scrap are stored as fractions. "5%" and "5" both mean 5%;
      // "0.05" is already a fraction.
      const n = Number(cleanNumber(value).replace(/%$/, ''));
      if (!Number.isFinite(n)) return value;
      return value.endsWith('%') || n > 1 ? n / 100 : n;
    }
    case 'boolean': {
      const lower = value.toLowerCase();
      if (TRUE.has(lower)) return true;
      if (FALSE.has(lower)) return false;
      return value;
    }
    case 'enum':
      return field.options?.[value.toLowerCase()] ?? value;
    default:
      return value;
  }
}

export interface ImportRowIssue {
  /** The field key, or null for a problem with the row as a whole. */
  field: string | null;
  message: string;
}

export type ImportRowValidation =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; issues: ImportRowIssue[] };

/** The cells of one row, keyed by field, read through the mapping. */
export function readRow(entity: ImportEntity, cells: string[], mapping: ImportMapping): Record<string, string> {
  const out: Record<string, string> = {};
  for (const field of IMPORT_DEFINITIONS[entity].fields) {
    const index = mapping[field.key];
    if (index == null) continue;
    const cell = cells[index];
    if (cell != null && cell !== '') out[field.key] = cell;
  }
  return out;
}

/** Validates one row with the entity's create schema, the same one the form uses. */
export function validateImportRow(entity: ImportEntity, values: Record<string, string>): ImportRowValidation {
  const definition = IMPORT_DEFINITIONS[entity];
  const input: Record<string, unknown> = {};
  for (const field of definition.fields) {
    const value = cellToValue(field, values[field.key]);
    if (value !== undefined) input[field.key] = value;
  }
  const parsed = definition.schema.safeParse(input);
  if (parsed.success) return { ok: true, value: parsed.data as Record<string, unknown> };
  const known = new Set(definition.fields.map((f) => f.key));
  return {
    ok: false,
    issues: parsed.error.issues.map((issue) => {
      const key = typeof issue.path[0] === 'string' ? issue.path[0] : null;
      const field = key && known.has(key) ? key : null;
      const spec = definition.fields.find((f) => f.key === field);
      // Zod's own wording ("Invalid input: expected string, received
      // undefined", "Invalid option: expected one of ...") reads like code;
      // name the column, or say what it accepts.
      const missing = field !== null && input[field] === undefined;
      if (missing && spec) return { field, message: 'Required' };
      if (issue.code === 'invalid_value' && spec?.type === 'enum' && spec.hint) {
        return { field, message: `Use ${spec.hint.replace(/\.$/, '')}` };
      }
      return { field, message: issue.message };
    }),
  };
}

const lower = (v: unknown) => (typeof v === 'string' && v.trim() !== '' ? v.trim().toLowerCase() : null);

/**
 * The natural keys a row is recognised by, strongest first: email then name
 * for people and companies, SKU (then name) for materials. Two rows in one
 * file that share any key are the same record.
 */
export function importKeys(entity: ImportEntity, value: Record<string, unknown>): string[] {
  const keys: (string | null)[] = [];
  const tag = (prefix: string, v: string | null) => (v ? `${prefix}:${v}` : null);
  switch (entity) {
    case 'customers':
      keys.push(tag('email', lower(value.email)), tag('name', lower(value.companyName)));
      break;
    case 'contacts': {
      const name = [lower(value.firstName), lower(value.lastName)].filter(Boolean).join(' ');
      keys.push(tag('email', lower(value.email)), lower(value.email) ? null : tag('name', name || null));
      break;
    }
    case 'products':
    case 'opening-stock':
      keys.push(tag('sku', lower(value.sku)));
      break;
    case 'materials':
      keys.push(tag('sku', lower(value.sku)), lower(value.sku) ? null : tag('name', lower(value.name)));
      break;
    case 'work-centres':
      keys.push(tag('name', lower(value.name)));
      break;
  }
  return keys.filter((k): k is string => k !== null);
}

/** Template contents: the header row and one example row. */
export function importTemplate(entity: ImportEntity): { headers: string[]; example: string[] } {
  const fields = IMPORT_DEFINITIONS[entity].fields;
  return { headers: fields.map((f) => f.label), example: fields.map((f) => f.example ?? '') };
}
