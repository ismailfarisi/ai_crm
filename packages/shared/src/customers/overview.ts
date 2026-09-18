/**
 * Everything one customer has done with you, on one screen.
 *
 * Customers could be created, listed, searched, sorted and exported, but a row
 * was not clickable and there was no `/customers/[id]` route — so there was no
 * way to open a company and see their quotes, orders, invoices and balance
 * together, which is the reason to have a CRM at all. Contacts had a detail
 * page; the companies you actually sell to did not.
 *
 * Shaped by the API rather than assembled in the browser, so the page does not
 * have to pull every quote and invoice in the tenant and filter them.
 */
export interface CustomerDocumentDto {
  id: string;
  /** `QT-2026-0001`, or null on a draft that has not been numbered yet. */
  number: string | null;
  status: string;
  currency: string;
  amount: number;
  /** Outstanding on an invoice; absent on documents that cannot be paid. */
  outstanding?: number;
  date: string;
}

export interface CustomerOverviewDto {
  customerId: string;
  /** The customer's own currency, which their documents are written in. */
  currency: string;
  quotes: CustomerDocumentDto[];
  orders: CustomerDocumentDto[];
  invoices: CustomerDocumentDto[];
  totals: {
    /** Quotes sent, and how many of those the customer accepted. */
    quotesSent: number;
    quotesAccepted: number;
    ordersPlaced: number;
    /** Everything invoiced, ever — not the open balance. */
    invoicedTotal: number;
    /** Invoiced less paid: what they owe right now. */
    outstandingTotal: number;
    /** Null until something has been ordered. */
    lastOrderedAt: string | null;
  };
}
