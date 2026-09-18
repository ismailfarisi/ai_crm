'use client';

import { use } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  Building2,
  FileText,
  Mail,
  MapPin,
  Phone,
  Receipt,
  ShoppingCart,
} from 'lucide-react';
import {
  countryName,
  type CustomerDocumentDto,
  type CustomerDto,
  type CustomerOverviewDto,
} from '@saas/shared';
import { useCustomer, useCustomerOverview } from '@/hooks/use-customers';
import { Button } from '@/components/ui/button';
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  EmptyState,
  Skeleton,
} from '@/components/ui/primitives';

function money(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency.toUpperCase(),
    }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

/**
 * Everything one company has done with you.
 *
 * Customers could be listed, searched, sorted and exported, but a row was not
 * clickable and no `/customers/[id]` route existed — so there was nowhere to
 * see a company's quotes, orders, invoices and balance together, which is the
 * basic reason to have a CRM. Contacts had a detail page; the companies you
 * actually sell to did not.
 */
export function CustomerDetailView({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: customer, isPending, isError, error } = useCustomer(id);
  const { data: overview, isPending: overviewPending } = useCustomerOverview(id);

  return (
    <div className="space-y-6">
      <Link
        href="/customers"
        className="inline-flex items-center gap-1.5 text-xs font-medium text-ink-subtle hover:text-ink"
      >
        <ArrowLeft className="size-3.5" />
        Back to Customers
      </Link>

      {isPending ? (
        <Card className="space-y-4 p-6">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-4 w-40" />
        </Card>
      ) : isError || !customer ? (
        <EmptyState
          title="Customer not found"
          description={
            error instanceof Error
              ? error.message
              : 'This customer does not exist, or you do not have permission to view it.'
          }
          action={
            <Link href="/customers">
              <Button variant="outline">Back to Customers</Button>
            </Link>
          }
        />
      ) : (
        <>
          <CustomerHeader customer={customer} />

          {overviewPending || !overview ? (
            <Card className="p-6">
              <Skeleton className="h-24 w-full" />
            </Card>
          ) : (
            <>
              <TradingSummary overview={overview} />

              <div className="grid gap-5 lg:grid-cols-2">
                <DocumentList
                  title="Quotes"
                  icon={FileText}
                  documents={overview.quotes}
                  href={(doc) => `/quotes/${doc.id}`}
                  emptyLabel="No quotes have been written for this customer yet."
                />
                <DocumentList
                  title="Sales orders"
                  icon={ShoppingCart}
                  documents={overview.orders}
                  href={(doc) => `/orders/${doc.id}`}
                  emptyLabel="Nothing ordered yet. An accepted quote raises an order."
                />
              </div>

              <DocumentList
                title="Invoices"
                icon={Receipt}
                documents={overview.invoices}
                href={() => '/invoices'}
                showOutstanding
                emptyLabel="Nothing has been invoiced yet."
              />
            </>
          )}
        </>
      )}
    </div>
  );
}

function CustomerHeader({ customer }: { customer: CustomerDto }) {
  const address = [
    customer.addressLine1,
    customer.addressLine2,
    customer.city,
    customer.postalCode,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <Card className="p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="grid size-14 place-items-center rounded-2xl bg-brand-soft text-brand ring-1 ring-brand/20">
            <Building2 className="size-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-ink">{customer.companyName}</h1>
            {customer.contactName && (
              <p className="text-sm text-ink-subtle">{customer.contactName}</p>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-ink-muted">
              {customer.email && (
                <a
                  href={`mailto:${customer.email}`}
                  className="flex items-center gap-1 hover:underline"
                >
                  <Mail className="size-3.5 text-ink-subtle" />
                  {customer.email}
                </a>
              )}
              {customer.phone && (
                <span className="flex items-center gap-1">
                  <Phone className="size-3.5 text-ink-subtle" />
                  {customer.phone}
                </span>
              )}
              {(address || customer.country) && (
                <span className="flex items-center gap-1">
                  <MapPin className="size-3.5 text-ink-subtle" />
                  {[address, customer.country ? countryName(customer.country) : null]
                    .filter(Boolean)
                    .join(', ')}
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {customer.taxId && <Badge>Tax ID {customer.taxId}</Badge>}
          {customer.currency && <Badge tone="brand">{customer.currency}</Badge>}
          {customer.paymentTermsDays != null && (
            <Badge>Net {customer.paymentTermsDays} days</Badge>
          )}
        </div>
      </div>

      {customer.notes && (
        <p className="mt-4 border-t border-border/40 pt-4 text-sm text-ink-muted">
          {customer.notes}
        </p>
      )}
    </Card>
  );
}

function TradingSummary({ overview }: { overview: CustomerOverviewDto }) {
  const { totals, currency } = overview;

  const stats = [
    {
      label: 'Quotes sent',
      value: String(totals.quotesSent),
      detail:
        totals.quotesSent > 0 ? `${totals.quotesAccepted} accepted` : 'Nothing quoted yet',
    },
    {
      label: 'Orders placed',
      value: String(totals.ordersPlaced),
      detail: totals.lastOrderedAt
        ? `Last on ${new Date(totals.lastOrderedAt).toLocaleDateString()}`
        : 'Nothing ordered yet',
    },
    {
      label: 'Invoiced to date',
      value: money(totals.invoicedTotal, currency),
      detail: 'Excludes cancelled and voided invoices',
    },
    {
      label: 'Currently owed',
      value: money(totals.outstandingTotal, currency),
      detail: totals.outstandingTotal > 0 ? 'Invoiced less paid' : 'Nothing outstanding',
    },
  ];

  return (
    <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
      {stats.map((stat) => (
        <Card key={stat.label} className="rounded-2xl p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-subtle">
            {stat.label}
          </p>
          <p className="mt-1 text-2xl font-extrabold tabular-nums tracking-tight text-ink">
            {stat.value}
          </p>
          <p className="mt-0.5 text-xs text-ink-muted">{stat.detail}</p>
        </Card>
      ))}
    </div>
  );
}

function DocumentList({
  title,
  icon: Icon,
  documents,
  href,
  emptyLabel,
  showOutstanding = false,
}: {
  title: string;
  icon: typeof FileText;
  documents: CustomerDocumentDto[];
  href: (doc: CustomerDocumentDto) => string;
  emptyLabel: string;
  showOutstanding?: boolean;
}) {
  return (
    <Card className="rounded-2xl">
      <CardHeader className="flex items-center gap-2 border-b border-border/60 px-5 py-3.5">
        <Icon className="size-4 text-ink-subtle" />
        <CardTitle className="text-sm font-semibold text-ink">{title}</CardTitle>
        <span className="ml-auto text-xs tabular-nums text-ink-subtle">{documents.length}</span>
      </CardHeader>
      <CardBody className="px-5 py-1">
        {documents.length === 0 ? (
          <p className="py-4 text-sm text-ink-muted">{emptyLabel}</p>
        ) : (
          <ul className="divide-y divide-border/40">
            {documents.map((doc) => (
              <li key={doc.id} className="flex flex-wrap items-center gap-3 py-2.5 text-sm">
                <Link
                  href={href(doc)}
                  className="font-mono text-xs font-semibold text-brand hover:underline"
                >
                  {doc.number ?? 'Not yet numbered'}
                </Link>
                <Badge className="text-[10px] uppercase tracking-wide">
                  {doc.status.replace(/_/g, ' ').toLowerCase()}
                </Badge>
                <span className="text-xs text-ink-subtle">
                  {new Date(doc.date).toLocaleDateString()}
                </span>
                <span className="ml-auto font-medium tabular-nums text-ink">
                  {money(doc.amount, doc.currency)}
                </span>
                {showOutstanding && doc.outstanding != null && doc.outstanding > 0 && (
                  <span className="w-full text-right text-xs text-amber-600 dark:text-amber-400">
                    {money(doc.outstanding, doc.currency)} still owed
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
