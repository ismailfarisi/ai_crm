import { Check } from 'lucide-react';
import type { Metadata } from 'next';
import { ButtonLink, Container, SectionHeading } from '@/components/ui';
import { site } from '@/lib/site';

export const metadata: Metadata = {
  title: 'Pricing',
  description: 'Kerf is priced per seat with every module included. Start with a 14-day free trial.',
};

const included = [
  ['CRM & pipeline', 'Contacts, companies, shared inbox, board and table views, custom objects'],
  ['Costing & quotes', 'Costing formulas, sheet nesting, margin floors, approvals, branded PDFs, accept-online links'],
  ['Production', 'Sales orders, work orders, steps and time logging'],
  ['Stock & purchasing', 'Multi-location stock, reservations, reorder points, purchase orders, supplier bills'],
  ['Finance', 'Invoices, payments, credit notes, double-entry books, VAT, multi-currency, reports'],
  ['WhatsApp & AI', 'The Kerf assistant in the app and on WhatsApp and Telegram, with approvals and an audit trail'],
  ['Automations', 'Follow-ups, escalations and approval routing on a durable workflow engine'],
  ['Security', 'Database-level isolation, roles and permissions, full audit trail'],
] as const;

const faqs = [
  ['How are seats counted?', 'Automatically, from the people active in your workspace. Nobody has to remember to add a seat — or to remove one.'],
  ['What happens after the trial?', 'Choose a plan to keep working. If you don’t, nothing is deleted: you can still sign in and read everything.'],
  ['Do you help with setup?', 'Yes. During early access we set Kerf up with your products, materials and rates, and bring your customers across for you.'],
] as const;

export default function PricingPage() {
  return (
    <>
      <section className="border-b border-line bg-paper">
        <Container className="py-20 text-center sm:py-28">
          <h1 className="mx-auto max-w-3xl text-4xl font-semibold tracking-tight text-balance sm:text-6xl">
            Priced per seat. Every module included.
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg text-ink-muted">
            No add-ons to unlock the parts that make you money. Start with a 14-day free trial — no
            card needed.
          </p>
        </Container>
      </section>

      <section className="py-20">
        <Container className="grid gap-10 lg:grid-cols-[1fr_1.4fr]">
          <div className="h-fit rounded-3xl border border-line p-8 lg:sticky lg:top-32">
            <p className="text-sm font-medium tracking-wide text-cut uppercase">Early access</p>
            <p className="mt-4 text-3xl font-semibold tracking-tight">Founding customer pricing</p>
            <p className="mt-3 text-ink-muted">
              We’re onboarding our first UAE manufacturers by hand. Founding customers get a guided
              setup and a locked-in rate.
            </p>
            <div className="mt-8 flex flex-col gap-3">
              <ButtonLink href={site.demoUrl}>Talk to us about pricing</ButtonLink>
              <ButtonLink href={site.signUpUrl} variant="secondary">
                Start free trial
              </ButtonLink>
            </div>
          </div>

          <div>
            <h2 className="text-xl font-semibold">Everything in every plan</h2>
            <ul className="mt-6 divide-y divide-line border-y border-line">
              {included.map(([title, body]) => (
                <li key={title} className="flex gap-4 py-5">
                  <Check className="mt-0.5 h-5 w-5 shrink-0 text-good" />
                  <div>
                    <p className="font-medium">{title}</p>
                    <p className="mt-1 text-ink-muted">{body}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </Container>
      </section>

      <section className="border-t border-line py-20">
        <Container className="grid gap-12 lg:grid-cols-[1fr_1.6fr]">
          <SectionHeading title="Pricing questions" />
          <div className="divide-y divide-line border-y border-line">
            {faqs.map(([q, a]) => (
              <details key={q} className="group py-5">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-medium">
                  {q}
                  <span className="text-xl text-ink-subtle transition group-open:rotate-45">+</span>
                </summary>
                <p className="mt-3 leading-relaxed text-ink-muted">{a}</p>
              </details>
            ))}
          </div>
        </Container>
      </section>
    </>
  );
}
