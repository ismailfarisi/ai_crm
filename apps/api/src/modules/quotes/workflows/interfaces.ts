import { defineQuery, defineSignal } from '@temporalio/workflow';
import type { QuoteLineItem } from '@saas/shared';

export interface QuoteWorkflowInput {
  quoteId: string;
  tenantId: string;
  mode: 'AI' | 'HUMAN';
  prompt?: string;
  title: string;
  items?: QuoteLineItem[];
  totalAmount?: number;
}

export interface QuoteWorkflowResult {
  status: string;
  invoiceId?: string;
  reason?: string;
}

export interface QuoteWorkflowState {
  quoteId: string;
  tenantId: string;
  status: string;
  items: QuoteLineItem[];
  totalAmount: number;
  rejectionReason?: string;
}

export const approveQuoteSignal = defineSignal('approveQuote');
export const rejectQuoteSignal = defineSignal<[string]>('rejectQuote');
export const manualOverrideSignal = defineSignal<[any]>('manualOverride');
export const getQuoteWorkflowStateQuery = defineQuery<QuoteWorkflowState>(
  'getQuoteWorkflowState',
);
