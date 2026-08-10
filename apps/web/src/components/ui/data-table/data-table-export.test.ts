import { describe, it, expect } from 'vitest';
import { formatCSVRow, exportToJSONData } from './data-table-export';

describe('data-table-export', () => {
  it('formats CSV row correctly with escaping', () => {
    const row = { name: 'John "Doe"', email: 'john@example.com', role: 'Admin, Lead' };
    const formatted = formatCSVRow(['name', 'email', 'role'], row);
    expect(formatted).toBe('"John ""Doe""",john@example.com,"Admin, Lead"');
  });

  it('serializes JSON data cleanly', () => {
    const data = [{ id: 1, name: 'Alice' }];
    const jsonStr = exportToJSONData(data);
    expect(JSON.parse(jsonStr)).toEqual(data);
  });
});
