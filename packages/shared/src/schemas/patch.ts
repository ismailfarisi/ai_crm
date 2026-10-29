import { z } from 'zod';

const withoutDefault = (t: z.ZodType): z.ZodType =>
  t instanceof z.ZodDefault ? withoutDefault(t.unwrap() as z.ZodType) : t;

/**
 * A create schema's fields as a patch: every field optional, and no
 * defaults.
 *
 * `.partial()` is not enough in zod 4: a field with `.default()` still
 * produces its default when the patch leaves it out, and the service then
 * writes it over the saved value. Patching a work centre's scrap allowance
 * reset its hourly rates to zero.
 */
export function patchOf<T extends z.ZodRawShape>(schema: z.ZodObject<T>) {
  const shape = Object.fromEntries(
    Object.entries(schema.shape).map(([key, field]) => [key, withoutDefault(field as z.ZodType).optional()]),
  );
  return z.object(shape) as unknown as z.ZodObject<{ [K in keyof T]: z.ZodOptional<T[K]> }>;
}
