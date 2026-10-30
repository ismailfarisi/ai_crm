'use client';

import { useEffect, useId, useRef, useState, type ComponentType, type KeyboardEvent } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface QuoteMenuAction {
  key: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  onSelect: () => void;
  disabled?: boolean;
  tone?: 'danger';
}

interface QuoteActionMenuProps {
  actions: QuoteMenuAction[];
  /** Which way the list opens: down from a top bar, up from a bottom bar. */
  placement?: 'down' | 'up';
  className?: string;
}

/**
 * The quote's secondary actions behind one button, so the bar keeps a single
 * primary action and the rest stay one tap away. Arrow keys move through the
 * list, Escape closes it and puts focus back on the button.
 */
export function QuoteActionMenu({ actions, placement = 'down', className }: QuoteActionMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    itemRefs.current.find((item) => item && !item.disabled)?.focus();
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  if (actions.length === 0) return null;

  // A menu holding one item is a button behind an extra tap.
  if (actions.length === 1) {
    const [only] = actions;
    const Icon = only.icon;
    return (
      <button
        type="button"
        onClick={only.onSelect}
        disabled={only.disabled}
        aria-label={only.label}
        title={only.label}
        className={cn(
          'grid size-10 place-items-center rounded-full border border-border bg-surface text-ink-muted max-md:size-11 transition-colors hover:bg-surface-muted hover:text-ink cursor-pointer disabled:opacity-50',
          className,
        )}
      >
        <Icon className="size-5" />
      </button>
    );
  }

  const close = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const enabled = itemRefs.current.filter((item): item is HTMLButtonElement => Boolean(item && !item.disabled));
    const at = enabled.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close();
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      enabled[(at + 1) % enabled.length]?.focus();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      enabled[(at - 1 + enabled.length) % enabled.length]?.focus();
    } else if (event.key === 'Tab') {
      setOpen(false);
    }
  };

  return (
    <div ref={rootRef} className={cn('relative', className)}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label="More actions"
        className="grid size-10 place-items-center rounded-full border border-border bg-surface text-ink-muted max-md:size-11 transition-colors hover:bg-surface-muted hover:text-ink cursor-pointer"
      >
        <MoreHorizontal className="size-5" aria-hidden />
      </button>

      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label="More actions"
          onKeyDown={onMenuKeyDown}
          className={cn(
            'absolute end-0 z-40 min-w-56 rounded-2xl border border-border bg-surface p-1.5 shadow-[0_10px_40px_rgba(0,0,0,0.08)]',
            placement === 'down' ? 'top-full mt-2' : 'bottom-full mb-2',
          )}
        >
          {actions.map((action, index) => {
            const Icon = action.icon;
            return (
              <button
                key={action.key}
                ref={(element) => {
                  itemRefs.current[index] = element;
                }}
                type="button"
                role="menuitem"
                disabled={action.disabled}
                onClick={() => {
                  // Back on the button first, so a dialog the action opens
                  // has somewhere to return focus when it closes.
                  close();
                  action.onSelect();
                }}
                className={cn(
                  'flex min-h-11 w-full items-center gap-2.5 rounded-xl px-3 text-start text-sm font-medium transition-colors cursor-pointer',
                  'hover:bg-surface-muted focus-visible:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-50',
                  action.tone === 'danger' ? 'text-danger' : 'text-ink',
                )}
              >
                <Icon className="size-4 shrink-0 text-current opacity-80" />
                {action.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
