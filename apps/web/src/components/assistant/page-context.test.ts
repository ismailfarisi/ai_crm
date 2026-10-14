import { describe, expect, it } from 'vitest';
import { pageContextFor } from './page-context';

describe('pageContextFor', () => {
  it.each([
    ['/quotes/9b1c', { entity: 'quote', id: '9b1c' }],
    ['/contacts/c-1', { entity: 'contact', id: 'c-1' }],
    ['/customers/x', { entity: 'customer', id: 'x' }],
    ['/orders/o-1', { entity: 'sales_order', id: 'o-1' }],
    ['/purchasing/orders/p-1', { entity: 'purchase_order', id: 'p-1' }],
    ['/production/w-1', { entity: 'work_order', id: 'w-1' }],
    ['/objects/projects/r-1', { entity: 'custom_record:projects', id: 'r-1' }],
  ])('%s', (path, expected) => {
    expect(pageContextFor(path)).toEqual(expected);
  });

  it('returns null for list pages and unknown routes', () => {
    expect(pageContextFor('/quotes')).toBeNull();
    expect(pageContextFor('/settings/ai')).toBeNull();
  });

  it('uses the page title as the label when given', () => {
    expect(pageContextFor('/quotes/q-1', { title: 'Q-1042' })).toEqual({ entity: 'quote', id: 'q-1', label: 'Q-1042' });
  });
});
