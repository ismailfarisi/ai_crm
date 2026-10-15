import { describe, expect, it } from 'vitest';
import { pageContextFor } from './page-context';

const ID = '9b1c2d3e-4f50-4a6b-8c7d-8e9f0a1b2c3d';

describe('pageContextFor', () => {
  it.each([
    [`/quotes/${ID}`, { entity: 'quote', id: ID }],
    [`/contacts/${ID}`, { entity: 'contact', id: ID }],
    [`/customers/${ID}`, { entity: 'customer', id: ID }],
    [`/orders/${ID}`, { entity: 'sales_order', id: ID }],
    [`/purchasing/orders/${ID}`, { entity: 'purchase_order', id: ID }],
    [`/purchasing/bills/${ID}`, { entity: 'supplier_bill', id: ID }],
    [`/production/${ID}`, { entity: 'work_order', id: ID }],
    [`/objects/projects/${ID}`, { entity: 'custom_record:projects', id: ID }],
  ])('%s', (path, expected) => {
    expect(pageContextFor(path)).toEqual(expected);
  });

  it('returns null for list pages and unknown routes', () => {
    expect(pageContextFor('/quotes')).toBeNull();
    expect(pageContextFor('/settings/ai')).toBeNull();
  });

  it.each(['/quotes/new', '/production/variance', '/contacts/import', '/orders/o-1', '/objects/projects/new'])(
    'returns null when %s is not a record id',
    (path) => {
      expect(pageContextFor(path)).toBeNull();
    },
  );

  it('uses the page title as the label when given', () => {
    expect(pageContextFor(`/quotes/${ID}`, { title: 'Q-1042' })).toEqual({ entity: 'quote', id: ID, label: 'Q-1042' });
  });
});
