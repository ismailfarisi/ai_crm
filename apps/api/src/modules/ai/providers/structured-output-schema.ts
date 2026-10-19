/**
 * Anthropic's structured outputs (`output_config.format`) accept a subset of
 * JSON Schema: every object must carry `additionalProperties: false`, and
 * numeric, string-length, array-length and most `format` constraints are
 * rejected with a 400. Callers write ordinary schemas (the receipt scanner has
 * `minimum`, several have no `additionalProperties`), so the provider
 * rewrites them here. Dropped constraints are not enforced by the model;
 * callers already validate the result with zod before trusting it.
 */
const UNSUPPORTED_KEYWORDS = new Set([
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'multipleOf',
  'minLength',
  'maxLength',
  'pattern',
  'minItems',
  'maxItems',
  'uniqueItems',
  'minProperties',
  'maxProperties',
]);

const SUPPORTED_FORMATS = new Set([
  'date-time',
  'time',
  'date',
  'duration',
  'email',
  'hostname',
  'uri',
  'ipv4',
  'ipv6',
  'uuid',
]);

/** Keys whose value is a map of name → schema. */
const SCHEMA_MAP_KEYS = new Set(['properties', '$defs', 'definitions', 'patternProperties']);
/** Keys whose value is a list of schemas. */
const SCHEMA_LIST_KEYS = new Set(['anyOf', 'allOf', 'oneOf', 'prefixItems']);
/** Keys whose value is a single schema. */
const SCHEMA_KEYS = new Set(['items', 'additionalItems', 'not', 'if', 'then', 'else', 'contains']);

export function toStructuredOutputSchema(
  schema: Record<string, unknown>,
): Record<string, unknown> {
  return walkSchema(schema);
}

function isObjectSchema(node: Record<string, unknown>): boolean {
  if (node.type === 'object') return true;
  if (Array.isArray(node.type) && node.type.includes('object')) return true;
  return node.properties !== undefined;
}

function walkSchema(node: unknown): Record<string, unknown> {
  if (!node || typeof node !== 'object' || Array.isArray(node)) {
    return node as Record<string, unknown>;
  }
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (UNSUPPORTED_KEYWORDS.has(key)) continue;
    if (key === 'format' && typeof value === 'string' && !SUPPORTED_FORMATS.has(value)) {
      continue;
    }
    if (key === 'additionalProperties') continue; // set below for objects, dropped otherwise
    if (SCHEMA_MAP_KEYS.has(key) && value && typeof value === 'object') {
      out[key] = Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([name, sub]) => [
          name,
          walkSchema(sub),
        ]),
      );
    } else if (SCHEMA_LIST_KEYS.has(key) && Array.isArray(value)) {
      out[key] = value.map((sub) => walkSchema(sub));
    } else if (SCHEMA_KEYS.has(key) && value && typeof value === 'object') {
      out[key] = walkSchema(value);
    } else {
      out[key] = value;
    }
  }
  if (isObjectSchema(out)) {
    out.additionalProperties = false;
  }
  return out;
}
