import type { ReactNode } from 'react';
import { ArrowRight, Check, CheckCircle2, Info } from 'lucide-react';
import type { NextStep } from '@/lib/next-step';
import { cn } from '@/lib/utils';

/**
 * One card at the top of a document: where the job is, what comes next, and
 * the one button for it. Other actions stay where they were, quieter.
 */
export function NextStepCard({
  step,
  action,
  className,
}: {
  step: NextStep<unknown>;
  /** The button for `step.action`, already permission-checked; null hides it. */
  action?: ReactNode;
  className?: string;
}) {
  const Icon = step.finished ? CheckCircle2 : ArrowRight;
  return (
    <section
      aria-labelledby="next-step-title"
      className={cn(
        'rounded-2xl border bg-surface p-4 shadow-2xs',
        step.finished ? 'border-border' : 'border-brand/40',
        className,
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span
            className={cn(
              'grid size-8 shrink-0 place-items-center rounded-full',
              step.finished ? 'bg-success-soft text-success' : 'bg-brand-soft text-ink',
            )}
          >
            <Icon className="size-4" aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-subtle">
              {step.finished ? 'Status' : 'Next step'}
            </p>
            <h2 id="next-step-title" className="text-base font-semibold text-ink">
              {step.title}
            </h2>
            <p className="mt-0.5 max-w-prose text-sm text-ink-muted">{step.detail}</p>
            {step.note && (
              <p className="mt-1 flex items-center gap-1.5 text-xs text-warning">
                <Info className="size-3.5" aria-hidden />
                {step.note}
              </p>
            )}
          </div>
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      {step.trail.length > 0 && (
        <ol className="mt-3 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs" aria-label="Progress">
          {step.trail.map((item, index) => (
            <li key={item.label} className="flex items-center gap-1.5">
              {index > 0 && <span className="h-px w-3 bg-border" aria-hidden />}
              <span
                className={cn(
                  'inline-flex items-center gap-1 rounded-full px-2 py-0.5',
                  item.done ? 'bg-success-soft text-success' : 'bg-surface-muted text-ink-subtle',
                )}
              >
                {item.done && <Check className="size-3" aria-hidden />}
                {item.label}
                <span className="sr-only">{item.done ? ' (done)' : ' (to do)'}</span>
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
