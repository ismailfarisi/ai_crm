import type { Metadata } from 'next';
import { ButtonLink, Container } from '@/components/ui';
import { site } from '@/lib/site';

export const metadata: Metadata = {
  title: 'Security',
  description:
    'How Kerf protects your data: database-level tenant isolation, per-request permissions, a complete audit trail and AI that asks before it acts.',
};

const sections = [
  {
    title: 'Every company is walled off by the database',
    body: [
      'Kerf is multi-tenant: many companies share the same system. Most software keeps them apart with application code alone, so one missed filter can show one customer’s data to another.',
      'Kerf adds a second wall underneath. The database itself enforces row-level security, and the application connects as a restricted user that cannot bypass it. Kerf refuses to start if that restriction is missing.',
    ],
  },
  {
    title: 'Permissions are checked on every request',
    body: [
      'Your login proves who you are — nothing more. What you are allowed to do is worked out fresh from your roles on every request, so removing someone’s access takes effect within seconds, not when their session happens to expire.',
      'Roles can be as broad as “admin” or as narrow as “only my own customers”. Nobody can grant a permission they don’t hold themselves.',
    ],
  },
  {
    title: 'Every change is on the record',
    body: [
      'Every change to your data is written to an audit trail automatically: who made it, when, and what the record looked like before and after. People with access to the audit log can review it from settings.',
    ],
  },
  {
    title: 'Files follow the record',
    body: [
      'Attachments have no separate permissions to get wrong. If you can see a quote, you can see its files; if you can’t, you can’t. Downloads use short-lived signed links that expire on their own.',
    ],
  },
  {
    title: 'AI that asks before it acts',
    body: [
      'The Kerf assistant can read and prepare drafts, but anything beyond a draft needs a person to approve it, and anything sent to a customer always does. An approval covers exactly what you were shown — if the action changes after you approve it, Kerf refuses and asks again.',
      'Every change the assistant makes is written to the audit trail, along with what was asked.',
    ],
  },
  {
    title: 'Sign-in protection',
    body: [
      'Passwords are stored as one-way hashes, sign-in attempts are rate-limited, and sessions use short-lived access tokens.',
    ],
  },
];

export default function SecurityPage() {
  return (
    <>
      <section className="border-b border-line bg-paper">
        <Container className="py-20 sm:py-28">
          <p className="mb-4 text-sm font-medium tracking-wide text-cut uppercase">Security</p>
          <h1 className="max-w-3xl text-4xl font-semibold tracking-tight text-balance sm:text-6xl">
            Built like a vault, not a spreadsheet.
          </h1>
          <p className="mt-6 max-w-2xl text-lg text-ink-muted">
            Your costs, your customers and your books are the most sensitive data you own. Here is
            exactly how Kerf protects them.
          </p>
        </Container>
      </section>

      <section className="py-20">
        <Container className="max-w-3xl">
          <div className="flex flex-col gap-14">
            {sections.map((s) => (
              <article key={s.title}>
                <h2 className="text-2xl font-semibold tracking-tight">{s.title}</h2>
                {s.body.map((p) => (
                  <p key={p} className="mt-4 text-lg leading-relaxed text-ink-muted">
                    {p}
                  </p>
                ))}
              </article>
            ))}
          </div>

          <div className="mt-20 rounded-3xl border border-line bg-paper p-8">
            <p className="text-xl font-semibold">Have a security question?</p>
            <p className="mt-2 text-ink-muted">
              We’re happy to walk your IT team through how Kerf works.
            </p>
            <div className="mt-6">
              <ButtonLink href={`mailto:${site.contactEmail}?subject=Security`}>
                Contact us
              </ButtonLink>
            </div>
          </div>
        </Container>
      </section>
    </>
  );
}
