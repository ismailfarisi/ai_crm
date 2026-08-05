import Link from 'next/link';
import { CircleDot, Lock, ShieldCheck, Users } from 'lucide-react';

const FEATURES = [
  { icon: ShieldCheck, label: 'Permission-level RBAC on every request' },
  { icon: Users, label: 'Contacts scoped to owner, team, or organization' },
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

      {/* Decorative panel — hidden on small screens rather than squeezed. */}
      <aside className="relative hidden overflow-hidden bg-brand lg:block">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(255,255,255,0.22),transparent_55%)]" />
        <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.06)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.06)_1px,transparent_1px)] bg-[size:3rem_3rem] [mask-image:radial-gradient(ellipse_at_center,black_30%,transparent_75%)]" />
        <div className="relative flex h-full flex-col justify-end gap-10 p-12 text-white">
          <ul className="space-y-3">
            {FEATURES.map((feature) => (
              <li key={feature.label} className="flex items-center gap-3 text-sm text-white/80">
                <span className="grid size-7 shrink-0 place-items-center rounded-md bg-white/10 ring-1 ring-white/15">
                  <feature.icon className="size-3.5" />
                </span>
                {feature.label}
              </li>
            ))}
          </ul>
          <div>
            <blockquote className="max-w-md text-xl leading-relaxed font-medium">
              &ldquo;Every rep sees their own book. Managers see the whole pipeline. Nobody sees the
              billing page by accident.&rdquo;
            </blockquote>
            <p className="mt-4 text-sm text-white/70">
              Role-based access control, enforced on every request.
            </p>
          </div>
        </div>
      </aside>
    </div>
  );
}
