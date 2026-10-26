/**
 * Everything that differs between environments. The marketing site never
 * talks to the API — it only links into the app and out to WhatsApp — so these
 * values are its entire configuration.
 */
const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000').replace(/\/$/, '');

/** Digits only, country code first (the wa.me format), e.g. 971523809179. */
const whatsappNumber = (process.env.NEXT_PUBLIC_CONTACT_WHATSAPP || '971523809179').replace(
  /\D/g,
  '',
);
const whatsappMessage = "Hi Ismail, I saw Kerf on switeaz.com and I'd like a free demo.";
const whatsappUrl = `https://wa.me/${whatsappNumber}?text=${encodeURIComponent(whatsappMessage)}`;

/** "+971 52 380 9179" for UAE mobiles, plain "+<digits>" for anything else. */
function formatPhone(digits: string) {
  const uae = /^971(\d{2})(\d{3})(\d{4})$/.exec(digits);
  return uae ? `+971 ${uae[1]} ${uae[2]} ${uae[3]}` : `+${digits}`;
}

export const site = {
  name: 'Kerf',
  tagline: 'The CRM that counts every cut.',
  description:
    'Kerf runs your made-to-order business in one place: customers, costed quotes, production, stock and the books. Built for packaging, print, signage and fabrication. Works from WhatsApp.',
  url: (process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3001').replace(/\/$/, ''),
  signInUrl: `${appUrl}/login`,
  signUpUrl: `${appUrl}/register`,
  /** "Book a demo", the announcement banner and every "Contact" link open WhatsApp. */
  demoUrl: whatsappUrl,
  contactUrl: whatsappUrl,
  whatsappUrl,
  whatsappDisplay: formatPhone(whatsappNumber),
  /** Optional, shown only when set. WhatsApp is the main contact point. */
  contactEmail: process.env.NEXT_PUBLIC_CONTACT_EMAIL || undefined,
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
