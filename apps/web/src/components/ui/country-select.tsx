'use client';

import { forwardRef, useMemo } from 'react';
import { countryName, countryOptions } from '@saas/shared';
import { Select, type SelectProps } from './field';

type CountrySelectProps = Omit<SelectProps, 'options' | 'placeholder'> & {
  placeholder?: string;
};

/**
 * A country field bound to ISO 3166-1 alpha-2 codes.
 *
 * The customer and supplier forms took this as free text, while `taxRuleFor`
 * matches an exact country code — so "United States" (or "USA", or "us")
 * matched no rule and the sale was taxed wrongly or not at all.
 *
 * A value already stored as free text is kept as an extra option rather than
 * silently cleared, so opening an old record and saving it does not quietly
 * blank its country. The schema converts a recognised name to its code on the
 * way through, so that save is also the thing that fixes it.
 */
export const CountrySelect = forwardRef<HTMLSelectElement, CountrySelectProps>(
  function CountrySelect({ value, placeholder = 'Select a country', ...props }, ref) {
    const options = useMemo(() => {
      const list = countryOptions().map((country) => ({
        value: country.code,
        label: `${country.name} (${country.code})`,
      }));

      const current = typeof value === 'string' ? value.trim() : '';
      if (current && !list.some((option) => option.value === current)) {
        // Something typed before this was a picker. Shown as-is so the record
        // reads truthfully; picking anything else replaces it.
        list.unshift({ value: current, label: `${countryName(current)} — not a country code` });
      }

      return list;
    }, [value]);

    return <Select ref={ref} value={value} options={options} placeholder={placeholder} {...props} />;
  },
);
