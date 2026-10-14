import type { AssistantPageContext } from '@saas/shared';

/** Detail routes the assistant understands as "this …". List pages give no context. */
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
    if (match) return { ...build(match), ...(labels?.title ? { label: labels.title } : {}) };
  }
  return null;
}
