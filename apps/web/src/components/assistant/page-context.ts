import type { AssistantPageContext } from '@saas/shared';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Detail routes the assistant understands as "this …". List pages give no
 * context, and neither do sibling routes such as /quotes/new or
 * /production/variance: only a record id (a UUID) counts.
 */
const ROUTES: Array<[RegExp, (m: RegExpMatchArray) => { entity: string; id: string }]> = [
  [/^\/purchasing\/orders\/([^/]+)$/, (m) => ({ entity: 'purchase_order', id: m[1] })],
  [/^\/purchasing\/bills\/([^/]+)$/, (m) => ({ entity: 'supplier_bill', id: m[1] })],
  [/^\/quotes\/([^/]+)$/, (m) => ({ entity: 'quote', id: m[1] })],
  [/^\/contacts\/([^/]+)$/, (m) => ({ entity: 'contact', id: m[1] })],
  [/^\/customers\/([^/]+)$/, (m) => ({ entity: 'customer', id: m[1] })],
  [/^\/orders\/([^/]+)$/, (m) => ({ entity: 'sales_order', id: m[1] })],
  [/^\/production\/([^/]+)$/, (m) => ({ entity: 'work_order', id: m[1] })],
  [/^\/objects\/([^/]+)\/([^/]+)$/, (m) => ({ entity: `custom_record:${m[1]}`, id: m[2] })],
];

export function pageContextFor(pathname: string, labels?: { title?: string }): AssistantPageContext | null {
  for (const [pattern, build] of ROUTES) {
    const match = pathname.match(pattern);
    if (!match) continue;
    const context = build(match);
    if (!UUID.test(context.id)) return null;
    return { ...context, ...(labels?.title ? { label: labels.title } : {}) };
  }
  return null;
}
