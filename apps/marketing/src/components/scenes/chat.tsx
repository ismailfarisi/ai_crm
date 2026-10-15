/**
 * A WhatsApp-style thread. Messages rise in one after another; `delay` is the
 * gap between them in seconds. The figures in every thread on the site are
 * illustrative but must stay arithmetically true.
 */
export type ChatMessage = {
  from: string;
  time: string;
  /** `me` renders right-aligned in WhatsApp green; `kerf` gets the Kerf badge. */
  side: 'them' | 'me' | 'kerf';
  body: React.ReactNode;
};

export function ChatThread({
  title,
  subtitle,
  messages,
  delay = 0.9,
}: {
  title: string;
  subtitle: string;
  messages: ChatMessage[];
  delay?: number;
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-white shadow-[0_1px_2px_rgba(0,0,0,0.04),0_24px_60px_-20px_rgba(0,0,0,0.18)]">
      <div className="flex items-center gap-3 border-b border-line bg-paper px-4 py-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-ink text-sm font-semibold text-white">
          {title.slice(0, 1)}
        </div>
        <div>
          <p className="text-sm font-semibold">{title}</p>
          <p className="text-xs text-ink-subtle">{subtitle}</p>
        </div>
      </div>
      <div className="flex flex-col gap-2.5 bg-[oklch(0.975_0.01_90)] p-4">
        {messages.map((m, i) => (
          <div
            key={i}
            className={`rise flex ${m.side === 'me' ? 'justify-end' : 'justify-start'}`}
            style={{ animationDelay: `${0.3 + i * delay}s` }}
          >
            <div
              className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed shadow-sm ${
                m.side === 'me'
                  ? 'rounded-br-md bg-whatsapp'
                  : m.side === 'kerf'
                    ? 'rounded-bl-md border border-cut/30 bg-white'
                    : 'rounded-bl-md bg-white'
              }`}
            >
              <p className="mb-0.5 flex items-center gap-1.5 text-xs font-semibold text-ink-muted">
                {m.side === 'kerf' && (
                  <span className="rounded bg-ink px-1 py-px text-[10px] font-semibold text-white">
                    KERF
                  </span>
                )}
                {m.from}
                <span className="font-normal text-ink-subtle">· {m.time}</span>
              </p>
              <div className="text-ink">{m.body}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
