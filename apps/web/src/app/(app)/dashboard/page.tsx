import type { Metadata } from 'next';
import Link from 'next/link';
import {
  ArrowRight,
  CalendarDays,
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
import { Badge, Card, CardBody, CardHeader, CardTitle, PageHeader } from '@/components/ui/primitives';

export const metadata: Metadata = { title: 'Dashboard' };

export default async function DashboardPage() {
  const session = await requireSession();

  // Returns null rather than throwing when the user lacks contact:read.
  const stats = await serverFetchOrNull<ContactStatsDto>('/contacts/stats');

  return (
    <>
      <PageHeader
        title={`Good to see you, ${session.user.firstName}`}
        description={`You're signed in to ${session.organization.name}.`}
      />

      {stats ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Total contacts" value={stats.total} icon={Users} tone="brand" />
            <Stat label="Added this week" value={stats.createdThisWeek} icon={UserPlus} tone="info" />
            <Stat label="Added this month" value={stats.createdThisMonth} icon={CalendarDays} tone="warning" />
            <Stat label="Customers" value={stats.byStatus.customer} icon={Star} tone="success" />
          </div>

          <div className="grid items-start gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader className="flex items-center justify-between">
                <CardTitle>Pipeline by status</CardTitle>
                <Link
                  href="/contacts"
                  className="inline-flex items-center gap-1 text-sm font-medium text-brand hover:underline"
                >
                  View contacts
                  <ArrowRight className="size-3.5" />
                </Link>
              </CardHeader>
              <CardBody className="space-y-3">
                {Object.entries(stats.byStatus).map(([status, count]) => {
                  const share = stats.total > 0 ? (count / stats.total) * 100 : 0;
                  return (
                    <div key={status}>
                      <div className="mb-1 flex items-baseline justify-between text-sm">
                        <span className="text-ink">
                          {CONTACT_STATUS_LABELS[status as keyof typeof CONTACT_STATUS_LABELS]}
                        </span>
                        <span className="text-ink-muted tabular-nums">{count}</span>
                      </div>
                      <div
                        className="h-2 overflow-hidden rounded-full bg-surface-muted"
                        role="img"
                        aria-label={`${count} contacts, ${Math.round(share)} percent of the pipeline`}
                      >
                        <div
                          className="h-full rounded-full bg-brand transition-[width]"
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
        <Card>
          <CardBody className="text-sm text-ink-muted">
            Your role doesn&apos;t include access to contacts. Ask an administrator if you think
            that&apos;s wrong.
          </CardBody>
        </Card>
      )}

      {!stats && <AccessCard session={session} />}
    </>
  );
}

const STAT_TONES = {
  brand: 'bg-brand-soft text-brand',
  info: 'bg-info-soft text-info',
  warning: 'bg-warning-soft text-warning',
  success: 'bg-success-soft text-success',
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
    <Card>
      <CardBody className="flex items-center gap-4">
        <span
          className={`grid size-10 shrink-0 place-items-center rounded-lg ${STAT_TONES[tone]}`}
        >
          <Icon className="size-5" />
        </span>
        <div className="min-w-0">
          <p className="truncate text-xs font-medium tracking-wide text-ink-subtle uppercase">
            {label}
          </p>
          <p className="mt-0.5 text-2xl font-semibold tabular-nums text-ink">{value}</p>
        </div>
      </CardBody>
    </Card>
  );
}

/** Makes the RBAC model visible — useful while building, and honest for users. */
function AccessCard({ session }: { session: SessionDto }) {
  const canManageRoles = can(session, { permission: PERMISSIONS.ROLE_READ });

  return (
    <Card>
      <CardHeader className="flex items-center justify-between">
        <CardTitle className="flex items-center gap-2">
          <ShieldCheck className="size-4 text-ink-subtle" />
          Your access
        </CardTitle>
        {canManageRoles && (
          <Link
            href="/settings/roles"
            className="inline-flex items-center gap-1 text-sm font-medium text-brand hover:underline"
          >
            Manage roles
            <ArrowRight className="size-3.5" />
          </Link>
        )}
      </CardHeader>
      <CardBody className="space-y-4">
        <div>
          <p className="mb-2 text-xs font-medium tracking-wide text-ink-subtle uppercase">Roles</p>
          <div className="flex flex-wrap gap-1.5">
            {session.user.roles.map((role) => (
              <Badge key={role.id} tone="brand">
                {role.name}
              </Badge>
            ))}
          </div>
        </div>
        <div>
          <p className="mb-2 text-xs font-medium tracking-wide text-ink-subtle uppercase">
            Permissions ({session.permissions.length})
          </p>
          <div className="flex flex-wrap gap-1.5">
            {session.permissions.map((permission) => (
              <Badge key={permission} className="font-mono">
                {permission}
              </Badge>
            ))}
          </div>
        </div>
      </CardBody>
    </Card>
  );
}
