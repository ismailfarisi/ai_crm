import Link from 'next/link';
import { CircleDot, Lock, Ruler, ShieldCheck } from 'lucide-react';
import { LiveQuoteDemo } from '@/components/marketing/live-quote-demo';

const TRUST_SIGNALS = [
  { icon: ShieldCheck, label: 'Permission-level RBAC on every request' },
  { icon: Lock, label: 'Sessions in httpOnly cookies with rotation' },
];

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="flex flex-col justify-center px-6 py-12 sm:px-12">
        <div className="mx-auto w-full max-w-sm">
          <Link href="/" className="mb-8 inline-flex items-center gap-2">
            <span className="grid size-8 place-items-center rounded-lg bg-brand text-white">
              <CircleDot className="size-4" />
            </span>
            <span className="text-base font-semibold tracking-tight">Relay CRM</span>
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
      */}
      <aside className="relative hidden overflow-hidden bg-brand lg:block">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(255,255,255,0.22),transparent_55%)]" />
        <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.06)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.06)_1px,transparent_1px)] bg-[size:3rem_3rem] [mask-image:radial-gradient(ellipse_at_center,black_30%,transparent_75%)]" />

        <div className="relative flex h-full flex-col justify-center gap-7 p-10 xl:p-12">
          <div>
            <p className="mb-3 inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-xs font-medium text-white ring-1 ring-white/20">
              <Ruler className="size-3.5" />
              Built for made-to-order work
            </p>
            <h2 className="max-w-md text-2xl font-bold leading-tight tracking-tight text-white xl:text-3xl">
              Quote custom work from what it actually costs to make.
            </h2>
            <p className="mt-3 max-w-md text-sm leading-relaxed text-white/80">
              If you manufacture to order, a unit price doesn&rsquo;t exist until you know the
              dimensions, the material yield and the machine time. Relay works it out from your own
              cost model.
            </p>
          </div>

          <LiveQuoteDemo />

          <ul className="flex flex-wrap gap-x-6 gap-y-2">
            {TRUST_SIGNALS.map((signal) => (
              <li key={signal.label} className="flex items-center gap-2 text-xs text-white/75">
                <signal.icon className="size-3.5 shrink-0" />
                {signal.label}
              </li>
            ))}
          </ul>
        </div>
      </aside>
    </div>
  );
}
