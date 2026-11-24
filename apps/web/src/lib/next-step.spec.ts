import { describe, expect, it } from 'vitest';
import type { BillingScheduleLineDto, DeliveryNoteDto, SalesOrderDto } from '@saas/shared';
import { invoiceNextStep, orderNextStep, quoteNextStep } from './next-step';

const stage = (over: Partial<BillingScheduleLineDto>): BillingScheduleLineDto => ({
  id: 's',
  sequence: 1,
  kind: 'FINAL',
  label: 'Full amount',
  percent: 100,
  trigger: 'ON_APPROVAL',
  totalAmount: 1000,
  invoiceId: null,
  invoiceNumber: null,
  invoiceStatus: null,
  invoicedAt: null,
  ...over,
});

const deposit = (over: Partial<BillingScheduleLineDto> = {}) =>
  stage({ id: 'dep', sequence: 1, kind: 'DEPOSIT', label: '30% deposit', percent: 30, totalAmount: 300, ...over });
const balance = (over: Partial<BillingScheduleLineDto> = {}) =>
  stage({ id: 'bal', sequence: 2, kind: 'FINAL', label: 'Balance on completion', percent: 70, trigger: 'MANUAL', totalAmount: 700, ...over });

const order = (over: Partial<SalesOrderDto> = {}): SalesOrderDto =>
  ({
    id: 'o',
    orderNumber: 'SO-1',
    status: 'OPEN',
    currency: 'AED',
    totalAmount: 1000,
    invoicedAmount: 0,
    paidAmount: 0,
    lines: [{ id: 'l', description: 'Sign', uom: null, qtyOrdered: 2, qtyFulfilled: 0, unitPrice: 500, lineTotal: 1000 }],
    billingSchedule: [deposit(), balance()],
    ...over,
  }) as SalesOrderDto;

const note = (over: Partial<DeliveryNoteDto>): DeliveryNoteDto =>
  ({ id: 'n', deliveryNoteNumber: 'DN-1', status: 'DRAFT', invoiceId: null, lines: [], ...over }) as DeliveryNoteDto;

const paidDeposit = deposit({ invoiceId: 'i1', invoiceNumber: 'INV-1', invoiceStatus: 'PAID' });

describe('orderNextStep: deposit, then balance on completion', () => {
  it('raises the deposit invoice if acceptance did not', () => {
    const step = orderNextStep(order());
    expect(step.title).toBe('Invoice the 30% deposit');
    expect(step.action).toMatchObject({ kind: 'invoice', stageId: 'dep' });
  });

  it('waits for the deposit before the job starts', () => {
    const step = orderNextStep(
      order({ billingSchedule: [deposit({ invoiceId: 'i1', invoiceNumber: 'INV-1', invoiceStatus: 'ISSUED' }), balance()], invoicedAmount: 300 }),
    );
    expect(step.title).toBe('Collect the deposit');
    expect(step.action).toEqual({ kind: 'payment', invoiceId: 'i1', invoiceNumber: 'INV-1' });
  });

  it('starts the job once the deposit is paid', () => {
    const step = orderNextStep(order({ billingSchedule: [paidDeposit, balance()], invoicedAmount: 300, paidAmount: 300 }));
    expect(step.action).toEqual({ kind: 'status', to: 'IN_PRODUCTION', label: 'Start production' });
    expect(step.trail.map((t) => [t.label, t.done])).toEqual([
      ['Accepted', true],
      ['Deposit paid', true],
      ['Job started', false],
      ['Delivered', false],
      ['Final invoice', false],
      ['Paid', false],
    ]);
  });

  it('in production: prepares a delivery, then dispatches a draft one, and flags an unpaid deposit', () => {
    const unpaid = deposit({ invoiceId: 'i1', invoiceNumber: 'INV-1', invoiceStatus: 'ISSUED' });
    const o = order({ status: 'IN_PRODUCTION', billingSchedule: [unpaid, balance()], invoicedAmount: 300 });
    const step = orderNextStep(o);
    expect(step.action).toEqual({ kind: 'deliver' });
    expect(step.note).toContain('INV-1');
    expect(orderNextStep(o, [note({ status: 'DRAFT' })]).action).toEqual({ kind: 'dispatch', noteId: 'n', noteNumber: 'DN-1' });
  });

  it('delivered: sends the final invoice, then collects payment, then closes', () => {
    const delivered = { status: 'FULFILLED' as const, lines: [{ ...order().lines[0], qtyFulfilled: 2 }] };
    const step = orderNextStep(order({ ...delivered, billingSchedule: [paidDeposit, balance()], invoicedAmount: 300, paidAmount: 300 }));
    expect(step.title).toBe('Send the final invoice');
    expect(step.action).toMatchObject({ kind: 'invoice', stageId: 'bal', amount: 700 });

    const billed = balance({ invoiceId: 'i2', invoiceNumber: 'INV-2', invoiceStatus: 'ISSUED' });
    const owed = orderNextStep(order({ ...delivered, billingSchedule: [paidDeposit, billed], invoicedAmount: 1000, paidAmount: 300 }));
    expect(owed.title).toBe('Collect payment');
    expect(owed.action).toEqual({ kind: 'payment', invoiceId: 'i2', invoiceNumber: 'INV-2' });

    const paid = orderNextStep(
      order({ ...delivered, billingSchedule: [paidDeposit, { ...billed, invoiceStatus: 'PAID' }], invoicedAmount: 1000, paidAmount: 1000 }),
    );
    expect(paid.action).toEqual({ kind: 'status', to: 'CLOSED', label: 'Close order' });
    expect(paid.trail.every((t) => t.done)).toBe(true);
  });

  it('per-delivery billing invoices each dispatched delivery', () => {
    const o = order({
      status: 'IN_PRODUCTION',
      billingSchedule: [stage({ trigger: 'ON_DELIVERY', label: 'Invoiced per delivery' })],
      lines: [{ ...order().lines[0], qtyFulfilled: 1 }],
    });
    const step = orderNextStep(o, [note({ status: 'DISPATCHED' })]);
    expect(step.action).toEqual({ kind: 'invoiceDelivery', noteId: 'n', noteNumber: 'DN-1' });
    expect(step.trail.map((t) => t.label)).toEqual(['Accepted', 'Job started', 'Delivered', 'Deliveries invoiced', 'Paid']);
  });

  it('closed and cancelled orders have nothing to do', () => {
    expect(orderNextStep(order({ status: 'CLOSED' })).finished).toBe(true);
    expect(orderNextStep(order({ status: 'CANCELLED' })).action).toBeUndefined();
  });
});

describe('quoteNextStep', () => {
  const base = {
    status: 'APPROVED' as const,
    sent: false,
    acceptedAt: null,
    supersededAt: null,
    order: null,
    deposit: null,
    canApprove: true,
  };

  it('follows draft → approval → send → acceptance', () => {
    expect(quoteNextStep({ ...base, status: 'DRAFT' }).title).toBe('Get it approved');
    expect(quoteNextStep({ ...base, status: 'AWAITING_APPROVAL' }).action).toEqual({ kind: 'toolbar' });
    expect(quoteNextStep({ ...base, status: 'AWAITING_APPROVAL', canApprove: false }).action).toBeUndefined();
    expect(quoteNextStep(base).title).toBe('Send it to the customer');
    expect(quoteNextStep({ ...base, sent: true }).title).toBe('Waiting for the customer to accept');
  });

  it('after acceptance: deposit, then the sales order', () => {
    const accepted = { ...base, sent: true, acceptedAt: '2026-01-01', order: { id: 'o', orderNumber: 'SO-1', status: 'OPEN' as const } };
    const dep = {
      invoiceId: 'i', invoiceNumber: 'INV-1', label: '30% deposit', amount: 300, paidAmount: 0, balanceDue: 300,
      invoiceStatus: 'ISSUED' as const, lastCheckoutStatus: null, paidOnline: 0,
    };
    expect(quoteNextStep({ ...accepted, order: null }).title).toBe('Raise the sales order');
    expect(quoteNextStep({ ...accepted, deposit: dep }).action).toEqual({ kind: 'openInvoice', invoiceId: 'i', invoiceNumber: 'INV-1' });
    const done = quoteNextStep({ ...accepted, deposit: { ...dep, paidAmount: 300, balanceDue: 0, invoiceStatus: 'PAID' as const } });
    expect(done.action).toEqual({ kind: 'openOrder', orderId: 'o', orderNumber: 'SO-1' });
    expect(done.trail.every((t) => t.done)).toBe(true);
  });
});

describe('invoiceNextStep', () => {
  const inv = { status: 'ISSUED' as const, amount: 1000, paidAmount: 0, sentAt: null, dueDate: '2026-02-01', paidAt: null, salesOrderId: 'o', customerEmail: 'a@b.c', currency: 'AED' };
  const today = new Date('2026-01-15');

  it('sends an unsent invoice, unless there is no email', () => {
    expect(invoiceNextStep(inv, today).action).toEqual({ kind: 'send' });
    expect(invoiceNextStep({ ...inv, customerEmail: null }, today).action).toBeUndefined();
  });

  it('then records payment, saying what is owed and whether it is late', () => {
    const sent = { ...inv, sentAt: '2026-01-02' };
    expect(invoiceNextStep(sent, today).title).toBe('Wait for payment');
    expect(invoiceNextStep({ ...sent, status: 'PARTIALLY_PAID', paidAmount: 400 }, today).detail).toContain('AED 600.00');
    expect(invoiceNextStep(sent, new Date('2026-03-01')).title).toBe('Overdue: chase payment');
    expect(invoiceNextStep(sent, today).action).toEqual({ kind: 'payment' });
  });

  it('paid points back to the order; voided is final', () => {
    expect(invoiceNextStep({ ...inv, status: 'PAID', paidAmount: 1000 }, today).action).toEqual({ kind: 'openOrder', orderId: 'o' });
    expect(invoiceNextStep({ ...inv, status: 'CANCELLED' }, today).finished).toBe(true);
  });
});

describe('who to ask, for staff who cannot take the step', () => {
  it('every step with an action names who can take it', () => {
    const paidDeposit = deposit({ invoiceId: 'i1', invoiceNumber: 'INV-1', invoiceStatus: 'PAID' });
    const start = orderNextStep(order({ billingSchedule: [paidDeposit, balance()], invoicedAmount: 300, paidAmount: 300 }));
    expect(start.whoCan).toBe('Ask someone who can update sales orders to start it.');
    const unpaid = orderNextStep(order({ billingSchedule: [deposit({ invoiceId: 'i1', invoiceNumber: 'INV-1', invoiceStatus: 'ISSUED' }), balance()], invoicedAmount: 300 }));
    expect(unpaid.whoCan).toBe('Ask someone who can manage invoices to record the payment.');
  });

  it('quotes and invoices say who can send, submit or record', () => {
    const q = { status: 'APPROVED' as const, sent: false, acceptedAt: null, supersededAt: null, order: null, deposit: null, canApprove: false };
    expect(quoteNextStep({ ...q, status: 'DRAFT' }).whoCan).toBe('Ask someone who can edit quotes to submit it.');
    expect(quoteNextStep(q).whoCan).toBe('Ask someone who can edit quotes to send it.');
    const inv = { status: 'ISSUED' as const, amount: 1000, paidAmount: 0, sentAt: '2026-01-02', dueDate: null, paidAt: null, salesOrderId: null, customerEmail: 'a@b.c', currency: 'AED' };
    expect(invoiceNextStep(inv).whoCan).toBe('Ask someone who can manage invoices to record it.');
    expect(invoiceNextStep({ ...inv, sentAt: null }).whoCan).toBe('Ask someone who can manage invoices to send it.');
  });

  it('says nothing when there is nothing to press', () => {
    const q = { status: 'AWAITING_APPROVAL' as const, sent: false, acceptedAt: null, supersededAt: null, order: null, deposit: null, canApprove: false };
    expect(quoteNextStep(q).whoCan).toBeUndefined();
    const inv = { status: 'ISSUED' as const, amount: 1000, paidAmount: 0, sentAt: null, dueDate: null, paidAt: null, salesOrderId: null, customerEmail: null, currency: 'AED' };
    expect(invoiceNextStep(inv).whoCan).toBeUndefined();
  });
});
