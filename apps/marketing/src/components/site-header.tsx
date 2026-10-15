'use client';

import { ChevronDown, Menu, X } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { productLinks, site } from '@/lib/site';
import { Logo } from './logo';
import { ButtonLink } from './ui';

export function SiteHeader() {
  const [open, setOpen] = useState(false);
  const [bannerVisible, setBannerVisible] = useState(true);
  const ref = useRef<HTMLElement>(null);

  // Sticky elements below the header (the journey tabs) sit at --header-h,
  // which changes when the banner wraps, is dismissed or the menu opens.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      document.documentElement.style.setProperty('--header-h', `${el.offsetHeight}px`);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <header ref={ref} className="sticky top-0 z-50">
      {bannerVisible && (
        <div className="relative bg-ink px-10 py-2.5 text-center text-sm text-white">
          <a href={site.demoUrl} className="font-medium hover:underline">
            <span className="sm:hidden">Early access for UAE manufacturers →</span>
            <span className="hidden sm:inline">
              Kerf is in early access for UAE manufacturers. Get a guided setup →
            </span>
          </a>
          <button
            type="button"
            aria-label="Dismiss announcement"
            onClick={() => setBannerVisible(false)}
            className="absolute top-1/2 right-3 -translate-y-1/2 rounded p-1 text-white/70 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      <div className="border-b border-line bg-white/85 backdrop-blur-md">
        <nav className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-8">
            <Link href="/" aria-label="Kerf home">
              <Logo />
            </Link>
            <ul className="hidden items-center gap-1 md:flex">
              <li className="group relative">
                <button
                  type="button"
                  className="flex items-center gap-1 rounded-lg px-3 py-2 text-[15px] text-ink-muted hover:text-ink"
                >
                  Product <ChevronDown className="h-4 w-4" />
                </button>
                <div className="invisible absolute top-full left-0 w-80 pt-2 opacity-0 transition group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100">
                  <div className="rounded-2xl border border-line bg-white p-2 shadow-xl">
                    {productLinks.map((item) => (
                      <a
                        key={item.href}
                        href={item.href}
                        className="block rounded-xl px-3 py-2.5 hover:bg-paper"
                      >
                        <span className="block text-sm font-medium">{item.label}</span>
                        <span className="block text-sm text-ink-muted">{item.hint}</span>
                      </a>
                    ))}
                  </div>
                </div>
              </li>
              <li>
                <Link href="/pricing" className="rounded-lg px-3 py-2 text-[15px] text-ink-muted hover:text-ink">
                  Pricing
                </Link>
              </li>
              <li>
                <Link href="/security" className="rounded-lg px-3 py-2 text-[15px] text-ink-muted hover:text-ink">
                  Security
                </Link>
              </li>
            </ul>
          </div>

          <div className="hidden items-center gap-2 md:flex">
            <ButtonLink href={site.signInUrl} variant="secondary" size="sm">
              Sign in
            </ButtonLink>
            <ButtonLink href={site.signUpUrl} size="sm">
              Start free trial
            </ButtonLink>
          </div>

          <button
            type="button"
            className="rounded-lg p-2 md:hidden"
            aria-label={open ? 'Close menu' : 'Open menu'}
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </nav>

        {open && (
          <div className="border-t border-line px-4 pt-2 pb-6 md:hidden">
            <p className="px-2 pt-3 pb-1 text-xs font-medium tracking-wide text-ink-subtle uppercase">
              Product
            </p>
            {productLinks.map((item) => (
              <a
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                className="block rounded-lg px-2 py-2 text-[15px]"
              >
                {item.label}
              </a>
            ))}
            <Link href="/pricing" onClick={() => setOpen(false)} className="block rounded-lg px-2 py-2 text-[15px]">
              Pricing
            </Link>
            <Link href="/security" onClick={() => setOpen(false)} className="block rounded-lg px-2 py-2 text-[15px]">
              Security
            </Link>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <ButtonLink href={site.signInUrl} variant="secondary">
                Sign in
              </ButtonLink>
              <ButtonLink href={site.signUpUrl}>Start free trial</ButtonLink>
            </div>
          </div>
        )}
      </div>
    </header>
  );
}
