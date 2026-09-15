import type { DataSource } from 'typeorm';
import type { QuoteLineItem } from '@saas/shared';
import { AppDataSource } from '../../../database/data-source';
import { Quote } from '../entities/quote.entity';
import { LedgerService } from '../../finance/ledger.service';
import { LedgerAccount } from '../../finance/entities/ledger-account.entity';
import { JournalEntry } from '../../finance/entities/journal-entry.entity';
import { provisionOrderForQuote } from '../../orders/order-provisioning';
import { QuoteWorkflowInput } from './interfaces';

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

/**
 * Creates the sales order for an approved quote and raises whatever its
 * billing schedule invoices on approval.
 *
 * Shares `provisionOrderForQuote` with the synchronous approval path in
 * `QuotesService`, which usually runs at the same moment; the quote row lock
 * inside it decides which of the two does the work.
 *
 * Returns the first invoice id for the workflow result, or an empty string
 * when every billing stage waits for a milestone and nothing was invoiced yet.
 */
export async function generateInvoiceActivity(
  input: string | { quoteId: string; tenantId?: string; totalAmount?: number },
): Promise<string> {
  const quoteId = typeof input === 'string' ? input : input.quoteId;
  const dataSource = await getDataSource();

  let tenantId = typeof input === 'string' ? undefined : input.tenantId;
  if (!tenantId) {
    const quote = await dataSource
      .getRepository(Quote)
      .findOne({ where: { id: quoteId } });
    if (!quote) {
      throw new Error(
        `[QuoteActivity] generateInvoice: quote ${quoteId} not found`,
      );
    }
    tenantId = quote.tenantId;
  }

  const ledger = new LedgerService(
    dataSource.getRepository(LedgerAccount),
    dataSource.getRepository(JournalEntry),
    dataSource,
  );
  const result = await provisionOrderForQuote(
    dataSource,
    ledger,
    tenantId,
    quoteId,
  );
  console.log(
    `[QuoteActivity] generateInvoice: quoteId=${quoteId}, order=${result.order.orderNumber}, ` +
      `raised=${result.invoicesRaised.map((i) => i.invoiceNumber).join(',') || 'none'}, isNew=${result.isNew}`,
  );
  return result.invoices[0]?.id ?? '';
}

export async function sendNotificationActivity(
  params:
    | string
    | { quoteId: string; tenantId?: string; type?: string; message?: string },
): Promise<void> {
  const quoteId = typeof params === 'string' ? params : params.quoteId;
  console.log(`[QuoteActivity] sendNotification: quoteId=${quoteId}`);
}
