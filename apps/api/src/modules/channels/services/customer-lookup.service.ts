import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Not, Repository } from 'typeorm';
import { DeliveryNote } from '../../credits/entities/credit-note.entity';
import {
  SalesOrder,
  SalesOrderLine,
} from '../../orders/entities/sales-order.entity';
import { WorkOrder } from '../../production/entities/work-order.entity';
import { Invoice, InvoiceStatus } from '../../quotes/entities/invoice.entity';
import { Quote, QuoteStatus } from '../../quotes/entities/quote.entity';

/** How many of a customer's records one answer may carry. */
const MAX_LISTED = 5;
/** How far back a customer's records are searched for a number they quote. */
const MAX_SEARCHED = 200;

/** An order as its own customer may hear about it. No costs, notes or staff names. */
export interface CustomerOrderView {
  orderNumber: string;
  status: string;
  placedOn: string;
  currency: string;
  total: number;
  items: { description: string; ordered: number; delivered: number }[];
  /** The latest date production has planned for this order's jobs. */
  productionDueOn: string | null;
  deliveries: {
    dispatchedOn: string;
    carrier: string | null;
    trackingReference: string | null;
  }[];
  paid: number;
  /** Invoiced and not yet paid. */
  balanceDue: number;
  /** When the earliest unpaid invoice falls due. */
  balanceDueOn: string | null;
}

/** A quote as its own customer may hear about it. */
export interface CustomerQuoteView {
  quoteNumber: string | null;
  title: string;
  status: string;
  /** Present only once the quote is approved: a draft's figures are not final. */
  currency?: string;
  total?: number;
  validUntil?: string | null;
  orderNumber?: string | null;
}

export interface CustomerLookupResult<T> {
  /** The number the customer gave, when they gave one. */
  askedFor: string | null;
  /** Whether that number is one of this customer's. Always true without one. */
  found: boolean;
  records: T[];
}

const ORDER_STATUS: Record<SalesOrder['status'], string> = {
  OPEN: 'Confirmed, production not started',
  IN_PRODUCTION: 'In production',
  FULFILLED: 'Everything on the order has been delivered',
  CLOSED: 'Completed',
  CANCELLED: 'Cancelled',
};

const day = (date: Date | null | undefined): string | null =>
  date ? new Date(date).toISOString().slice(0, 10) : null;

const round2 = (value: number) => Math.round(value * 100) / 100;

/** "so-0012", "SO 0012" and "#SO-0012" are one number. */
const fold = (value: string) => value.toUpperCase().replace(/[^A-Z0-9]/g, '');

/**
 * Whether what the customer typed names this record: the whole number, or
 * its digits ("12" for SO-0012). Only ever run over the customer's own
 * records, so a number that belongs to someone else finds nothing here.
 */
function names(asked: string, ...numbers: (string | null)[]): boolean {
  const wanted = fold(asked);
  if (!wanted) return false;
  const wantedDigits = /^\d+$/.test(wanted) ? String(Number(wanted)) : null;
  return numbers.some((number) => {
    if (!number) return false;
    if (fold(number) === wanted) return true;
    const digits = number.replace(/\D/g, '');
    return (
      wantedDigits !== null &&
      digits !== '' &&
      String(Number(digits)) === wantedDigits
    );
  });
}

/**
 * Read-only views of one customer's orders and quotes, for a customer agent.
 *
 * Every query is filtered by the customer id the caller resolved from the
 * sender, and by nothing the sender typed: an order number is matched inside
 * that customer's own rows afterwards. So "not yours" and "does not exist"
 * are the same answer, built the same way.
 */
@Injectable()
export class CustomerLookupService {
  constructor(
    @InjectRepository(SalesOrder)
    private readonly orderRepo: Repository<SalesOrder>,
    @InjectRepository(SalesOrderLine)
    private readonly lineRepo: Repository<SalesOrderLine>,
    @InjectRepository(Invoice)
    private readonly invoiceRepo: Repository<Invoice>,
    @InjectRepository(Quote)
    private readonly quoteRepo: Repository<Quote>,
    @InjectRepository(WorkOrder)
    private readonly workOrderRepo: Repository<WorkOrder>,
    @InjectRepository(DeliveryNote)
    private readonly deliveryRepo: Repository<DeliveryNote>,
  ) {}

  async orders(
    organizationId: string,
    customerId: string,
    orderNumber?: string | null,
  ): Promise<CustomerLookupResult<CustomerOrderView>> {
    const asked = orderNumber?.trim() || null;
    const own = await this.orderRepo.find({
      where: { tenantId: organizationId, customerId },
      order: { createdAt: 'DESC' },
      take: asked ? MAX_SEARCHED : MAX_LISTED,
    });
    const picked = asked
      ? own.filter((o) => names(asked, o.orderNumber, o.quoteNumber))
      : own;
    const found = !asked || picked.length > 0;
    // A number that is not theirs gets their recent orders instead, which
    // is what a person at the counter would read back.
    const shown = (found ? picked : own).slice(0, MAX_LISTED);
    if (shown.length === 0) return { askedFor: asked, found, records: [] };

    const ids = shown.map((o) => o.id);
    const scope = { tenantId: organizationId, salesOrderId: In(ids) };
    const [lines, invoices, workOrders, deliveries] = await Promise.all([
      this.lineRepo.find({ where: scope, order: { sequence: 'ASC' } }),
      this.invoiceRepo.find({
        where: { ...scope, status: Not(InvoiceStatus.CANCELLED) },
      }),
      this.workOrderRepo.find({
        where: { ...scope, status: Not('CANCELLED'), dueDate: Not(IsNull()) },
      }),
      this.deliveryRepo.find({
        where: { ...scope, status: 'DISPATCHED' },
        order: { dispatchedAt: 'ASC' },
      }),
    ]);

    return {
      askedFor: asked,
      found,
      records: shown.map((order) => {
        const mine = <T extends { salesOrderId: string | null }>(rows: T[]) =>
          rows.filter((row) => row.salesOrderId === order.id);
        const open = mine(invoices)
          .map((invoice) => ({
            dueDate: invoice.dueDate,
            outstanding: round2(
              Number(invoice.amount) -
                Number(invoice.paidAmount ?? 0) -
                Number(invoice.creditedAmount ?? 0) +
                Number(invoice.refundedAmount ?? 0),
            ),
          }))
          .filter((invoice) => invoice.outstanding > 0);
        const dueDates = open
          .map((invoice) => invoice.dueDate)
          .filter((date): date is Date => !!date)
          .sort((a, b) => a.getTime() - b.getTime());
        const planned = mine(workOrders)
          .map((wo) => wo.dueDate as Date)
          .sort((a, b) => b.getTime() - a.getTime());
        const inHand =
          order.status === 'OPEN' || order.status === 'IN_PRODUCTION';
        return {
          orderNumber: order.orderNumber,
          status: ORDER_STATUS[order.status] ?? order.status,
          placedOn: day(order.createdAt) as string,
          currency: order.currency,
          total: Number(order.totalAmount),
          items: mine(lines).map((line) => ({
            description: line.description,
            ordered: Number(line.qtyOrdered),
            delivered: Number(line.qtyFulfilled),
          })),
          productionDueOn: inHand ? day(planned[0]) : null,
          deliveries: mine(deliveries).map((note) => ({
            dispatchedOn: day(note.dispatchedAt) ?? day(note.createdAt)!,
            carrier: note.carrier,
            trackingReference: note.trackingReference,
          })),
          paid: round2(
            mine(invoices).reduce(
              (sum, i) => sum + Number(i.paidAmount ?? 0),
              0,
            ),
          ),
          balanceDue: round2(open.reduce((sum, i) => sum + i.outstanding, 0)),
          balanceDueOn: day(dueDates[0]),
        };
      }),
    };
  }

  async quotes(
    organizationId: string,
    customerId: string,
    quoteNumber?: string | null,
  ): Promise<CustomerLookupResult<CustomerQuoteView>> {
    const asked = quoteNumber?.trim() || null;
    const own = await this.quoteRepo.find({
      // A superseded revision is not the quote any more.
      where: { tenantId: organizationId, customerId, supersededAt: IsNull() },
      order: { createdAt: 'DESC' },
      take: asked ? MAX_SEARCHED : MAX_LISTED,
    });
    const picked = asked ? own.filter((q) => names(asked, q.quoteNumber)) : own;
    const found = !asked || picked.length > 0;
    const shown = (found ? picked : own).slice(0, MAX_LISTED);
    if (shown.length === 0) return { askedFor: asked, found, records: [] };

    const orders = await this.orderRepo.find({
      where: {
        tenantId: organizationId,
        customerId,
        quoteId: In(shown.map((q) => q.id)),
      },
    });
    const orderByQuote = new Map(orders.map((o) => [o.quoteId, o.orderNumber]));
    const now = Date.now();

    return {
      askedFor: asked,
      found,
      records: shown.map((quote) => {
        const base = { quoteNumber: quote.quoteNumber, title: quote.title };
        if (quote.status !== QuoteStatus.APPROVED) {
          // Not approved: say it is on its way and nothing about its figures.
          return { ...base, status: 'Being prepared, not sent yet' };
        }
        const status = quote.acceptedAt
          ? `Accepted on ${day(quote.acceptedAt)}`
          : quote.customerResponse === 'DECLINED'
            ? 'Declined by the customer'
            : quote.customerResponse === 'CHANGES_REQUESTED'
              ? 'Changes were requested; it is being revised'
              : quote.validUntil && quote.validUntil.getTime() < now
                ? `Expired on ${day(quote.validUntil)}`
                : 'Ready, waiting for the customer to accept';
        return {
          ...base,
          status,
          currency: quote.currency,
          total: Number(quote.totalAmount),
          validUntil: day(quote.validUntil),
          orderNumber: orderByQuote.get(quote.id) ?? null,
        };
      }),
    };
  }
}
