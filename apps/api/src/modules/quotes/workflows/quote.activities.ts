import type { QuoteLineItem } from '@saas/shared';
import { QuoteWorkflowInput } from './interfaces';

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
  const invoiceId = `inv_${Date.now()}_${quoteId.slice(0, 8)}`;
  console.log(
    `[QuoteActivity] generateInvoice: quoteId=${quoteId}, invoiceId=${invoiceId}`,
  );
  return invoiceId;
}

export async function sendNotificationActivity(
  params:
    | string
    | { quoteId: string; tenantId?: string; type?: string; message?: string },
): Promise<void> {
  const quoteId = typeof params === 'string' ? params : params.quoteId;
  console.log(`[QuoteActivity] sendNotification: quoteId=${quoteId}`);
}
