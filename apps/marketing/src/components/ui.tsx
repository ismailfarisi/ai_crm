import Link from 'next/link';

type Variant = 'primary' | 'secondary' | 'inverted';

const variants: Record<Variant, string> = {
  primary: 'bg-ink text-white hover:bg-ink/85',
  secondary: 'border border-line-strong bg-white text-ink hover:bg-paper',
  inverted: 'bg-white text-ink hover:bg-white/90',
};

/** Links that look like buttons. External and mailto links skip the Next router. */
export function ButtonLink({
  href,
  variant = 'primary',
  size = 'md',
  children,
}: {
  href: string;
  variant?: Variant;
  size?: 'sm' | 'md';
  children: React.ReactNode;
}) {
  const className = `inline-flex items-center justify-center rounded-xl font-medium transition-colors ${
    size === 'sm' ? 'h-9 px-3.5 text-sm' : 'h-11 px-5 text-[15px]'
  } ${variants[variant]}`;
  if (/^(https?:|mailto:)/.test(href)) {
    return (
      <a href={href} className={className}>
        {children}
      </a>
    );
  }
  return (
    <Link href={href} className={className}>
      {children}
    </Link>
  );
}

export function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-4 text-sm font-medium tracking-wide text-cut uppercase">{children}</p>
  );
}

export function SectionHeading({
  eyebrow,
  title,
  children,
  center = false,
}: {
  eyebrow?: string;
  title: React.ReactNode;
  children?: React.ReactNode;
  center?: boolean;
}) {
  return (
    <div className={center ? 'mx-auto max-w-3xl text-center' : 'max-w-2xl'}>
      {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
      <h2 className="text-3xl font-semibold tracking-tight text-balance sm:text-5xl">{title}</h2>
      {children && (
        <p className="mt-5 text-lg leading-relaxed text-pretty text-ink-muted">{children}</p>
      )}
    </div>
  );
}

export function Container({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <div className={`mx-auto w-full max-w-6xl px-4 sm:px-6 ${className}`}>{children}</div>;
}

/** The frame every product scene sits in, so they read as one set. */
export function SceneFrame({
  title,
  children,
  className = '',
}: {
  title?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`overflow-hidden rounded-2xl border border-line bg-white shadow-[0_1px_2px_rgba(0,0,0,0.04),0_12px_40px_-12px_rgba(0,0,0,0.12)] ${className}`}
    >
      {title && (
        <div className="flex items-center gap-2 border-b border-line bg-paper px-4 py-2.5">
          <span className="h-2.5 w-2.5 rounded-full bg-line-strong" />
          <span className="h-2.5 w-2.5 rounded-full bg-line-strong" />
          <span className="h-2.5 w-2.5 rounded-full bg-line-strong" />
          <span className="ml-2 text-xs font-medium text-ink-subtle">{title}</span>
        </div>
      )}
      {children}
    </div>
  );
}
