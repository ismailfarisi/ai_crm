/**
 * Skill names are dotted (`quote.create`, `work_order.log_time`) and key
 * audit rows, events and conversation state, so they cannot change. Both
 * providers only accept `[a-zA-Z0-9_-]` in a tool name, so the dot becomes a
 * double underscore on the way out and is restored on every tool call that
 * comes back. No skill or custom-object tool name contains `__`, which keeps
 * the mapping reversible.
 */
export function toProviderToolName(name: string): string {
  return name.replace(/\./g, '__');
}

export function fromProviderToolName(name: string): string {
  return name.replace(/__/g, '.');
}
