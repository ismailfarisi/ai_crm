import type {
  DeliveryNoteDto,
  InvoiceDto,
  QuoteDepositStatusDto,
  QuoteStatus,
  SalesOrderDto,
  SalesOrderStatus,
} from '@saas/shared';
import { formatDate } from '@/lib/utils';

/**
 * "What do I do next?" for a quote, a sales order and an invoice, worked out
 * from what the records already hold: status, acceptance, the billing
 * schedule, what has shipped and what has been paid. No new states: each
 * step is a reading of those fields.
 */

export interface StepTrailItem {
  label: string;
  done: boolean;
}

export interface NextStep<A> {
  title: string;
  detail: string;
  /** The one main action for this step; absent when there is nothing to press. */
  action?: A;
  /** Where the job is on its way from quote to paid. */
  trail: StepTrailItem[];
  /** Something worth knowing that is not the next step, e.g. an unpaid deposit after work began. */
  note?: string;
  finished?: boolean;
}

const fmt = (n: number, currency: string) =>
  `${currency} ${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const isOpenInvoice = (s: string | null | undefined) => s === 'ISSUED' || s === 'PARTIALLY_PAID';

/* ------------------------------------------------------------------------ */
/* Sales order                                                              */
/* ------------------------------------------------------------------------ */

export type OrderStepAction =
  | { kind: 'invoice'; stageId: string; label: string; amount: number }
  | { kind: 'payment'; invoiceId: string | null; invoiceNumber: string | null }
  | { kind: 'status'; to: SalesOrderStatus; label: string }
  | { kind: 'deliver' }
  | { kind: 'dispatch'; noteId: string; noteNumber: string }
  | { kind: 'invoiceDelivery'; noteId: string; noteNumber: string };

const STARTED: SalesOrderStatus[] = ['IN_PRODUCTION', 'FULFILLED', 'CLOSED'];
const DELIVERED: SalesOrderStatus[] = ['FULFILLED', 'CLOSED'];

export function orderNextStep(order: SalesOrderDto, deliveries: DeliveryNoteDto[] = []): NextStep<OrderStepAction> {
  const stages = [...order.billingSchedule].sort((a, b) => a.sequence - b.sequence);
  const upfront = stages.filter((s) => s.trigger === 'ON_APPROVAL');
  const later = stages.filter((s) => s.trigger !== 'ON_APPROVAL');
  const perDelivery = stages.length === 1 && stages[0].trigger === 'ON_DELIVERY';
  const outstanding = Math.round((order.invoicedAmount - order.paidAmount) * 100) / 100;
  const upfrontPaid = upfront.length > 0 && upfront.every((s) => s.invoiceStatus === 'PAID');
  const stageBilled = (s: (typeof stages)[number]) =>
    (Boolean(s.invoiceId) && s.invoiceStatus !== 'CANCELLED') || (s.trigger === 'ON_DELIVERY' && Boolean(s.invoicedAt));
  const allBilled = stages.every(stageBilled);
  const started = STARTED.includes(order.status);
  const delivered = DELIVERED.includes(order.status);
  const isDeposit = upfront.some((s) => s.kind === 'DEPOSIT');

  const trail: StepTrailItem[] = [
    { label: 'Accepted', done: true },
    ...(upfront.length > 0
      ? [{ label: isDeposit ? 'Deposit paid' : 'Paid upfront', done: upfrontPaid }]
      : []),
    { label: 'Job started', done: started },
    { label: 'Delivered', done: delivered },
    ...(later.length > 0 ? [{ label: perDelivery ? 'Deliveries invoiced' : 'Final invoice', done: later.every(stageBilled) }] : []),
    { label: 'Paid', done: allBilled && outstanding <= 0 && order.invoicedAmount > 0 },
  ];
  const base = { trail };

  if (order.status === 'CANCELLED') {
    return { ...base, title: 'Cancelled', detail: 'This order was cancelled. Nothing more to do.', finished: true };
  }
  if (order.status === 'CLOSED') {
    return { ...base, title: 'Closed', detail: 'Everything is shipped and invoiced. Nothing more to do.', finished: true };
  }

  const nextStage = stages.find((s) => !s.invoiceId && !(s.trigger === 'ON_DELIVERY' && s.invoicedAt));
  const openStage = stages.find((s) => s.invoiceId && isOpenInvoice(s.invoiceStatus));
  const draft = deliveries.find((n) => n.status === 'DRAFT');
  const uninvoicedDelivery = perDelivery
    ? deliveries.find((n) => n.status === 'DISPATCHED' && !n.invoiceId)
    : undefined;
  const leftToShip = order.lines.some((l) => l.qtyFulfilled + 1e-9 < l.qtyOrdered);

  // 1. The upfront invoice (deposit or full amount) is raised on acceptance; if it was not, raise it.
  if (nextStage && nextStage.trigger === 'ON_APPROVAL') {
    return {
      ...base,
      title: `Invoice the ${nextStage.label.toLowerCase()}`,
      detail: `Your billing schedule asks for ${nextStage.label.toLowerCase()} (${fmt(nextStage.totalAmount, order.currency)}) when the customer accepts. Raise that invoice so they can pay it.`,
      action: { kind: 'invoice', stageId: nextStage.id, label: nextStage.label, amount: nextStage.totalAmount },
    };
  }

  // 2. Before work starts: wait for the upfront payment.
  const unpaidUpfront = upfront.find((s) => s.invoiceId && isOpenInvoice(s.invoiceStatus));
  if (order.status === 'OPEN' && unpaidUpfront) {
    return {
      ...base,
      title: isDeposit ? 'Collect the deposit' : 'Collect the payment',
      detail: `${unpaidUpfront.invoiceNumber} for ${unpaidUpfront.label.toLowerCase()} is not paid yet. Record the payment when it arrives, then start the job. You can start sooner if you trust the customer.`,
      action: { kind: 'payment', invoiceId: unpaidUpfront.invoiceId, invoiceNumber: unpaidUpfront.invoiceNumber },
    };
  }

  const note =
    started && unpaidUpfront
      ? `${unpaidUpfront.invoiceNumber} (${unpaidUpfront.label.toLowerCase()}) is still unpaid.`
      : undefined;

  // 3. Start the job.
  if (order.status === 'OPEN' && deliveries.every((n) => n.status === 'CANCELLED')) {
    return {
      ...base,
      title: 'Start the job',
      detail: `${upfront.length ? `${isDeposit ? 'The deposit is' : 'It is'} paid. ` : ''}Starting production turns the catalog products on this order into work orders. If nothing here is made from a catalog product, skip this and prepare the delivery.`,
      action: { kind: 'status', to: 'IN_PRODUCTION', label: 'Start production' },
    };
  }

  // 4. A dispatched delivery on a per-delivery order is billed straight away.
  if (uninvoicedDelivery) {
    return {
      ...base,
      note,
      title: `Invoice delivery ${uninvoicedDelivery.deliveryNoteNumber}`,
      detail: 'This order is invoiced per delivery. Bill what this delivery carried.',
      action: { kind: 'invoiceDelivery', noteId: uninvoicedDelivery.id, noteNumber: uninvoicedDelivery.deliveryNoteNumber },
    };
  }

  // 5. Deliver.
  if (!delivered) {
    if (draft) {
      return {
        ...base,
        note,
        title: `Dispatch ${draft.deliveryNoteNumber}`,
        detail: 'A delivery is ready. Dispatch it when it leaves the shop; stock and shipped quantities move then.',
        action: { kind: 'dispatch', noteId: draft.id, noteNumber: draft.deliveryNoteNumber },
      };
    }
    if (leftToShip) {
      return {
        ...base,
        note,
        title: deliveries.some((n) => n.status === 'DISPATCHED') ? 'Deliver the rest' : 'Deliver the job',
        detail:
          'When the work is ready, prepare a delivery note for what is going out. The order is marked fulfilled once everything has been dispatched.',
        action: { kind: 'deliver' },
      };
    }
    return {
      ...base,
      note,
      title: 'Mark it fulfilled',
      detail: 'Everything has shipped. Mark the order fulfilled to move on to invoicing.',
      action: { kind: 'status', to: 'FULFILLED', label: 'Mark fulfilled' },
    };
  }

  // 6. Delivered: send the next invoice the schedule asks for.
  if (nextStage && nextStage.trigger !== 'ON_DELIVERY') {
    const isLast = stages[stages.length - 1].id === nextStage.id;
    return {
      ...base,
      note,
      title: isLast ? 'Send the final invoice' : `Invoice ${nextStage.label.toLowerCase()}`,
      detail: `The job is delivered. Raise the invoice for ${nextStage.label.toLowerCase()} (${fmt(nextStage.totalAmount, order.currency)}).`,
      action: { kind: 'invoice', stageId: nextStage.id, label: nextStage.label, amount: nextStage.totalAmount },
    };
  }

  // 7. Get paid.
  if (outstanding > 0) {
    return {
      ...base,
      title: 'Collect payment',
      detail: `${fmt(outstanding, order.currency)} is still owed on this order. Record each payment on its invoice.`,
      action: { kind: 'payment', invoiceId: openStage?.invoiceId ?? null, invoiceNumber: openStage?.invoiceNumber ?? null },
    };
  }

  // 8. Done: close it.
  return {
    ...base,
    title: 'Close the order',
    detail: 'Delivered, invoiced and paid. Close the order to take it off your open list.',
    action: { kind: 'status', to: 'CLOSED', label: 'Close order' },
  };
}

/* ------------------------------------------------------------------------ */
/* Quote                                                                    */
/* ------------------------------------------------------------------------ */

export type QuoteStepAction =
  /** The page's own main button (submit, approve, send) is the action. */
  | { kind: 'toolbar' }
  | { kind: 'openInvoice'; invoiceId: string; invoiceNumber: string }
  | { kind: 'openOrder'; orderId: string; orderNumber: string };

export interface QuoteStepInput {
  status: QuoteStatus;
  /** The acceptance link has been issued: the quote was sent. */
  sent: boolean;
  sentExpiresAt?: string | null;
  acceptedAt: string | null;
  supersededAt: string | null;
  order: Pick<SalesOrderDto, 'id' | 'orderNumber' | 'status'> | null;
  deposit: QuoteDepositStatusDto | null;
  canApprove: boolean;
}

export function quoteNextStep(q: QuoteStepInput): NextStep<QuoteStepAction> {
  const accepted = Boolean(q.acceptedAt);
  const depositOwed = q.deposit && q.deposit.invoiceStatus !== 'CANCELLED' && q.deposit.balanceDue > 0;
  const trail: StepTrailItem[] = [
    { label: 'Approved', done: q.status === 'APPROVED' },
    { label: 'Sent', done: q.sent || accepted },
    { label: 'Accepted', done: accepted },
    ...(q.deposit ? [{ label: `${q.deposit.label} paid`, done: !depositOwed }] : []),
    { label: 'Order raised', done: Boolean(q.order) },
  ];
  const base = { trail };

  if (q.supersededAt) {
    return { ...base, title: 'Replaced by a newer version', detail: 'Work on the latest version of this quote.', finished: true };
  }
  if (q.status === 'DRAFT') {
    return { ...base, title: 'Get it approved', detail: 'Check the lines and prices, then submit the quote for approval.', action: { kind: 'toolbar' } };
  }
  if (q.status === 'REJECTED') {
    return { ...base, title: 'Fix and resubmit', detail: 'The quote was rejected. Make the changes asked for, then resubmit it.', action: { kind: 'toolbar' } };
  }
  if (q.status === 'AWAITING_APPROVAL') {
    return q.canApprove
      ? { ...base, title: 'Approve or reject it', detail: 'Check the prices and margin, then approve the quote so it can be sent.', action: { kind: 'toolbar' } }
      : { ...base, title: 'Waiting for approval', detail: 'Someone who can approve quotes needs to look at it. Nothing to do until then.' };
  }
  if (!accepted && !q.order) {
    if (!q.sent) {
      return { ...base, title: 'Send it to the customer', detail: 'They get an email with a link to review and accept the quote online.', action: { kind: 'toolbar' } };
    }
    return {
      ...base,
      title: 'Waiting for the customer to accept',
      detail: `The acceptance link${q.sentExpiresAt ? ` works until ${formatDate(q.sentExpiresAt)}` : ' is out'}. If they said yes another way, record their acceptance below.`,
    };
  }
  if (!q.order) {
    return { ...base, title: 'Raise the sales order', detail: 'The customer accepted, but no sales order exists yet. Raise it below.' };
  }
  if (depositOwed && q.deposit) {
    return {
      ...base,
      title: `Collect the ${q.deposit.label.toLowerCase()}`,
      detail: `${q.deposit.invoiceNumber} is waiting for payment. Record it on the invoice when it arrives.`,
      action: { kind: 'openInvoice', invoiceId: q.deposit.invoiceId, invoiceNumber: q.deposit.invoiceNumber },
    };
  }
  return {
    ...base,
    title: 'Carry on in the sales order',
    detail: `The job now lives in ${q.order.orderNumber}: production, delivery and the remaining invoices are handled there.`,
    action: { kind: 'openOrder', orderId: q.order.id, orderNumber: q.order.orderNumber },
  };
}

/* ------------------------------------------------------------------------ */
/* Invoice                                                                  */
/* ------------------------------------------------------------------------ */

export type InvoiceStepAction = { kind: 'send' } | { kind: 'payment' } | { kind: 'openOrder'; orderId: string };

export function invoiceNextStep(
  invoice: Pick<InvoiceDto, 'status' | 'amount' | 'paidAmount' | 'sentAt' | 'dueDate' | 'paidAt' | 'salesOrderId' | 'customerEmail' | 'currency'>,
  today: Date = new Date(),
): NextStep<InvoiceStepAction> {
  const currency = invoice.currency || 'AED';
  const balance = Math.max(0, Math.round((Number(invoice.amount) - Number(invoice.paidAmount ?? 0)) * 100) / 100);
  const trail: StepTrailItem[] = [
    { label: 'Issued', done: true },
    { label: 'Sent', done: Boolean(invoice.sentAt) || invoice.status === 'PAID' },
    { label: 'Part paid', done: Number(invoice.paidAmount ?? 0) > 0 },
    { label: 'Paid', done: invoice.status === 'PAID' },
  ];
  const base = { trail };
  const orderLink = invoice.salesOrderId ? ({ kind: 'openOrder', orderId: invoice.salesOrderId } as const) : undefined;

  if (invoice.status === 'CANCELLED') {
    return { ...base, title: 'Voided', detail: 'This invoice no longer counts. Nothing is owed on it.', finished: true };
  }
  if (invoice.status === 'PAID') {
    return {
      ...base,
      title: 'Paid in full',
      detail: orderLink
        ? 'Nothing more to collect here. The sales order shows what comes next for the job.'
        : 'Nothing more to collect.',
      action: orderLink,
      finished: true,
    };
  }
  if (!invoice.sentAt) {
    return {
      ...base,
      title: 'Send it to the customer',
      detail: invoice.customerEmail
        ? `Email the invoice to ${invoice.customerEmail}. If they have already paid, record the payment instead.`
        : 'The customer has no email address. Print or download the PDF and send it yourself, or add their email on the customer.',
      action: invoice.customerEmail ? { kind: 'send' } : undefined,
    };
  }
  const overdue = invoice.dueDate && new Date(invoice.dueDate).getTime() < new Date(today.toDateString()).getTime();
  return {
    ...base,
    title: overdue ? 'Overdue: chase payment' : invoice.status === 'PARTIALLY_PAID' ? 'Collect the rest' : 'Wait for payment',
    detail: `${fmt(balance, currency)} is still owed${
      invoice.dueDate ? `${overdue ? ', due on' : ', due'} ${formatDate(invoice.dueDate)}` : ''
    }. Record the payment when it arrives.`,
    action: { kind: 'payment' },
  };
}
