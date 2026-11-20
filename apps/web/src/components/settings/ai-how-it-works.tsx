import { ArrowRight, MessageSquare, Users } from 'lucide-react';

const CUSTOMER_STEPS = [
  {
    title: 'A customer writes',
    body: 'On WhatsApp, Telegram, Slack or email.',
  },
  {
    title: 'An agent answers',
    body: 'If you set up agents, the one whose job fits replies in its own words. It can pass the conversation to another agent or to a person.',
  },
  {
    title: 'Otherwise the AI reads it',
    body: 'With no agent for the message, it works out what they want and how sure it is.',
  },
  {
    title: 'A rule replies',
    body: 'If you set up an automatic reply for that request, it is sent or a draft quote is created.',
  },
  {
    title: 'Or the AI asks',
    body: 'If it is not sure, it asks the customer a question and waits.',
  },
  {
    title: 'A person takes over',
    body: 'Complaints, requests for a person and anything unresolved go to the Inbox.',
  },
];

/**
 * How a message travels through the settings on this page, so each section
 * below can be read as one step of it.
 */
export function AiHowItWorks() {
  return (
    <section
      aria-labelledby="ai-how-it-works"
      className="space-y-5 rounded-2xl border border-border/40 bg-surface/85 p-5 shadow-xs"
    >
      <div>
        <h2 id="ai-how-it-works" className="text-lg font-semibold tracking-tight text-ink">
          How the AI handles messages
        </h2>
        <p className="mt-1 text-sm text-ink-muted">
          The sections below are these steps, in order. Nothing the AI does changes your books or
          sends a quote without a person confirming it.
        </p>
      </div>

      <div className="space-y-2">
        <p className="flex items-center gap-2 text-sm font-semibold text-ink">
          <MessageSquare className="size-4 text-ink-subtle" aria-hidden />
          Messages from customers
        </p>
        <ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-6">
          {CUSTOMER_STEPS.map((step, i) => (
            <li
              key={step.title}
              className="relative rounded-xl border border-border/40 bg-surface p-3"
            >
              <p className="text-xs font-semibold text-ink-subtle">Step {i + 1}</p>
              <p className="mt-0.5 text-sm font-semibold text-ink">{step.title}</p>
              <p className="mt-1 text-xs text-ink-muted">{step.body}</p>
              {i < CUSTOMER_STEPS.length - 1 && (
                <ArrowRight
                  aria-hidden
                  className="absolute -right-2.5 top-1/2 hidden size-4 -translate-y-1/2 text-ink-subtle lg:block"
                />
              )}
            </li>
          ))}
        </ol>
      </div>

      <div className="space-y-1">
        <p className="flex items-center gap-2 text-sm font-semibold text-ink">
          <Users className="size-4 text-ink-subtle" aria-hidden />
          Messages from your staff
        </p>
        <p className="text-sm text-ink-muted">
          Staff who link their own chat under Settings › Channels can give commands (approve a
          quote, raise a purchase order) and send files: a receipt becomes an expense claim and a
          supplier&apos;s invoice becomes a draft bill. They are shown what will happen and it
          only happens after they reply YES. A staff agent gives those commands its own
          instructions, model and tools.
        </p>
      </div>
    </section>
  );
}
