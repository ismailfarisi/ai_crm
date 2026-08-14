import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/utils';

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'bg-surface/85 backdrop-blur-xs rounded-2xl border border-border/30 shadow-[0_2px_10px_rgba(0,0,0,0.015)] transition-all',
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('border-b border-border/25 px-6 py-4', className)} {...props} />;
}

export function CardTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return <h2 className={cn('text-sm font-semibold tracking-tight text-ink', className)} {...props} />;
}

export function CardBody({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('px-6 py-5', className)} {...props} />;
}

type BadgeTone = 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'info';

const BADGE_TONES: Record<BadgeTone, string> = {
  neutral: 'bg-surface-muted text-ink-muted border-border/40',
  brand: 'bg-brand-soft/80 text-ink border-brand/20',
  success: 'bg-success-soft/80 text-success border-success/20',
  warning: 'bg-warning-soft/80 text-warning border-warning/20',
  danger: 'bg-danger-soft/80 text-danger border-danger/20',
  info: 'bg-info-soft/80 text-info border-info/20',
};

export function Badge({
  tone = 'neutral',
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement> & { tone?: BadgeTone }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-medium tracking-wide whitespace-nowrap transition-colors',
        BADGE_TONES[tone],
        className,
      )}
      {...props}
    />
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-ink">{title}</h1>
        {description && <p className="mt-1 text-sm text-ink-muted">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
      {icon && <div className="mb-3 text-ink-subtle">{icon}</div>}
      <p className="text-sm font-semibold text-ink">{title}</p>
      {description && <p className="mt-1 max-w-sm text-sm text-ink-muted">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-xl bg-surface-muted/60', className)} />;
}

export function Alert({
  tone = 'danger',
  children,
}: {
  tone?: 'danger' | 'warning' | 'info' | 'success';
  children: ReactNode;
}) {
  const tones = {
    danger: 'bg-danger-soft/80 text-danger border border-danger/20',
    warning: 'bg-warning-soft/80 text-warning border border-warning/20',
    info: 'bg-info-soft/80 text-info border border-info/20',
    success: 'bg-success-soft/80 text-success border border-success/20',
  } as const;

  return (
    <div role="alert" className={cn('rounded-xl px-4 py-3 text-sm font-medium', tones[tone])}>
      {children}
    </div>
  );
}
