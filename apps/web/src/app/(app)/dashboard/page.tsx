import type { Metadata } from 'next';
import Link from 'next/link';
import {
  ArrowRight,
  CalendarDays,
  FilePlus2,
  ShieldCheck,
  Star,
  UserPlus,
  Users,
  type LucideIcon,
} from 'lucide-react';
import {
  CONTACT_STATUS_LABELS,
  PERMISSIONS,
  type ContactStatsDto,
  type SessionDto,
} from '@saas/shared';
import { serverFetchOrNull } from '@/lib/api/server';
import { can } from '@/lib/access';
import { requireSession } from '@/lib/get-session';
import { Badge, Card, CardBody, CardHeader, CardTitle } from '@/components/ui/primitives';
import { DashboardGaugeWidget } from '@/components/dashboard/dashboard-gauge-widget';
import { DashboardKpiChart } from '@/components/dashboard/dashboard-kpi-chart';
import { DashboardScheduleCards } from '@/components/dashboard/dashboard-schedule-cards';

export const metadata: Metadata = { title: 'Dashboard' };

function getGreeting(date: Date = new Date()): string {
  const hour = date.getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

function getFormattedDate(date: Date = new Date()): string {
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

export default async function DashboardPage() {
  const session = await requireSession();
  const now = new Date();
  const greeting = getGreeting(now);
  const formattedDate = getFormattedDate(now);

  // Returns null rather than throwing when the user lacks contact:read.
  const stats = await serverFetchOrNull<ContactStatsDto>('/contacts/stats');

  return (
    <div className="space-y-6">
      {/* Hero Greeting Header Banner */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-border/80 bg-surface p-6 shadow-xs">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-ink sm:text-3xl">
            {greeting}, {session.user.firstName}
          </h1>
          <p className="mt-1 text-sm text-ink-muted">
            It&apos;s {formattedDate} • You&apos;re signed in to <strong className="font-semibold text-ink">{session.organization.name}</strong>.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <Link
            href="/quotes/new"
            className="inline-flex items-center gap-1.5 rounded-xl bg-brand px-3.5 py-2 text-xs font-semibold text-white shadow-xs transition-all hover:bg-brand-hover hover:shadow-sm"
          >
            <FilePlus2 className="size-3.5" />
            Create Quote
          </Link>
          <Link
            href="/contacts"
            className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-surface-muted/60 px-3.5 py-2 text-xs font-semibold text-ink transition-all hover:bg-surface-muted hover:text-ink"
          >
            View Contacts
          </Link>
        </div>
      </div>

      {stats ? (
        <>
          {/* Top Row: 4 Stat Chips (col-span-8) + Circular Gauge Widget (col-span-4) */}
          <div className="grid gap-5 lg:grid-cols-12">
            <div className="grid gap-3.5 sm:grid-cols-2 lg:col-span-8">
              <Stat label="Total contacts" value={stats.total} icon={Users} tone="brand" />
              <Stat label="Added this week" value={stats.createdThisWeek} icon={UserPlus} tone="info" />
              <Stat label="Added this month" value={stats.createdThisMonth} icon={CalendarDays} tone="warning" />
              <Stat label="Active Customers" value={stats.byStatus.customer} icon={Star} tone="success" />
            </div>

            <div className="lg:col-span-4">
              <DashboardGaugeWidget
                percentage={84}
                targetPercentage={80}
                title="Quotation Win Rate"
                subtitle="Customer Satisfaction"
                trendLabel="+12.4% this month"
                className="h-full"
              />
            </div>
          </div>

          {/* Middle Row: Golden Wave KPI Chart (60% width) + Warm Schedule & Deals Cards (40% width) */}
          <div className="grid gap-5 lg:grid-cols-12">
            <div className="lg:col-span-7">
              <DashboardKpiChart
                title="Revenue & Conversion Velocity"
                metricLabel="Team Conversion KPI"
                metricValue="72.4%"
                growthLabel="+14.8% YoY"
                className="h-full"
              />
            </div>

            <div className="lg:col-span-5">
              <DashboardScheduleCards className="h-full" />
            </div>
          </div>

          {/* Bottom Row: Pipeline Status Breakdown + User RBAC Access */}
          <div className="grid items-start gap-5 lg:grid-cols-2">
            <Card className="rounded-2xl border-border bg-surface shadow-xs">
              <CardHeader className="flex items-center justify-between border-b border-border/70 px-5 py-4">
                <CardTitle className="text-sm font-semibold text-ink">Contacts Pipeline by Status</CardTitle>
                <Link
                  href="/contacts"
                  className="inline-flex items-center gap-1 text-xs font-semibold text-brand hover:underline"
                >
                  View contacts
                  <ArrowRight className="size-3.5" />
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
                          <span className="text-ink-subtle">{Math.round(share)}%</span>
                          <span className="font-semibold tabular-nums text-ink">{count}</span>
                        </div>
                      </div>
                      <div
                        className="h-2.5 overflow-hidden rounded-full bg-surface-muted"
                        role="img"
                        aria-label={`${count} contacts, ${Math.round(share)} percent of the pipeline`}
                      >
                        <div
                          className="h-full rounded-full bg-brand transition-[width] duration-500"
                          style={{ width: `${share}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </CardBody>
            </Card>

            <AccessCard session={session} />
          </div>
        </>
      ) : (
        <div className="grid gap-5 lg:grid-cols-2">
          <Card className="rounded-2xl border-border bg-surface shadow-xs">
            <CardBody className="py-8 text-center text-sm text-ink-muted">
              Your role doesn&apos;t include access to contacts statistics. Ask an administrator if you think that&apos;s wrong.
            </CardBody>
          </Card>
          <AccessCard session={session} />
        </div>
      )}
    </div>
  );
}

const STAT_TONES = {
  brand: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  info: 'bg-sky-500/15 text-sky-600 dark:text-sky-400',
  warning: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  success: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
} as const;

function Stat({
  label,
  value,
  icon: Icon,
  tone,
}: {
  label: string;
  value: number;
  icon: LucideIcon;
  tone: keyof typeof STAT_TONES;
}) {
  return (
    <Card className="rounded-2xl border-border bg-surface p-4 shadow-xs transition-all hover:shadow-sm">
      <div className="flex items-center gap-3.5">
        <span
          className={`grid size-11 shrink-0 place-items-center rounded-xl ${STAT_TONES[tone]}`}
        >
          <Icon className="size-5" />
        </span>
        <div className="min-w-0">
          <p className="truncate text-xs font-semibold tracking-wide text-ink-subtle uppercase">
            {label}
          </p>
          <p className="mt-0.5 text-2xl font-extrabold tabular-nums tracking-tight text-ink">
            {value}
          </p>
        </div>
      </div>
    </Card>
  );
}

/** Makes the RBAC model visible — useful while building, and honest for users. */
function AccessCard({ session }: { session: SessionDto }) {
  const canManageRoles = can(session, { permission: PERMISSIONS.ROLE_READ });

  return (
    <Card className="rounded-2xl border-border bg-surface shadow-xs">
      <CardHeader className="flex items-center justify-between border-b border-border/70 px-5 py-4">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold text-ink">
          <ShieldCheck className="size-4 text-amber-600 dark:text-amber-400" />
          Your Access & Roles
        </CardTitle>
        {canManageRoles && (
          <Link
            href="/settings/roles"
            className="inline-flex items-center gap-1 text-xs font-semibold text-brand hover:underline"
          >
            Manage roles
            <ArrowRight className="size-3.5" />
          </Link>
        )}
      </CardHeader>
      <CardBody className="space-y-4 px-5 py-4">
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-subtle">Assigned Roles</p>
          <div className="flex flex-wrap gap-1.5">
            {session.user.roles.map((role) => (
              <Badge key={role.id} tone="brand" className="rounded-lg px-2.5 py-1 text-xs font-medium">
                {role.name}
              </Badge>
            ))}
          </div>
        </div>
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-subtle">
            Active Permissions ({session.permissions.length})
          </p>
          <div className="flex flex-wrap gap-1.5">
            {session.permissions.map((permission) => (
              <Badge key={permission} className="rounded-lg border-border/60 bg-surface-muted/60 font-mono text-[11px] text-ink-muted">
                {permission}
              </Badge>
            ))}
          </div>
        </div>
      </CardBody>
    </Card>
  );
}
