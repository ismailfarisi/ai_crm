'use client';

import { useSyncExternalStore } from 'react';

/**
 * Whether a CSS media query matches, kept in step as the window changes.
 *
 * For layouts that must render different markup rather than restyle the same
 * markup — one set of actions in a top bar on a desk, the same actions in a
 * bottom bar under a thumb. False on the server and wherever `matchMedia` is
 * missing, so the desktop markup is the default.
 */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      if (typeof window === 'undefined' || !window.matchMedia) return () => {};
      const list = window.matchMedia(query);
      list.addEventListener('change', onChange);
      return () => list.removeEventListener('change', onChange);
    },
    () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(query).matches : false),
    () => false,
  );
}
