import { QueryFailedError, type DataSource } from 'typeorm';
import { calculateInvoiceDueDate, type QuoteLineItem } from '@saas/shared';
import { AppDataSource } from '../../../database/data-source';
import {
  allocateNextSequenceValue,
  formatSequenceNumber,
} from '../../../database/tenant-sequence.util';
import { Quote } from '../entities/quote.entity';
import { Invoice, InvoiceStatus } from '../entities/invoice.entity';
import { QuoteWorkflowInput } from './interfaces';

const POSTGRES_UNIQUE_VIOLATION = '23505';

/**
 * Temporal activities run outside Nest's DI container, so they can't inject
 * a repository the way the rest of the app does. `AppDataSource` is the one
 * DI-free `DataSource` this codebase already has (used by the migration CLI
 * and `run-seed.ts`) — reuse it here instead of opening a second connection.
 */
let dataSourcePromise: Promise<DataSource> | null = null;
function getDataSource(): Promise<DataSource> {
  if (!dataSourcePromise) {
    dataSourcePromise = AppDataSource.isInitialized
      ? Promise.resolve(AppDataSource)
      : AppDataSource.initialize();
  }
  return dataSourcePromise;
}

export async function draftQuoteAIActivity(input: QuoteWorkflowInput): Promise<{
  items: QuoteLineItem[];
  totalAmount: number;
}> {
  const items: QuoteLineItem[] =
    input.items && input.items.length > 0
      ? input.items
      : [
          {
            id: 'ai-line-1',
            type: 'product',
            description: `AI Drafted Service for: ${input.title}`,
            quantity: 1,
            unitPrice: input.totalAmount || 500,
            subtotal: input.totalAmount || 500,
          },
        ];
  const totalAmount = items.reduce(
    (acc, item) =>
      acc +
      (item.subtotal ??
        Number(item.quantity || 0) * Number(item.unitPrice || 0)),
    0,
  );

  return {
    items,
    totalAmount,
  };
}

export async function saveQuoteStateActivity(params: {
  quoteId: string;
  tenantId?: string;
  status: string;
  items?: QuoteLineItem[];
  totalAmount?: number;
}): Promise<void> {
  // Activity implementation for persisting quote state
  console.log(
    `[QuoteActivity] saveQuoteState: quoteId=${params.quoteId}, status=${params.status}`,
  );
}

export async function updateQuoteStatusActivity(params: {
  quoteId: string;
  status: string;
  reason?: string;
}): Promise<void> {
  // Activity implementation for updating status (e.g. REJECTED)
  console.log(
    `[QuoteActivity] updateQuoteStatus: quoteId=${params.quoteId}, status=${params.status}, reason=${params.reason ?? 'N/A'}`,
  );
}

export async function generateInvoiceActivity(
  input: string | { quoteId: string; tenantId?: string; totalAmount?: number },
): Promise<string> {
  const quoteId = typeof input === 'string' ? input : input.quoteId;
  const dataSource = await getDataSource();
  const invoiceRepository = dataSource.getRepository(Invoice);

  const existing = await invoiceRepository.findOne({ where: { quoteId } });
  if (existing) {
    console.log(
      `[QuoteActivity] generateInvoice: invoice already exists for quoteId=${quoteId}, invoiceId=${existing.id}`,
    );
    return existing.id;
  }

  const quote = await dataSource.getRepository(Quote).findOne({
    where: { id: quoteId },
  });
  if (!quote) {
    throw new Error(
      `[QuoteActivity] generateInvoice: quote ${quoteId} not found`,
    );
  }

  const sequenceValue = await allocateNextSequenceValue(
    dataSource.manager,
    quote.tenantId,
    'invoice_number',
  );
  const invoiceNumber = formatSequenceNumber('INV', sequenceValue);
  const issuedAt = new Date();

  const invoice = invoiceRepository.create({
    quoteId: quote.id,
    tenantId: quote.tenantId,
    invoiceNumber,
    customerId: quote.customerId,
    customerName: quote.customerName,
    customerEmail: quote.customerEmail,
    currency: quote.currency,
    items: quote.items,
    subtotalAmount: quote.subtotalAmount,
    discountAmount: quote.discountAmount,
    taxAmount: quote.taxAmount,
    amount: quote.totalAmount,
    status: InvoiceStatus.ISSUED,
    paymentTerms: quote.paymentTerms,
    dueDate: calculateInvoiceDueDate(issuedAt, quote.paymentTerms),
    notes: quote.notes,
  });

  try {
    const saved = await invoiceRepository.save(invoice);
    console.log(
      `[QuoteActivity] generateInvoice: quoteId=${quoteId}, invoiceId=${saved.id}, invoiceNumber=${invoiceNumber}`,
    );
    return saved.id;
  } catch (err: unknown) {
    // Lost the race against the Nest-side synchronous fallback (both can try
    // to create the invoice for this quote) — the unique constraint on
    // quote_id caught it, so fetch and return the row that won instead.
    const isUniqueViolation =
      err instanceof QueryFailedError &&
      (err as unknown as { code?: string }).code === POSTGRES_UNIQUE_VIOLATION;
    if (!isUniqueViolation) throw err;

    const winner = await invoiceRepository.findOne({ where: { quoteId } });
    if (!winner) throw err;
    console.log(
      `[QuoteActivity] generateInvoice: lost race for quoteId=${quoteId}, using invoiceId=${winner.id}`,
    );
    return winner.id;
  }
}

export async function sendNotificationActivity(
  params:
    | string
    | { quoteId: string; tenantId?: string; type?: string; message?: string },
): Promise<void> {
  const quoteId = typeof params === 'string' ? params : params.quoteId;
  console.log(`[QuoteActivity] sendNotification: quoteId=${quoteId}`);
}
