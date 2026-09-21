import { z } from 'zod';

/**
 * The model an agent runs on, when it does not want the organisation's default.
 *
 * Null means "use whatever the provider is configured with". That is the
 * common case and the safe one: an organisation that switches provider, or
 * moves from one model generation to the next, changes it in one place and
 * every agent that has not opted out follows.
 *
 * Nullable rather than defaulted to a literal, because a default here would be
 * a second opinion about which model is current, kept in a schema that nobody
 * revisits. The provider already holds that opinion.
 *
 * A blank string normalises to null so clearing the field in a form means
 * "back to the default" rather than "run on a model called empty string".
 */
export const agentModelField = z
  .string()
  .trim()
  .max(120)
  .nullish()
  .transform((value) => (value == null || value === '' ? null : value));
