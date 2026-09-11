/**
 * `numericTransformer` in the finance module maps NULL to `0`, which is right
 * for a balance and wrong here: a material's `sheetWidthMm` is NULL when the
 * stock is not sheet goods, and turning that into `0` would silently feed a
 * zero-width sheet into the nesting function instead of failing the template.
 */
export const nullableNumericTransformer = {
  to: (value: number | null | undefined): number | null =>
    value === undefined ? null : value,
  from: (value: string | number | null | undefined): number | null => {
    if (value === null || value === undefined) return null;
    const parsed = Number(value);
    return Number.isNaN(parsed) ? null : parsed;
  },
};
