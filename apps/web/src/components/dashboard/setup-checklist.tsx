import Link from 'next/link';
import { ArrowRight, Check, Circle } from 'lucide-react';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/primitives';

export interface SetupStep {
  key: string;
  label: string;
  /** What is missing, and why it matters — not a restatement of the label. */
  detail: string;
  href: string;
  done: boolean;
}

/**
 * What a new tenant still has to do, and where.
 *
 * Sign-up asked for a company name, a person and a password, and then dropped
 * the account on the dashboard with no wizard, no checklist and no prompt —
 * while quietly deciding the base currency and leaving the business with no
 * cash account, no tax code, no catalog and no address on its documents. This
 * is not a wizard, which would be in the way on the second visit; it is a list
 * that says what is missing and disappears when nothing is.
 */
export function SetupChecklist({ steps }: { steps: SetupStep[] }) {
  const remaining = steps.filter((step) => !step.done);
  if (remaining.length === 0) return null;

  const done = steps.length - remaining.length;

  return (
    <Card className="rounded-2xl border-brand/30 bg-brand-soft/30 shadow-xs">
      <CardHeader className="flex items-center justify-between border-b border-border/70 px-5 py-4">
        <CardTitle className="text-sm font-semibold text-ink">Finish setting up</CardTitle>
        <span className="text-xs font-medium tabular-nums text-ink-muted">
          {done} of {steps.length} done
        </span>
      </CardHeader>
      <CardBody className="divide-y divide-border/40 px-5 py-1">
        {steps.map((step) => (
          <div key={step.key} className="flex items-start gap-3 py-3">
            {step.done ? (
              <Check className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
            ) : (
              <Circle className="mt-0.5 size-4 shrink-0 text-ink-subtle" />
            )}
            <div className="min-w-0 flex-1">
              <p
                className={
                  step.done
                    ? 'text-sm text-ink-subtle line-through'
                    : 'text-sm font-medium text-ink'
                }
              >
                {step.label}
              </p>
              {!step.done && <p className="mt-0.5 text-xs text-ink-muted">{step.detail}</p>}
            </div>
            {!step.done && (
              <Link
                href={step.href}
                className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-brand hover:underline"
              >
                Set up
                <ArrowRight className="size-3.5" />
              </Link>
            )}
          </div>
        ))}
      </CardBody>
    </Card>
  );
}
