import { z } from 'zod';
import { ISO_COUNTRY_CODES, countryName } from '../platform/countries';

/**
 * A country on a record that has held free text.
 *
 * `taxRuleFor` matches an exact country code, then `EU`, then `*`. The
 * customer and supplier forms took Country as free text, so "United States" —
 * or "USA", or "us" — matched no rule and the sale was quietly taxed wrongly
 * or not at all. Both forms are pickers now.
 *
 * This normalises rather than refuses, because records typed before the picker
 * existed have to stay editable: a customer loaded from the API must be
 * re-submittable without the schema rejecting its own stored value. A
 * recognised name is converted to its code, a code is upper-cased, and only
 * something that is neither is an error.
 *
 * The organization profile keeps its stricter field: nothing ever typed free
 * text into it, so there is nothing to convert and a typo is worth refusing.
 */
const byName = new Map(
  ISO_COUNTRY_CODES.map((code) => [countryName(code).toLowerCase(), code]),
);

/** Names people type that are not the platform's own. */
const COMMON_ALIASES: Record<string, string> = {
  usa: 'US',
  'u.s.': 'US',
  'u.s.a.': 'US',
  america: 'US',
  uk: 'GB',
  'u.k.': 'GB',
  britain: 'GB',
  'great britain': 'GB',
  england: 'GB',
  scotland: 'GB',
  wales: 'GB',
  holland: 'NL',
  uae: 'AE',
  'south korea': 'KR',
  'north korea': 'KP',
  russia: 'RU',
  vietnam: 'VN',
  czechia: 'CZ',
  'czech republic': 'CZ',
};

export const countryCodeField = z
  .string()
  .trim()
  .nullish()
  .transform((value) => {
    if (value == null || value === '') return null;

    const upper = value.toUpperCase();
    if (/^[A-Z]{2}$/.test(upper) && ISO_COUNTRY_CODES.includes(upper)) {
      return upper;
    }

    const lower = value.toLowerCase();
    return COMMON_ALIASES[lower] ?? byName.get(lower) ?? value;
  })
  .refine((value) => value == null || ISO_COUNTRY_CODES.includes(value), {
    message: 'Pick a country from the list',
  });
