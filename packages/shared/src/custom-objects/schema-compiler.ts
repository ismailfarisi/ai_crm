import { z, type ZodTypeAny } from 'zod';
import type { CustomAttributeDefinitionDto } from './types';

export function buildDynamicRecordSchema(attributes: CustomAttributeDefinitionDto[]) {
  const shape: Record<string, ZodTypeAny> = {};

  for (const attr of attributes) {
    let fieldSchema: ZodTypeAny;

    switch (attr.type) {
      case 'text':
      case 'url':
      case 'phone': {
        let str = z.string().trim();
        if (attr.validationRules?.min != null) str = str.min(attr.validationRules.min);
        if (attr.validationRules?.max != null) str = str.max(attr.validationRules.max);
        if (attr.validationRules?.pattern) {
          str = str.regex(new RegExp(attr.validationRules.pattern));
        }
        fieldSchema = str;
        break;
      }
      case 'email': {
        fieldSchema = z.string().trim().email();
        break;
      }
      case 'number':
      case 'currency': {
        let num = z.number();
        if (attr.validationRules?.min != null) num = num.min(attr.validationRules.min);
        if (attr.validationRules?.max != null) num = num.max(attr.validationRules.max);
        fieldSchema = num;
        break;
      }
      case 'boolean': {
        fieldSchema = z.boolean();
        break;
      }
      case 'date':
      case 'datetime': {
        fieldSchema = z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/));
        break;
      }
      case 'select': {
        const validValues = (attr.options ?? []).map((o) => o.value);
        fieldSchema = z.string().refine((val) => validValues.length === 0 || validValues.includes(val), {
          message: `Value must be one of: ${validValues.join(', ')}`,
        });
        break;
      }
      case 'multiselect': {
        const validValues = (attr.options ?? []).map((o) => o.value);
        fieldSchema = z
          .array(z.string())
          .refine((vals) => validValues.length === 0 || vals.every((v) => validValues.includes(v)), {
            message: `All values must be one of: ${validValues.join(', ')}`,
          });
        break;
      }
      default:
        fieldSchema = z.any();
    }

    if (!attr.isRequired) {
      fieldSchema = fieldSchema.nullable().optional();
    }

    shape[attr.slug] = fieldSchema;
  }

  // Strict mode: disallow keys not defined in attribute definitions
  return z.object(shape).strict();
}
