import { FindOperator } from 'typeorm';

type Row = Record<string, unknown>;

const time = (v: unknown) => (v instanceof Date ? v.getTime() : v);

function matches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, expected]) => {
    const actual = row[key];
    if (!(expected instanceof FindOperator)) return actual === expected;
    switch (expected.type) {
      case 'lessThanOrEqual':
        return (
          actual != null &&
          (time(actual) as number) <= (time(expected.value) as number)
        );
      case 'in':
        return (expected.value as unknown[]).includes(actual);
      case 'isNull':
        return actual == null;
      default:
        throw new Error(`fakeRepository: unsupported operator ${expected.type}`);
    }
  });
}

/**
 * A repository over an array that honours the `where` it is given, so a spec
 * exercises the query's date filter and not only what is done with the rows.
 * Supports equality, `In`, `IsNull`, `LessThanOrEqual`, and an array of
 * alternatives. Nothing else: an unsupported operator throws.
 */
export function fakeRepository<T extends object>(rows: T[]) {
  return {
    find(options: { where?: Row | Row[] } = {}): Promise<T[]> {
      const where = options.where ?? {};
      const alternatives = Array.isArray(where) ? where : [where];
      return Promise.resolve(
        rows.filter((row) => alternatives.some((w) => matches(row as Row, w))),
      );
    },
  };
}
