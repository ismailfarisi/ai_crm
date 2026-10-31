import { describe, it, expect } from 'vitest';
import type { Column } from '@tanstack/react-table';
import { columnLabel, humaniseColumnId } from './column-label';

const column = (id: string, header?: unknown, meta?: unknown) =>
  ({ id, columnDef: { header, meta } }) as unknown as Column<unknown, unknown>;

describe('columnLabel', () => {
  /** Phone cards used to read "CUSTOMERNAME" and "TOTALAMOUNT". */
  it('spells a field id out in words', () => {
    expect(humaniseColumnId('customerName')).toBe('Customer');
    expect(humaniseColumnId('totalAmount')).toBe('Total');
    expect(humaniseColumnId('createdAt')).toBe('Created');
    expect(humaniseColumnId('jobTitle')).toBe('Job title');
    expect(humaniseColumnId('payment_method')).toBe('Payment method');
  });

  it('prefers an explicit label, then a plain-text header', () => {
    expect(columnLabel(column('fullName', () => null, { label: 'Contact' }))).toBe('Contact');
    expect(columnLabel(column('status', 'Stage'))).toBe('Stage');
    expect(columnLabel(column('issuedAt', () => null))).toBe('Issued');
  });
});
