/**
 * Everything that differs between environments. The marketing site never
 * talks to the API — it only links into the app — so these three URLs are its
 * entire configuration.
 */
const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000').replace(/\/$/, '');

export const site = {
  name: 'Kerf',
  tagline: 'The CRM that counts every cut.',
  description:
    'Kerf runs your made-to-order business in one place: customers, costed quotes, production, stock and the books. Built for packaging, print, signage and fabrication. Works from WhatsApp.',
  url: (process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3001').replace(/\/$/, ''),
  signInUrl: `${appUrl}/login`,
  signUpUrl: `${appUrl}/register`,
  demoUrl: `mailto:${process.env.NEXT_PUBLIC_CONTACT_EMAIL ?? 'hello@kerf.ae'}?subject=${encodeURIComponent('Kerf demo')}`,
  contactEmail: process.env.NEXT_PUBLIC_CONTACT_EMAIL ?? 'hello@kerf.ae',
} as const;

/** The homepage's journey sections double as the Product menu until product pages exist. */
export const productLinks = [
  { href: '/#win', label: 'CRM & pipeline', hint: 'Every customer, every enquiry, one place' },
  { href: '/#quote', label: 'Costing & quotes', hint: 'Price from what it really costs' },
  { href: '/#make', label: 'Production', hint: 'Work orders the floor actually uses' },
  { href: '/#buy', label: 'Stock & purchasing', hint: 'Buy what the job needs' },
  { href: '/#paid', label: 'Finance', hint: 'Invoices, payments and real books' },
  { href: '/#whatsapp', label: 'WhatsApp & AI', hint: 'Run the shop from your phone' },
] as const;
