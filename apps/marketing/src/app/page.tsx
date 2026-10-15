import {
  ArrowRight,
  BellRing,
  Check,
  Clock,
  FileLock2,
  History,
  KeyRound,
  Minus,
  Server,
  ShieldCheck,
  X,
} from 'lucide-react';
import { ChatThread, type ChatMessage } from '@/components/scenes/chat';
import { CostPanel } from '@/components/scenes/cost-panel';
import {
  InboxScene,
  LedgerScene,
  QuoteDocScene,
  StockScene,
  WorkOrderScene,
} from '@/components/scenes/journey-scenes';
import { NestingDemo } from '@/components/scenes/nesting-demo';
import { ButtonLink, Container, Eyebrow, SectionHeading } from '@/components/ui';
import { site } from '@/lib/site';

/*
 * Staff talk to Kerf in their own chat with it — Kerf never speaks in a
 * customer's thread. Anything that changes data is confirmed first.
 */
const heroThread: ChatMessage[] = [
  {
    from: 'Sara',
    time: '09:14',
    side: 'me',
    body: (
      <>
        <span className="block text-xs text-ink-muted italic">Forwarded from Al Noor Sweets</span>
        Need 5,000 rigid boxes, 200×150×60, gold foil lid. Price by tomorrow?
      </>
    ),
  },
  { from: 'Sara', time: '09:14', side: 'me', body: 'Quote this for Al Noor' },
  {
    from: 'Kerf',
    time: '09:14',
    side: 'kerf',
    body: (
      <>
        Rigid box 200×150×60 with foil lid, 5,000 pcs. 4-up on 1000×700 greyboard → 1,250 sheets.
        <br />
        Unit cost AED 3.18 · price AED 4.60 · margin <b>31%</b>, above your 25% floor. Create the
        quote?
      </>
    ),
  },
  { from: 'Sara', time: '09:15', side: 'me', body: 'Yes 👍' },
  {
    from: 'Kerf',
    time: '09:15',
    side: 'kerf',
    body: (
      <>
        Created <b>Q-1042</b> for Al Noor Sweets — AED 23,000 + VAT. It’s waiting for Omar’s
        approval.
      </>
    ),
  },
];

const trueCost = [
  ['It nests the sheet.', 'Kerf works out how many blanks fit on the board you actually buy, grain and gripper margin included.'],
  ['It counts the step.', 'Material cost jumps when one fewer blank fits. Kerf sees the jump before you quote.'],
  ['It adds the real time.', 'Machine hours and labour from your own rates, not a rule of thumb.'],
  ['It protects the floor.', 'Set a minimum margin and a discount cap. Quotes that break them wait for approval.'],
  ['It remembers the cost.', 'Every line keeps the cost it was quoted at, so you can check quoted against actual later.'],
] as const;

const journey = [
  {
    id: 'win',
    tab: 'Win the enquiry',
    title: 'Every enquiry, wherever it starts.',
    body: 'WhatsApp, email and Telegram land in one shared inbox, matched to the right customer. Your pipeline shows every open job at a glance — as a table or a board, filtered and saved the way each person works.',
    points: [
      'Contacts, companies and a full activity history',
      'Board and table views, saved per person',
      'Custom objects for anything you track — machines, dies, certifications',
      'Roles that decide who sees what, down to “only my own customers”',
    ],
    scene: <InboxScene />,
  },
  {
    id: 'quote',
    tab: 'Quote it',
    title: 'Quote in minutes. Know your margin before you send.',
    body: 'Pick a template, enter the size and quantity, and Kerf builds the cost from board, print, finishing and machine time. Then it prices to your margin and lays it out on your branded document.',
    points: [
      'Costing formulas built from your own materials and rates',
      'Margin floors, discount caps and approval rules',
      'Branded PDF quotes in your own layout',
      'A secure link your customer opens to review and accept online',
    ],
    scene: <QuoteDocScene />,
  },
  {
    id: 'make',
    tab: 'Make it',
    title: 'The order arrives. The work order is already waiting.',
    body: 'An accepted quote becomes a sales order, and the sales order becomes work orders with every step laid out. Operators log their hours from the floor — in the app, or with a WhatsApp message.',
    points: [
      'Sales orders and staged billing from accepted quotes',
      'Work orders with steps, scheduling and status',
      'Time logged against each job, by person and machine',
    ],
    scene: <WorkOrderScene />,
  },
  {
    id: 'buy',
    tab: 'Buy & stock',
    title: 'Buy exactly what the job needs.',
    body: 'Kerf knows what each order uses, what is on the shelf and what is already promised. Raise purchase orders to suppliers in a couple of clicks, and match their bills to what you ordered.',
    points: [
      'Stock across several locations, reserved per job',
      'Reorder points so you never run out mid-run',
      'Purchase orders, supplier bills and payables',
    ],
    scene: <StockScene />,
  },
  {
    id: 'paid',
    tab: 'Deliver & get paid',
    title: 'From dispatch to the books, without re-typing a thing.',
    body: 'Dispatch the delivery, invoice the customer, record the payment. Every step posts to real double-entry books, so your P&L, cashflow and VAT are right the moment the work is done.',
    points: [
      'Deliveries, invoices, payments and credit notes',
      'A chart of accounts, P&L and cashflow',
      'VAT and tax rules per country, with multi-currency built in',
      'Reports your accountant can export',
    ],
    scene: <LedgerScene />,
  },
];

const commands = [
  ['“Quote Al Noor 5,000 boxes, foil lid”', 'Drafts a costed quote'],
  ['“Approve Q-1042”', 'Approves it, if you are allowed to'],
  ['“Where’s WO-318?”', 'Tells you where the job is'],
  ['“Log 3.5h die-cutting on WO-318”', 'Records the time against the job'],
  ['“Order 2,000 sheets of 2mm greyboard”', 'Raises the purchase order'],
  ['Forward a customer’s PO', 'Turns it into a sales order'],
  ['“Dispatch order 552”', 'Books the delivery'],
] as const;

const floorThread: ChatMessage[] = [
  { from: 'Omar', time: '10:02', side: 'me', body: 'Approve Q-1042' },
  {
    from: 'Kerf',
    time: '10:02',
    side: 'kerf',
    body: (
      <>
        <b>Q-1042</b> · Al Noor Sweets · AED 23,000 + VAT · margin 31%. Approve it?
      </>
    ),
  },
  { from: 'Omar', time: '10:03', side: 'me', body: 'Yes' },
  { from: 'Kerf', time: '10:03', side: 'kerf', body: 'Approved. Sara can send it to the customer.' },
  { from: 'Omar', time: '15:52', side: 'me', body: 'Where’s WO-318?' },
  {
    from: 'Kerf',
    time: '15:52',
    side: 'kerf',
    body: (
      <>
        WO-318 · 5,000 rigid boxes · 3 of 5 steps done. Die-cut finished this afternoon (3.5h
        logged by Ravi). Next up: Wrap.
      </>
    ),
  },
];

const security = [
  { icon: Server, title: 'Isolated at the database.', body: 'Every company’s data is walled off by the database itself, not just by application code.' },
  { icon: KeyRound, title: 'Permissions checked every time.', body: 'Access is worked out fresh on every request — never trusted from a login token.' },
  { icon: History, title: 'Every change on the record.', body: 'A complete audit trail shows who changed what, with the before and after.' },
  { icon: FileLock2, title: 'Files shared safely.', body: 'Attachments follow the record’s permissions, and downloads use short-lived signed links.' },
  { icon: ShieldCheck, title: 'AI that asks first.', body: 'The assistant can prepare drafts on its own, but anything more waits for a person to approve it.' },
];

type Mark = 'yes' | 'no' | 'partly';
const comparison: [string, Mark, Mark, Mark][] = [
  ['Quotes priced from real cost', 'yes', 'no', 'partly'],
  ['Quote → work order → invoice, no re-typing', 'yes', 'no', 'yes'],
  ['Real double-entry books', 'yes', 'partly', 'yes'],
  ['Works from WhatsApp', 'yes', 'no', 'no'],
  ['Live in days, not months', 'yes', 'partly', 'no'],
  ['Priced for a 10-person shop', 'yes', 'partly', 'no'],
];

const faqs = [
  ['Is Kerf a CRM or an ERP?', 'Both, sized for a growing workshop. It starts where a CRM starts — customers and enquiries — and keeps going through quoting, production, stock and the books.'],
  ['Do I still need separate accounting software?', 'Kerf keeps real double-entry books with invoices, payments, VAT and reports. Many teams run on Kerf alone; others export reports for their accountant.'],
  ['What kinds of businesses is it for?', 'Any business that makes or finishes to order: packaging, print, signage, fabrication, joinery and fit-out.'],
  ['How do I move over from Excel?', 'During early access we set you up ourselves and bring your customers and products across for you.'],
  ['Is the AI safe to let loose on my data?', 'It can prepare drafts, but anything more — and every message to a customer — waits for a person to approve it. Every change it makes is logged with who asked for it.'],
  ['Does it work in Arabic?', 'Arabic is on the way. Kerf is in English today.'],
] as const;

export default function HomePage() {
  return (
    <>
      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-[560px] bg-[radial-gradient(60%_60%_at_50%_0%,oklch(0.96_0.045_80)_0%,transparent_100%)]" />
        <Container className="relative pt-16 pb-20 text-center sm:pt-24">
          <a
            href="#true-cost"
            className="inline-flex items-center gap-1.5 rounded-full border border-line bg-white px-3.5 py-1.5 text-sm text-ink-muted shadow-sm hover:text-ink"
          >
            See why 1mm can cost you 33% more board <ArrowRight className="h-3.5 w-3.5" />
          </a>
          <h1 className="mx-auto mt-7 max-w-4xl text-5xl font-semibold tracking-tight text-balance sm:text-7xl">
            The CRM that counts every cut.
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-pretty text-ink-muted sm:text-xl">
            Kerf runs your whole made-to-order business — customers, costed quotes, production,
            stock and the books — in one place. From your desk, or from WhatsApp.
          </p>
          <div className="mt-9 flex flex-wrap justify-center gap-3">
            <ButtonLink href={site.demoUrl} variant="secondary">
              Book a demo
            </ButtonLink>
            <ButtonLink href={site.signUpUrl}>Start free trial</ButtonLink>
          </div>
          <p className="mt-4 text-sm text-ink-subtle">
            14-day free trial · No card needed · Live in an afternoon
          </p>

          <div className="mx-auto mt-16 grid max-w-5xl items-start gap-6 text-left lg:grid-cols-[1.1fr_1fr]">
            <ChatThread title="Kerf" subtitle="Sara’s chat with Kerf · WhatsApp" messages={heroThread} />
            <div className="hidden lg:block lg:pt-16">
              <CostPanel />
            </div>
          </div>
        </Container>
      </section>

      {/* Problem */}
      <section className="border-y border-line bg-paper py-24">
        <Container>
          <SectionHeading
            center
            title="Your quote is in Excel. Your customer is in WhatsApp. Your margin is a guess."
          >
            Made-to-order businesses run on five disconnected tools and one person’s memory. Sales
            prices from last year’s spreadsheet. Production hears about the job when the order
            lands. Accounts find out when the customer doesn’t pay. Every hand-off loses something
            — usually money. Kerf is one system from the first message to the final payment.
          </SectionHeading>
        </Container>
      </section>

      {/* True Cost */}
      <section id="true-cost" className="py-24 sm:py-32">
        <Container className="grid items-center gap-14 lg:grid-cols-2">
          <div>
            <Eyebrow>The only CRM with</Eyebrow>
            <h2 className="text-4xl font-semibold tracking-tight sm:text-6xl">True Cost™</h2>
            <p className="mt-5 text-lg leading-relaxed text-ink-muted">
              Every Kerf quote starts from what the job actually costs to make — not a price list.
              A blank 1mm too wide to fit 4-up costs you 33% more board. Kerf knows. Your
              spreadsheet doesn’t.
            </p>
            <dl className="mt-10 flex flex-col gap-5">
              {trueCost.map(([title, body]) => (
                <div key={title} className="border-l-2 border-cut pl-4">
                  <dt className="font-semibold">{title}</dt>
                  <dd className="mt-1 text-ink-muted">{body}</dd>
                </div>
              ))}
            </dl>
          </div>
          <div>
            <NestingDemo />
            <p className="mt-3 text-center text-sm text-ink-subtle">
              Computed by the same nesting engine Kerf uses to cost your quotes.
            </p>
          </div>
        </Container>
      </section>

      {/* Journey */}
      <section className="border-t border-line">
        <div className="sticky top-[var(--header-h,6.6rem)] z-30 border-b border-line bg-white/90 backdrop-blur-md">
          <Container>
            <nav className="-mx-1 flex gap-1 overflow-x-auto py-2.5" aria-label="From enquiry to payment">
              {journey.map((step, i) => (
                <a
                  key={step.id}
                  href={`#${step.id}`}
                  className="shrink-0 rounded-lg px-3 py-1.5 text-sm text-ink-muted hover:bg-paper hover:text-ink"
                >
                  <span className="mr-1.5 font-mono text-ink-subtle">0{i + 1}</span>
                  {step.tab}
                </a>
              ))}
            </nav>
          </Container>
        </div>

        {journey.map((step, i) => (
          <div key={step.id} id={step.id} className="py-20 sm:py-28">
            <Container className="grid items-center gap-12 lg:grid-cols-2">
              <div className={i % 2 ? 'lg:order-2' : ''}>
                <p className="mb-4 font-mono text-sm text-cut">
                  0{i + 1} · {step.tab}
                </p>
                <h3 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
                  {step.title}
                </h3>
                <p className="mt-5 text-lg leading-relaxed text-ink-muted">{step.body}</p>
                <ul className="mt-7 flex flex-col gap-3">
                  {step.points.map((p) => (
                    <li key={p} className="flex gap-3">
                      <Check className="mt-0.5 h-5 w-5 shrink-0 text-good" />
                      <span>{p}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className={i % 2 ? 'lg:order-1' : ''}>{step.scene}</div>
            </Container>
          </div>
        ))}
      </section>

      {/* WhatsApp & AI */}
      <section id="whatsapp" className="bg-ink py-24 text-white sm:py-32">
        <Container className="grid items-start gap-14 lg:grid-cols-2">
          <div>
            <p className="mb-4 text-sm font-medium tracking-wide text-cut uppercase">
              Built for how the region works
            </p>
            <h2 className="text-3xl font-semibold tracking-tight sm:text-5xl">
              Run the shop from WhatsApp.
            </h2>
            <p className="mt-5 text-lg leading-relaxed text-white/70">
              Your team already lives in WhatsApp. Now Kerf does too. Ask it to draft a quote,
              approve one, check a job, log hours, raise a purchase order or dispatch a delivery —
              in plain language, from anywhere.
            </p>
            <dl className="mt-10 divide-y divide-white/10 rounded-2xl border border-white/10">
              {commands.map(([say, does]) => (
                <div key={say} className="grid gap-1 px-5 py-3.5 sm:grid-cols-2 sm:gap-4">
                  <dt className="text-white">{say}</dt>
                  <dd className="text-white/60">{does}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-6 text-white/70">
              <span className="font-semibold text-white">Safe by design.</span> Anything beyond a
              draft, and every message to a customer, waits for a human “yes”. Every action is
              written to the audit trail, with who asked for it.
            </p>
          </div>
          <div className="text-ink lg:pt-20">
            <ChatThread
              title="Kerf"
              subtitle="Omar’s chat with Kerf · WhatsApp"
              messages={floorThread}
              delay={1.1}
            />
            <div className="mt-6 rounded-2xl border border-white/10 p-6 text-white">
              <p className="font-semibold">Ask Kerf, inside the app too.</p>
              <p className="mt-2 text-white/70">
                The same assistant lives in Kerf. Ask about a customer, a job or your numbers, and
                it answers from your live data — then offers to do the next step.
              </p>
            </div>
          </div>
        </Container>
      </section>

      {/* Automations */}
      <section className="py-24 sm:py-32">
        <Container>
          <SectionHeading center title="Follow-ups that never forget.">
            Kerf’s automations run on a durable workflow engine, so a follow-up scheduled for next
            month still happens next month — through restarts, updates and holidays.
          </SectionHeading>
          <div className="mx-auto mt-14 grid max-w-4xl gap-4 sm:grid-cols-3">
            {[
              { icon: Clock, title: 'Chase unsigned quotes', body: 'Nudge the customer three days after a quote goes out unsigned.' },
              { icon: BellRing, title: 'Escalate overdue invoices', body: 'Remind, then remind again, then tell the owner.' },
              { icon: ShieldCheck, title: 'Route big quotes', body: 'Anything over your limit goes to the owner before it goes out.' },
            ].map((a) => (
              <div key={a.title} className="rounded-2xl border border-line p-6">
                <a.icon className="h-5 w-5 text-cut" />
                <p className="mt-4 font-semibold">{a.title}</p>
                <p className="mt-2 text-ink-muted">{a.body}</p>
              </div>
            ))}
          </div>
        </Container>
      </section>

      {/* Security */}
      <section className="border-y border-line bg-paper py-24 sm:py-32">
        <Container>
          <SectionHeading eyebrow="Your data, locked at the database" title="Built like a vault, not a spreadsheet." />
          <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {security.map((s) => (
              <div key={s.title} className="rounded-2xl border border-line bg-white p-6">
                <s.icon className="h-5 w-5 text-ink" />
                <p className="mt-4 font-semibold">{s.title}</p>
                <p className="mt-2 text-ink-muted">{s.body}</p>
              </div>
            ))}
            <a
              href="/security"
              className="flex flex-col justify-between rounded-2xl bg-ink p-6 text-white hover:bg-ink/90"
            >
              <p className="font-semibold">How Kerf keeps your data safe</p>
              <span className="mt-6 inline-flex items-center gap-1.5 text-sm text-white/80">
                Read the security overview <ArrowRight className="h-4 w-4" />
              </span>
            </a>
          </div>
        </Container>
      </section>

      {/* UAE */}
      <section className="py-24 sm:py-32">
        <Container className="grid items-center gap-12 lg:grid-cols-2">
          <SectionHeading eyebrow="Built for the UAE" title="Made here. Made for here.">
            Kerf is built in the UAE for the way businesses here actually work — on WhatsApp, in
            several currencies, with VAT on every invoice.
          </SectionHeading>
          <ul className="grid gap-3 sm:grid-cols-2">
            {[
              ['VAT-ready', 'Tax rules, tax codes and VAT reports out of the box.', false],
              ['AED and every other currency', 'Quote in USD, buy in EUR, report in AED.', false],
              ['WhatsApp-first', 'The way your customers and your floor already talk.', false],
              ['Arabic', 'An Arabic interface is on the way.', true],
            ].map(([title, body, soon]) => (
              <li key={title as string} className="rounded-2xl border border-line p-5">
                <p className="flex items-center gap-2 font-semibold">
                  {title}
                  {soon && (
                    <span className="rounded-full bg-cut-soft px-2 py-0.5 text-xs font-medium text-ink-muted">
                      Coming soon
                    </span>
                  )}
                </p>
                <p className="mt-1.5 text-ink-muted">{body}</p>
              </li>
            ))}
          </ul>
        </Container>
      </section>

      {/* Comparison */}
      <section className="border-t border-line py-24 sm:py-32">
        <Container>
          <SectionHeading center title="One system instead of five." />
          <div className="mx-auto mt-12 max-w-4xl overflow-x-auto rounded-2xl border border-line">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b border-line bg-paper text-left">
                  <th className="px-5 py-4 font-medium" />
                  <th className="px-4 py-4 text-center font-semibold">Kerf</th>
                  <th className="px-4 py-4 text-center font-medium text-ink-muted">
                    CRM + accounting app + spreadsheets
                  </th>
                  <th className="px-4 py-4 text-center font-medium text-ink-muted">A big ERP</th>
                </tr>
              </thead>
              <tbody>
                {comparison.map(([label, ...marks]) => (
                  <tr key={label} className="border-b border-line last:border-0">
                    <td className="px-5 py-3.5">{label}</td>
                    {marks.map((m, i) => (
                      <td key={i} className={`px-4 py-3.5 text-center ${i === 0 ? 'bg-cut-soft/40' : ''}`}>
                        <MarkIcon mark={m} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Container>
      </section>

      {/* Pricing teaser */}
      <section className="pb-24 sm:pb-32">
        <Container>
          <div className="flex flex-col items-start justify-between gap-6 rounded-3xl border border-line bg-paper p-8 sm:flex-row sm:items-center sm:p-12">
            <div className="max-w-xl">
              <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
                Priced per seat. Every module included.
              </h2>
              <p className="mt-3 text-ink-muted">
                CRM, costing, production, stock and finance — no add-ons to unlock the parts that
                make you money.
              </p>
            </div>
            <ButtonLink href="/pricing" variant="secondary">
              See pricing
            </ButtonLink>
          </div>
        </Container>
      </section>

      {/* FAQ */}
      <section className="border-t border-line py-24 sm:py-32">
        <Container className="grid gap-12 lg:grid-cols-[1fr_1.6fr]">
          <SectionHeading title="Questions, answered." />
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

      {/* Closing CTA */}
      <section className="px-4 pb-24 sm:px-6">
        <div className="relative mx-auto max-w-6xl overflow-hidden rounded-3xl bg-ink px-6 py-20 text-center text-white">
          <div className="pointer-events-none absolute inset-y-0 left-1/2 w-px -rotate-12 bg-cut/60" />
          <h2 className="relative text-4xl font-semibold tracking-tight sm:text-6xl">
            Stop guessing your margins.
          </h2>
          <p className="relative mx-auto mt-5 max-w-xl text-lg text-white/70">
            Start your free trial, or let us set Kerf up with your own products and rates.
          </p>
          <div className="relative mt-9 flex flex-wrap justify-center gap-3">
            <ButtonLink href={site.demoUrl} variant="inverted">
              Book a demo
            </ButtonLink>
            <a
              href={site.signUpUrl}
              className="inline-flex h-11 items-center rounded-xl border border-white/25 px-5 text-[15px] font-medium hover:bg-white/10"
            >
              Start free trial
            </a>
          </div>
        </div>
      </section>
    </>
  );
}

function MarkIcon({ mark }: { mark: Mark }) {
  if (mark === 'yes') return <Check aria-label="Yes" className="mx-auto h-5 w-5 text-good" />;
  if (mark === 'no') return <X aria-label="No" className="mx-auto h-5 w-5 text-ink-subtle" />;
  return <Minus aria-label="Partly" className="mx-auto h-5 w-5 text-cut" />;
}
