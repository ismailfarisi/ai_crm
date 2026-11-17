/**
 * Issues an invoice's public pay link for an outgoing email. Provided by the
 * payments module; null when the tenant has not switched on online payment.
 */
export const INVOICE_PAY_LINK_ISSUER = Symbol('INVOICE_PAY_LINK_ISSUER');

export interface InvoicePayLinkIssuer {
  linkForEmail(tenantId: string, invoiceId: string): Promise<string | null>;
}
