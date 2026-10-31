import Link from 'next/link';
import { History, ShieldCheck } from 'lucide-react';
import { KerfMark } from '@/components/brand/kerf-mark';
import { LiveQuoteDemo } from '@/components/marketing/live-quote-demo';

const TRUST_SIGNALS = [
  { icon: ShieldCheck, label: 'Roles decide what each person sees' },
  { icon: History, label: 'Every change is recorded: who, what and when' },
];

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="flex flex-col justify-center px-6 py-12 sm:px-12">
        <div className="mx-auto w-full max-w-sm">
          <Link href="/" className="mb-8 inline-flex items-center gap-2">
            {/* The mark's near-black square sinks into the dark canvas; a hairline keeps its edge. */}
            <KerfMark className="size-8 rounded-[9px] dark:ring-1 dark:ring-border-strong" />
            <span className="text-base font-semibold tracking-tight text-ink">Kerf</span>
          </Link>
          {children}
        </div>
      </div>

      {/*
        Decorative panel — hidden on small screens rather than squeezed. It
        carries the product story and a working cost model rather than a
        stock illustration: the demo below runs the real pricing engine in the
        browser, so a visitor can move a dimension and watch the price step
        before they have an account.

        A recessed sheet in Workshop Ink, not an amber field: amber is spent on
        the one button that signs you in (the One Cut rule).
      */}
      <aside className="hidden border-s border-border bg-surface-muted lg:block">
        <div className="flex h-full flex-col justify-center gap-7 p-10 xl:p-12">
          <div>
            <h2 className="max-w-md text-2xl font-bold leading-tight tracking-tight text-balance text-ink xl:text-3xl">
              Quote custom work from what it actually costs to make.
            </h2>
            <p className="mt-3 max-w-md text-sm leading-relaxed text-ink-muted">
              If you manufacture to order, a unit price doesn&rsquo;t exist until you know the
              dimensions, the material yield and the machine time. Kerf works it out from your own
              cost model.
            </p>
          </div>

          <LiveQuoteDemo />

          <ul className="flex flex-wrap gap-x-6 gap-y-2">
            {TRUST_SIGNALS.map((signal) => (
              <li key={signal.label} className="flex items-center gap-2 text-xs text-ink-muted">
                <signal.icon className="size-3.5 shrink-0" aria-hidden />
                {signal.label}
              </li>
            ))}
          </ul>
        </div>
      </aside>
    </div>
  );
}
