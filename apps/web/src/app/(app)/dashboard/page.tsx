import type { Metadata } from 'next';
import Link from 'next/link';
import {
  ArrowRight,
  ClipboardCheck,
  Factory,
  FilePlus2,
  ReceiptText,
  ShieldCheck,
  Target,
  type LucideIcon,
} from 'lucide-react';
import {
  CONTACT_STATUS_LABELS,
  PERMISSION_GROUPS,
  PERMISSIONS,
  type ContactStatsDto,
  type OrganizationProfileDto,
  type SessionDto,
} from '@saas/shared';
import { serverFetchOrNull } from '@/lib/api/server';
import { can } from '@/lib/access';
import { cn, formatDate, formatMoney } from '@/lib/utils';
import { requireSession } from '@/lib/get-session';
import { Badge, Card, CardBody, CardHeader, CardTitle } from '@/components/ui/primitives';
import { DashboardKpiChart } from '@/components/dashboard/dashboard-kpi-chart';
import { DashboardScheduleCards, type ScheduleGroup } from '@/components/dashboard/dashboard-schedule-cards';
import { SetupChecklist, type SetupStep } from '@/components/dashboard/setup-checklist';
import {
  awaitingApproval,
  drafts,
  jobsOnTheFloor,
  monthlyRevenue,
  overdueInvoices,
  sumQuotes,
  waitingSince,
  type DashboardInvoice,
  type DashboardQuote,
  type DashboardWorkOrder,
} from '@/components/dashboard/dashboard-figures';

export const metadata: Metadata = { title: 'Dashboard' };

function getGreeting(date: Date = new Date()): string {
  const hour = date.getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

function getFormattedDate(date: Date = new Date()): string {
  return date.toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

/**
 * A win is a quote the customer actually accepted; a loss is one that was
 * rejected. Quotes still in flight count as neither, so a shop that has sent
 * two quotes and heard back on none is told there is nothing to measure rather
 * than being given a percentage of nothing.
 */
function summariseWinRate(quotes: DashboardQuote[]): {
  percentage: number;
  won: number;
  decided: number;
} {
  const won = quotes.filter((q) => q.acceptedAt !== null).length;
  const lost = quotes.filter(
    (q) => q.status === 'REJECTED' && q.acceptedAt === null,
  ).length;
  const decided = won + lost;

  return {
    percentage: decided === 0 ? 0 : Math.round((won / decided) * 100),
    won,
    decided,
  };
}

const otherCurrencies = (count: number) =>
  count > 0 ? ` + ${count} in other currencies` : '';

/** How many of each list the panel shows; the count beside it is always the real one. */
const APPROVALS_SHOWN = 5;
const DRAFTS_SHOWN = 3;

function quoteItem(q: DashboardQuote, timePrefix: string) {
  return {
    id: q.id,
    reference: q.quoteNumber ?? 'Not yet numbered',
    title: q.title ? `${q.customerName} · ${q.title}` : q.customerName || 'Untitled quote',
    amount: formatMoney(Number(q.totalAmount) || 0, q.currency, { decimals: 0 }),
    timeLabel: `${timePrefix} ${formatDate(waitingSince(q))}`,
    href: `/quotes/${q.id}`,
  };
}

/**
 * What waits on the viewer. Someone who can approve sees the approvals first,
 * oldest first, because those are theirs to decide; drafts follow on their own.
 * The panel used to mix the two, sort by creation and keep three, so a week of
 * approvals could sit behind three fresh drafts.
 */
function waitingGroups(quotes: DashboardQuote[], canApprove: boolean): ScheduleGroup[] {
  const approvals = awaitingApproval(quotes);
  const draftList = drafts(quotes);

  const approvalGroup: ScheduleGroup = {
    key: 'approvals',
    title: canApprove ? 'Your approval' : 'With an approver',
    count: approvals.length,
    items: approvals.slice(0, APPROVALS_SHOWN).map((q) => quoteItem(q, 'Waiting since')),
    href: '/quotes',
    tone: canApprove ? 'warning' : 'neutral',
  };
  const draftGroup: ScheduleGroup = {
    key: 'drafts',
    title: 'Drafts not yet submitted',
    count: draftList.length,
    items: draftList.slice(0, DRAFTS_SHOWN).map((q) => quoteItem(q, 'Last changed')),
    href: '/quotes',
  };

  return canApprove ? [approvalGroup, draftGroup] : [draftGroup, approvalGroup];
}

/**
 * The setup steps, and whether each is done.
 *
 * A step whose data the viewer cannot read (`null`, not an empty array) counts
 * as done: telling someone to go and do something they have no permission for
 * is worse than saying nothing.
 */
function buildSetupSteps(input: {
  organization: OrganizationProfileDto | null;
  accountCount: number | null;
  catalogCount: number | null;
  chargeableTaxCodes: number | null;
  customerCount: number | null;
}): SetupStep[] {
  const org = input.organization;

  return [
    {
      key: 'company',
      label: 'Add your company address and tax registration',
      detail:
        'Most jurisdictions require them on an invoice, and they print on every document your customers see.',
      href: '/settings/company',
      done: org === null || Boolean(org.addressLine1 && org.taxId),
    },
    {
      key: 'account',
      label: 'Open a bank or cash account',
      detail:
        'A payment has nowhere to land without one, and an expense claim has nothing to be reimbursed from.',
      href: '/finance/accounts',
      done: input.accountCount === null || input.accountCount > 0,
    },
    {
      key: 'tax',
      label: 'Set the tax rates you charge',
      detail:
        'You start with a 0% code so nothing is invented on your behalf. Add the rates you actually charge.',
      href: '/finance/tax',
      done: input.chargeableTaxCodes === null || input.chargeableTaxCodes > 0,
    },
    {
      key: 'catalog',
      label: 'Add what you sell to the catalog',
      detail:
        'Quote lines priced from the catalog carry a real cost, which is what makes the margin on a job real.',
      href: '/catalog',
      done: input.catalogCount === null || input.catalogCount > 0,
    },
    {
      key: 'customer',
      label: 'Add your first customer',
      detail: 'A quote is addressed to a customer, so this is the start of the sales trail.',
      href: '/customers',
      done: input.customerCount === null || input.customerCount > 0,
    },
  ];
}

const listOf = <T,>(value: { items?: T[] } | T[] | null): T[] | null =>
  value === null ? null : Array.isArray(value) ? value : (value.items ?? []);

export default async function DashboardPage() {
  const session = await requireSession();
  const now = new Date();
  const greeting = getGreeting(now);
  const formattedDate = getFormattedDate(now);
  const canApprove = can(session, { permission: PERMISSIONS.QUOTE_APPROVE });
  const canCreateQuote = can(session, { permission: PERMISSIONS.QUOTE_CREATE });

  // Each returns null rather than throwing when the user lacks the permission.
  const [
    stats,
    quotes,
    invoiceList,
    organization,
    accounts,
    catalogItems,
    taxCodes,
    customers,
    releasedJobs,
    runningJobs,
  ] = await Promise.all([
    serverFetchOrNull<ContactStatsDto>('/contacts/stats'),
    serverFetchOrNull<DashboardQuote[]>('/quotes'),
    serverFetchOrNull<{ items?: DashboardInvoice[] } | DashboardInvoice[]>('/invoices'),
    serverFetchOrNull<OrganizationProfileDto>('/organization'),
    serverFetchOrNull<unknown[]>('/finance/accounts'),
    serverFetchOrNull<unknown[]>('/catalog/items', { query: { limit: 1 } }),
    serverFetchOrNull<Array<{ rate: number }>>('/finance/tax-codes'),
    serverFetchOrNull<{ items?: unknown[] } | unknown[]>('/customers', {
      query: { limit: 1 },
    }),
    serverFetchOrNull<DashboardWorkOrder[]>('/work-orders', { query: { status: 'RELEASED' } }),
    serverFetchOrNull<DashboardWorkOrder[]>('/work-orders', { query: { status: 'IN_PROGRESS' } }),
  ]);

  const baseCurrency = organization?.baseCurrency;
  const invoices = listOf(invoiceList);

  const setupSteps = buildSetupSteps({
    organization,
    accountCount: accounts?.length ?? null,
    catalogCount: catalogItems?.length ?? null,
    // A rate someone chose, rather than the 0% code every tenant starts with.
    chargeableTaxCodes: taxCodes ? taxCodes.filter((c) => Number(c.rate) > 0).length : null,
    customerCount: listOf(customers)?.length ?? null,
  });

  const winRate = summariseWinRate(quotes ?? []);
  const revenue = monthlyRevenue(invoices ?? [], baseCurrency, now);

  // The tiles lead with what needs the viewer, and only what they can act on
  // or read. A figure the API does not give us is left out, not estimated.
  const tiles: TileProps[] = [];
  if (quotes && canApprove) {
    const approvals = sumQuotes(awaitingApproval(quotes), baseCurrency);
    tiles.push({
      id: 'approvals',
      label: 'Awaiting your approval',
      value: approvals.count,
      detail:
        approvals.count > 0
          ? `${formatMoney(approvals.amount, baseCurrency, { decimals: 0 })}${otherCurrencies(approvals.otherCurrencies)}`
          : 'Nothing to approve',
      tone: approvals.count > 0 ? 'warning' : 'neutral',
      icon: ClipboardCheck,
      href: '/quotes',
    });
  }
  if (releasedJobs && runningJobs) {
    const floor = jobsOnTheFloor([...releasedJobs, ...runningJobs], now);
    tiles.push({
      id: 'floor',
      label: 'Jobs on the floor',
      value: floor.count,
      detail: floor.overdue > 0 ? `${floor.overdue} past due date` : 'None past due date',
      tone: floor.overdue > 0 ? 'warning' : 'neutral',
      icon: Factory,
      href: '/production',
    });
  }
  if (invoices) {
    const overdue = overdueInvoices(invoices, baseCurrency, now);
    tiles.push({
      id: 'overdue',
      label: 'Overdue invoices',
      value: overdue.count,
      detail:
        overdue.count > 0
          ? `${formatMoney(overdue.amount, baseCurrency, { decimals: 0 })} owed${otherCurrencies(overdue.otherCurrencies)}`
          : 'Nothing overdue',
      tone: overdue.count > 0 ? 'danger' : 'neutral',
      icon: ReceiptText,
      href: '/invoices',
    });
  }

  // Win rate sits in the row as a figure, not a decorative ring beside it.
  if (quotes && winRate.decided > 0) {
    tiles.push({
      id: 'win-rate',
      label: 'Quote win rate',
      value: `${winRate.percentage}%`,
      detail: `${winRate.won} won of ${winRate.decided} decided`,
      tone: 'neutral',
      icon: Target,
      href: '/quotes',
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-ink">
            {greeting}, {session.user.firstName}
          </h1>
          <p className="mt-1 text-sm text-ink-muted">
            {formattedDate} · {session.organization.name}
          </p>
        </div>

        {canCreateQuote && (
          <Link
            href="/quotes/new"
            className="inline-flex h-10 items-center gap-2 rounded-full bg-brand px-4.5 text-sm font-semibold text-on-brand shadow-xs transition-colors hover:bg-brand-hover"
          >
            <FilePlus2 className="size-4" aria-hidden />
            Create quote
          </Link>
        )}
      </div>

      <SetupChecklist steps={setupSteps} />

      {tiles.length > 0 && (
        <div
          className={cn(
            'grid gap-3.5 sm:grid-cols-2',
            tiles.length === 3 && 'lg:grid-cols-3',
            tiles.length >= 4 && 'lg:grid-cols-4',
          )}
        >
          {tiles.map((tile) => (
            <Tile key={tile.id} {...tile} />
          ))}
        </div>
      )}

      {(invoices || quotes) && (
        // grid-cols-1 caps the phone column at the screen width: truncated
        // titles otherwise widen it by their full text and the page scrolls sideways.
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
          {invoices && (
            <div className={quotes ? 'lg:col-span-7' : 'lg:col-span-12'}>
              <DashboardKpiChart
                series={revenue.series}
                currency={baseCurrency}
                note={
                  revenue.otherCurrencies > 0
                    ? `Leaves out ${revenue.otherCurrencies} ${revenue.otherCurrencies === 1 ? 'invoice' : 'invoices'} in other currencies`
                    : undefined
                }
                className="h-full"
              />
            </div>
          )}

          {quotes && (
            <div className={invoices ? 'lg:col-span-5' : 'lg:col-span-12'}>
              <DashboardScheduleCards
                groups={waitingGroups(quotes, canApprove)}
                emptyLabel="No quotes are waiting for a decision."
                className="h-full"
              />
            </div>
          )}
        </div>
      )}

      <div className="grid items-start gap-5 lg:grid-cols-2">
        {stats && <ContactsCard stats={stats} />}
        <AccessCard session={session} />
      </div>
    </div>
  );
}

const TILE_TONES = {
  neutral: 'bg-surface-muted text-ink-muted',
  warning: 'bg-warning-soft text-warning',
  danger: 'bg-danger-soft text-danger',
} as const;

interface TileProps {
  id: string;
  label: string;
  value: number | string;
  /** The money or the detail behind the count, in words. */
  detail: string;
  tone: keyof typeof TILE_TONES;
  icon: LucideIcon;
  href: string;
}

function Tile({ label, value, detail, tone, icon: Icon, href }: TileProps) {
  return (
    <Link
      href={href}
      data-testid="dashboard-tile"
      className="group rounded-2xl border border-border bg-surface p-4 shadow-xs transition-colors hover:bg-surface-muted"
    >
      <div className="flex items-start gap-3.5">
        <span className={`grid size-10 shrink-0 place-items-center rounded-xl ${TILE_TONES[tone]}`}>
          <Icon className="size-5" aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="text-xs font-semibold tracking-wide text-ink-muted uppercase">{label}</p>
          <p className="mt-0.5 text-2xl font-bold tabular-nums tracking-tight text-ink">{value}</p>
          <p className={cn('text-xs tabular-nums', tone === 'danger' ? 'font-medium text-danger' : 'text-ink-muted')}>
            {detail}
          </p>
        </div>
      </div>
    </Link>
  );
}

function ContactsCard({ stats }: { stats: ContactStatsDto }) {
  return (
    <Card className="rounded-2xl border-border bg-surface shadow-xs">
      <CardHeader className="flex items-center justify-between border-b border-border/70 px-5 py-4">
        <CardTitle className="text-sm font-semibold text-ink">Contacts by status</CardTitle>
        <Link
          href="/contacts"
          className="inline-flex items-center gap-1 text-xs font-semibold text-ink underline-offset-2 hover:underline"
        >
          View contacts
          <ArrowRight className="size-3.5" aria-hidden />
        </Link>
      </CardHeader>
      <CardBody className="space-y-4 px-5 py-4">
        {Object.entries(stats.byStatus).map(([status, count]) => {
          const share = stats.total > 0 ? (count / stats.total) * 100 : 0;
          return (
            <div key={status} className="space-y-1.5">
              <div className="flex items-baseline justify-between text-xs font-medium">
                <span className="text-ink">
                  {CONTACT_STATUS_LABELS[status as keyof typeof CONTACT_STATUS_LABELS] || status}
                </span>
                <div className="flex items-center gap-1.5">
                  <span className="tabular-nums text-ink-subtle">{Math.round(share)}%</span>
                  <span className="font-semibold tabular-nums text-ink">{count}</span>
                </div>
              </div>
              <div
                className="h-2 overflow-hidden rounded-full bg-surface-muted"
                role="img"
                aria-label={`${count} contacts, ${Math.round(share)} percent of the total`}
              >
                <div className="h-full rounded-full bg-ink-subtle" style={{ width: `${share}%` }} />
              </div>
            </div>
          );
        })}
      </CardBody>
    </Card>
  );
}

/**
 * The owner's access as one line per feature area.
 *
 * This card used to print all 91 raw permission strings — `quote:approve_below_margin`
 * and the rest — on the screen the owner sees most, which is a debugging view
 * rather than an answer to "what can I do here". The codes still exist, in the
 * role editor, which is where someone changing them is already standing.
 *
 * Areas the user holds nothing in are dropped: a list of things you cannot do
 * is not what the dashboard is for.
 */
function summariseAccess(
  permissions: string[],
): Array<{ key: string; label: string; held: number; total: number }> {
  const held = new Set(permissions);

  return PERMISSION_GROUPS.map((group) => ({
    key: group.key,
    label: group.label,
    held: group.permissions.filter((permission) => held.has(permission)).length,
    total: group.permissions.length,
  })).filter((area) => area.held > 0);
}

/** Makes the RBAC model visible — useful while building, and honest for users. */
function AccessCard({ session }: { session: SessionDto }) {
  const canManageRoles = can(session, { permission: PERMISSIONS.ROLE_READ });

  return (
    <Card className="rounded-2xl border-border bg-surface shadow-xs">
      <CardHeader className="flex items-center justify-between border-b border-border/70 px-5 py-4">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold text-ink">
          <ShieldCheck className="size-4 text-ink-muted" aria-hidden />
          Your access and roles
        </CardTitle>
        {canManageRoles && (
          <Link
            href="/settings/roles"
            className="inline-flex items-center gap-1 text-xs font-semibold text-ink underline-offset-2 hover:underline"
          >
            Manage roles
            <ArrowRight className="size-3.5" aria-hidden />
          </Link>
        )}
      </CardHeader>
      <CardBody className="space-y-4 px-5 py-4">
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-subtle">Assigned roles</p>
          <div className="flex flex-wrap gap-1.5">
            {session.user.roles.map((role) => (
              <Badge key={role.id} tone="neutral" className="px-2.5 py-1 text-xs font-medium">
                {role.name}
              </Badge>
            ))}
          </div>
        </div>
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-subtle">
            What you can reach ({session.permissions.length} permissions)
          </p>
          <div className="grid gap-x-4 gap-y-1.5 sm:grid-cols-2">
            {summariseAccess(session.permissions).map((area) => (
              <div key={area.key} className="flex items-baseline justify-between gap-2 text-xs">
                <span className="truncate text-ink">{area.label}</span>
                <span
                  className={
                    area.held === area.total
                      ? 'shrink-0 font-semibold tabular-nums text-success'
                      : 'shrink-0 tabular-nums text-ink-subtle'
                  }
                >
                  {area.held === area.total ? 'Full' : `${area.held} of ${area.total}`}
                </span>
              </div>
            ))}
          </div>
          {canManageRoles && (
            <p className="mt-3 text-[11px] text-ink-subtle">
              The individual permission codes are on{' '}
              <Link href="/settings/roles" className="font-medium text-ink underline underline-offset-2">
                Settings &rarr; Roles &amp; permissions
              </Link>
              .
            </p>
          )}
        </div>
      </CardBody>
    </Card>
  );
}
