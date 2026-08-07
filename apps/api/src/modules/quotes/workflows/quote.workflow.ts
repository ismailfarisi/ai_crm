import { condition, proxyActivities, setHandler } from '@temporalio/workflow';
import type * as activities from './quote.activities';
import {
  approveQuoteSignal,
  getQuoteWorkflowStateQuery,
  manualOverrideSignal,
  QuoteWorkflowInput,
  QuoteWorkflowResult,
  rejectQuoteSignal,
} from './interfaces';

const {
  draftQuoteAIActivity,
  saveQuoteStateActivity,
  updateQuoteStatusActivity,
  generateInvoiceActivity,
  sendNotificationActivity,
} = proxyActivities<typeof activities>({
  startToCloseTimeout: '1 minute',
});

export async function quoteWorkflow(
  input: QuoteWorkflowInput,
): Promise<QuoteWorkflowResult> {
  let isApproved = false;
  let isRejected = false;
  let rejectionReason: string | undefined;
  let items = input.items || [];
  let totalAmount = input.totalAmount || 0;
  let status = 'DRAFT';

  // Register signal handlers
  setHandler(approveQuoteSignal, () => {
    isApproved = true;
  });

  setHandler(rejectQuoteSignal, (reason?: string) => {
    isRejected = true;
    rejectionReason = reason;
  });

  setHandler(manualOverrideSignal, (overrideData: any) => {
    if (overrideData?.items) {
      items = overrideData.items;
    }
    if (overrideData?.totalAmount !== undefined) {
      totalAmount = overrideData.totalAmount;
    }
  });

  // Register query handler
  setHandler(getQuoteWorkflowStateQuery, () => ({
    quoteId: input.quoteId,
    tenantId: input.tenantId,
    status,
    items,
    totalAmount,
    rejectionReason,
  }));

  // AI mode drafting activity
  if (input.mode === 'AI') {
    const aiResult = await draftQuoteAIActivity(input);
    items = aiResult.items;
    totalAmount = aiResult.totalAmount;
  }

  // Update quote state to AWAITING_APPROVAL
  status = 'AWAITING_APPROVAL';
  await saveQuoteStateActivity({
    quoteId: input.quoteId,
    tenantId: input.tenantId,
    status,
    items,
    totalAmount,
  });

  // Wait for signal: approval or rejection
  await condition(() => isApproved || isRejected);

  if (isRejected) {
    status = 'REJECTED';
    await updateQuoteStatusActivity({
      quoteId: input.quoteId,
      status: 'REJECTED',
      reason: rejectionReason,
    });
    return {
      status: 'REJECTED',
      reason: rejectionReason,
    };
  }

  status = 'APPROVED';
  const invoiceId = await generateInvoiceActivity(input.quoteId);
  await sendNotificationActivity({
    quoteId: input.quoteId,
    tenantId: input.tenantId,
    type: 'QUOTE_APPROVED',
  });

  return {
    status: 'APPROVED',
    invoiceId,
  };
}
