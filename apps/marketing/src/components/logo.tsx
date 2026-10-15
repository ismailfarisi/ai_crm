/** Wordmark: "kerf" with a saw cut through it — the kerf itself. */
export function Logo({ className = '' }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <svg viewBox="0 0 28 28" aria-hidden className="h-7 w-7">
        <rect x="1" y="1" width="26" height="26" rx="7" className="fill-ink" />
        <path d="M9 20 L19 8" className="stroke-cut" strokeWidth="2.6" strokeLinecap="round" />
        <path d="M8 8 V20" className="stroke-white" strokeWidth="2.6" strokeLinecap="round" />
      </svg>
      <span className="text-xl font-semibold tracking-tight">kerf</span>
    </span>
  );
}
