/**
 * The things a made-to-order shop reacts to, as starting events for an
 * automation. One list for both sides: the API publishes exactly these names
 * with exactly these payload fields, and the builder offers them with the
 * sample as the test-run payload and the field list.
 *
 * In a run the payload is read as `$trigger.payload.<field>`.
 */
export type ShopEventGroup =
  | 'Contacts'
  | 'Quotes'
  | 'Artwork proofs'
  | 'Orders'
  | 'Production'
  | 'Invoices and payments'
  | 'Purchasing and stock'
  | 'Expenses'
  | 'Customer messages';

export interface ShopEventDefinition {
  value: string;
  label: string;
  /** Completes "Runs when …". */
  when: string;
  group: ShopEventGroup;
  /** A realistic payload: the test run uses it and the field list is read from it. */
  sample: Record<string, string | number | boolean | null>;
}

const customer = {
  customerId: '5b1f6f0e-3c0a-4f57-9d0e-2b9f6a1c7e11',
  customerName: 'Al Noor Bakery',
  customerEmail: 'orders@alnoorbakery.ae',
  customerPhone: '+971501234567',
};

const quote = {
  quoteId: '8a4c2d6e-91b3-4e0a-b7f4-0c5d3e2a1f90',
  quoteNumber: 'Q-2026-0142',
  title: '5,000 printed cake boxes',
  ...customer,
  totalAmount: 18375,
  currency: 'AED',
};

const order = {
  orderId: '2f7e9a10-6c4b-4d2e-8a31-7b5c0d9e4f12',
  orderNumber: 'SO-2026-0098',
  quoteNumber: 'Q-2026-0142',
  ...customer,
  totalAmount: 18375,
  currency: 'AED',
};

/** What the invoice events that predate this list carry: no phone, no order number. */
const invoiceRow = {
  invoiceId: 'c3d1e5f7-2a4b-4c6d-9e8f-1a2b3c4d5e6f',
  invoiceNumber: 'INV-2026-0211',
  stageLabel: '50% deposit',
  customerId: customer.customerId,
  customerName: customer.customerName,
  customerEmail: customer.customerEmail,
  amount: 9187.5,
  paidAmount: 9187.5,
  currency: 'AED',
  dueDate: '2026-11-27T00:00:00.000Z',
  orderId: order.orderId,
};

const invoice = {
  ...invoiceRow,
  customerPhone: customer.customerPhone,
  orderNumber: order.orderNumber,
};

const workOrder = {
  workOrderId: '9e8d7c6b-5a4f-4e3d-2c1b-0a9f8e7d6c5b',
  workOrderNumber: 'WO-2026-0177',
  description: '5,000 printed cake boxes',
  qty: 5000,
  qtyCompleted: 5000,
  dueDate: '2026-12-02T00:00:00.000Z',
  orderId: order.orderId,
  orderNumber: order.orderNumber,
  ...customer,
};

const proof = {
  proofId: '4b3a2c1d-0e9f-4a8b-7c6d-5e4f3a2b1c0d',
  proofVersion: 2,
  quoteId: quote.quoteId,
  quoteNumber: quote.quoteNumber,
  title: quote.title,
  ...customer,
};

const purchaseOrder = {
  purchaseOrderId: '7c6b5a4f-3e2d-4c1b-a09f-8e7d6c5b4a3f',
  poNumber: 'PO-2026-0064',
  supplierName: 'Gulf Paper & Board',
  totalAmount: 6420,
  currency: 'AED',
  expectedDate: '2026-11-25T00:00:00.000Z',
};

const expense = {
  expenseId: '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d',
  claimNumber: 'EXP-0031',
  employeeName: 'Rashid Khan',
  category: 'Delivery and fuel',
  merchantName: 'ENOC',
  amount: 180,
  currency: 'AED',
};

const conversation = {
  contactId: '6f5e4d3c-2b1a-4f0e-9d8c-7b6a5f4e3d2c',
  contactName: 'Fatima (Al Noor Bakery)',
  channel: 'WhatsApp',
  provider: 'WHATSAPP_META',
};

export const SHOP_EVENTS: readonly ShopEventDefinition[] = [
  // --- Quotes -------------------------------------------------------------
  {
    value: 'quote.sent',
    label: 'Quote sent to the customer',
    when: 'a quote is sent to the customer',
    group: 'Quotes',
    sample: { ...quote, sentTo: customer.customerEmail, validUntil: '2026-12-04T00:00:00.000Z' },
  },
  {
    value: 'quote.changes_requested',
    label: 'Customer asked for changes to a quote',
    when: 'a customer asks for changes to a quote',
    group: 'Quotes',
    sample: { ...quote, respondedByName: 'Fatima Al Noor', note: 'Can you quote 3,000 instead of 5,000?' },
  },
  {
    value: 'quote.declined',
    label: 'Customer declined a quote',
    when: 'a customer declines a quote',
    group: 'Quotes',
    sample: { ...quote, respondedByName: 'Fatima Al Noor', note: 'We went with another supplier.' },
  },
  // --- Artwork proofs -----------------------------------------------------
  {
    value: 'proof.sent',
    label: 'Artwork proof sent for approval',
    when: 'an artwork proof is put up for the customer to approve',
    group: 'Artwork proofs',
    sample: { ...proof, status: 'PENDING', note: 'Logo moved 5 mm to the left as requested.' },
  },
  {
    value: 'proof.approved',
    label: 'Customer approved the artwork proof',
    when: 'a customer approves an artwork proof',
    group: 'Artwork proofs',
    sample: { ...proof, status: 'APPROVED', respondedByName: 'Fatima Al Noor', comment: 'Looks good, go ahead.' },
  },
  {
    value: 'proof.changes_requested',
    label: 'Customer asked for changes to the proof',
    when: 'a customer asks for changes to an artwork proof',
    group: 'Artwork proofs',
    sample: { ...proof, status: 'CHANGES_REQUESTED', respondedByName: 'Fatima Al Noor', comment: 'Please make the logo bigger.' },
  },
  // --- Orders -------------------------------------------------------------
  {
    value: 'sales_order.created',
    label: 'Order confirmed',
    when: 'an accepted quote becomes an order',
    group: 'Orders',
    sample: { ...order, status: 'OPEN' },
  },
  {
    value: 'sales_order.in_production',
    label: 'Order went into production',
    when: 'an order goes into production',
    group: 'Orders',
    sample: { ...order, status: 'IN_PRODUCTION' },
  },
  {
    value: 'sales_order.ready',
    label: 'Order ready (all its jobs are finished)',
    when: 'the last job of an order is finished',
    group: 'Orders',
    sample: { ...order, status: 'IN_PRODUCTION', jobsFinished: 2 },
  },
  {
    value: 'sales_order.fulfilled',
    label: 'Order delivered or collected',
    when: 'an order is delivered or collected in full',
    group: 'Orders',
    sample: { ...order, status: 'FULFILLED' },
  },
  {
    value: 'sales_order.cancelled',
    label: 'Order cancelled',
    when: 'an order is cancelled',
    group: 'Orders',
    sample: { ...order, status: 'CANCELLED', cancelReason: 'Customer changed the event date' },
  },
  // --- Production ---------------------------------------------------------
  {
    value: 'work_order.released',
    label: 'Job released to the floor',
    when: 'a job is released to the shop floor',
    group: 'Production',
    sample: { ...workOrder, qtyCompleted: null, status: 'RELEASED' },
  },
  {
    value: 'work_order.completed',
    label: 'Job finished',
    when: 'a job is marked finished',
    group: 'Production',
    sample: { ...workOrder, status: 'COMPLETE' },
  },
  {
    value: 'work_order.cancelled',
    label: 'Job cancelled',
    when: 'a job is cancelled',
    group: 'Production',
    sample: { ...workOrder, qtyCompleted: null, status: 'CANCELLED', cancelReason: 'Order cancelled' },
  },
  // --- Invoices and payments ----------------------------------------------
  {
    value: 'invoice.paid',
    label: 'Invoice paid in full',
    when: 'an invoice is paid in full',
    group: 'Invoices and payments',
    sample: { ...invoiceRow, status: 'PAID' },
  },
  {
    value: 'invoice.partially_paid',
    label: 'Invoice part-paid',
    when: 'part of an invoice is paid',
    group: 'Invoices and payments',
    sample: { ...invoiceRow, paidAmount: 4000, status: 'PARTIALLY_PAID' },
  },
  {
    value: 'invoice.voided',
    label: 'Invoice voided',
    when: 'an invoice is voided',
    group: 'Invoices and payments',
    sample: { ...invoiceRow, paidAmount: 0, status: 'CANCELLED' },
  },
  {
    value: 'deposit.paid',
    label: 'Deposit paid',
    when: "an order's deposit is paid in full",
    group: 'Invoices and payments',
    sample: { ...invoice, status: 'PAID', paidOnline: true },
  },
  {
    value: 'payment.received',
    label: 'Payment received',
    when: 'a payment is recorded against an invoice, online or by hand',
    group: 'Invoices and payments',
    sample: { ...invoice, status: 'PAID', paymentAmount: 9187.5, paidOnline: true },
  },
  // --- Purchasing and stock -----------------------------------------------
  {
    value: 'purchase_order.awaiting_approval',
    label: 'Purchase order needs approval',
    when: 'a purchase order is sent for approval',
    group: 'Purchasing and stock',
    sample: { ...purchaseOrder, status: 'AWAITING_APPROVAL' },
  },
  {
    value: 'purchase_order.approved',
    label: 'Purchase order approved',
    when: 'a purchase order is approved',
    group: 'Purchasing and stock',
    sample: { ...purchaseOrder, status: 'APPROVED' },
  },
  {
    value: 'purchase_order.received',
    label: 'Materials arrived (purchase order received)',
    when: 'everything on a purchase order has arrived',
    group: 'Purchasing and stock',
    sample: { ...purchaseOrder, status: 'RECEIVED' },
  },
  {
    value: 'stock.low',
    label: 'Stock fell to its minimum',
    when: 'a material falls to or below its reorder point',
    group: 'Purchasing and stock',
    sample: {
      stockItemId: '0d1c2b3a-4f5e-4d6c-7b8a-9f0e1d2c3b4a',
      materialId: '3a2b1c0d-9e8f-4a7b-6c5d-4e3f2a1b0c9d',
      materialName: '350gsm white board',
      sku: 'BRD-350-W',
      unit: 'SHEET',
      qtyOnHand: 120,
      reorderPoint: 200,
      reorderQty: 1000,
    },
  },
  // --- Expenses -----------------------------------------------------------
  {
    value: 'expense.submitted',
    label: 'Expense claim submitted',
    when: 'someone submits an expense claim',
    group: 'Expenses',
    sample: { ...expense, status: 'SUBMITTED' },
  },
  {
    value: 'expense.approved',
    label: 'Expense claim approved',
    when: 'an expense claim is approved',
    group: 'Expenses',
    sample: { ...expense, status: 'APPROVED' },
  },
  {
    value: 'expense.rejected',
    label: 'Expense claim rejected',
    when: 'an expense claim is rejected',
    group: 'Expenses',
    sample: { ...expense, status: 'REJECTED', rejectionReason: 'No receipt attached' },
  },
  // --- Customer messages --------------------------------------------------
  {
    value: 'message.received',
    label: 'Customer sent a message',
    when: 'a customer messages you on WhatsApp, Telegram, Slack or email',
    group: 'Customer messages',
    sample: {
      ...conversation,
      messageId: 'e1d2c3b4-a5f6-4e7d-8c9b-0a1f2e3d4c5b',
      from: '+971501234567',
      body: 'Hi, is my order ready for collection?',
    },
  },
  {
    value: 'conversation.handover',
    label: 'Conversation needs a person',
    when: 'the AI hands a customer conversation over to a person',
    group: 'Customer messages',
    sample: {
      ...conversation,
      threadId: 'b4a5f6e7-d8c9-4b0a-1f2e-3d4c5b6a7f8e',
      reason: 'HUMAN_REQUESTED',
      reasonLabel: 'The customer asked for a person',
      summary: 'Wants to change the delivery date for SO-2026-0098.',
    },
  },
] as const;

export type ShopEventType = (typeof SHOP_EVENTS)[number]['value'];

export function findShopEvent(value: string): ShopEventDefinition | undefined {
  return SHOP_EVENTS.find((event) => event.value === value);
}
