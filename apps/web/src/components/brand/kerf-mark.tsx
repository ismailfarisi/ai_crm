/** The Kerf mark: a stroke with a saw cut through it. Shared with apps/marketing's logo. */
export function KerfMark({ className = 'size-8' }: { className?: string }) {
  return (
    <svg viewBox="0 0 28 28" aria-hidden className={`shrink-0 ${className}`}>
      {/* The hairline only shows in dark mode, where the near-black tile would sink into the page. */}
      <rect
        x="1"
        y="1"
        width="26"
        height="26"
        rx="7"
        fill="#1c1917"
        strokeWidth="1"
        className="stroke-transparent dark:stroke-border-strong"
      />
      <path d="M9 20 L19 8" stroke="#e8a23a" strokeWidth="2.6" strokeLinecap="round" />
      <path d="M8 8 V20" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" />
    </svg>
  );
}
