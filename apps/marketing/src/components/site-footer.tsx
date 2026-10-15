import Link from 'next/link';
import { productLinks, site } from '@/lib/site';
import { Logo } from './logo';

const industries = ['Packaging', 'Print', 'Signage', 'Fabrication', 'Joinery & fit-out'];

export function SiteFooter() {
  return (
    <footer className="border-t border-line bg-paper">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-14 sm:px-6 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
        <div>
          <Logo />
          <p className="mt-4 max-w-xs text-sm leading-relaxed text-ink-muted">
            {site.tagline} One system for made-to-order businesses, from the first message to the
            final payment.
          </p>
        </div>

        <FooterColumn title="Product">
          {productLinks.map((item) => (
            <a key={item.href} href={item.href} className="hover:text-ink">
              {item.label}
            </a>
          ))}
        </FooterColumn>

        <FooterColumn title="Built for">
          {industries.map((name) => (
            <span key={name}>{name}</span>
          ))}
        </FooterColumn>

        <FooterColumn title="Company">
          <Link href="/pricing" className="hover:text-ink">
            Pricing
          </Link>
          <Link href="/security" className="hover:text-ink">
            Security
          </Link>
          <a href={`mailto:${site.contactEmail}`} className="hover:text-ink">
            Contact
          </a>
          <a href={site.signInUrl} className="hover:text-ink">
            Sign in
          </a>
        </FooterColumn>
      </div>
      <div className="border-t border-line">
        <p className="mx-auto max-w-6xl px-4 py-6 text-sm text-ink-subtle sm:px-6">
          © {new Date().getFullYear()} Kerf. Made in the UAE.
        </p>
      </div>
    </footer>
  );
}

function FooterColumn({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-sm font-medium">{title}</p>
      <div className="mt-4 flex flex-col gap-2.5 text-sm text-ink-muted">{children}</div>
    </div>
  );
}
