'use client';

import { useEffect, useId, useLayoutEffect, useRef, useState, type ComponentType, type KeyboardEvent } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface RowMenuAction {
  key: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  onSelect: () => void;
  disabled?: boolean;
  /** Why it is disabled, read out with the item and shown on hover. */
  hint?: string;
  tone?: 'danger';
}

interface RowActionMenuProps {
  actions: RowMenuAction[];
  /** Names the record, so a screen reader hears "More actions for INV-2026-0012". */
  label: string;
}

const MENU_WIDTH = 224;

/**
 * A table row's secondary actions behind one button.
 *
 * The list is positioned against the viewport rather than the cell, because a
 * table scrolls inside its own card and would clip a menu hung off the row.
 * Arrow keys move through the items, Escape closes and returns focus, and any
 * scroll or resize closes it rather than leaving it floating off its row.
 */
export function RowActionMenu({ actions, label }: RowActionMenuProps) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number; up: boolean } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const menuId = useId();

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const estimatedHeight = actions.length * 44 + 12;
    const up = rect.bottom + estimatedHeight + 8 > window.innerHeight && rect.top > estimatedHeight + 8;
    setPosition({
      top: up ? rect.top - 6 : rect.bottom + 6,
      left: Math.max(8, Math.min(rect.right - MENU_WIDTH, window.innerWidth - MENU_WIDTH - 8)),
      up,
    });
  }, [open, actions.length]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const dismiss = () => setOpen(false);
    document.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('scroll', dismiss, true);
    window.addEventListener('resize', dismiss);
    itemRefs.current.find((item) => item && !item.disabled)?.focus();
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('scroll', dismiss, true);
      window.removeEventListener('resize', dismiss);
    };
  }, [open]);

  if (actions.length === 0) return null;

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
    <div ref={rootRef} className="relative inline-flex">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={`More actions for ${label}`}
        title="More actions"
        className="grid size-8 place-items-center rounded-full text-ink-muted transition-colors hover:bg-surface-muted hover:text-ink cursor-pointer"
      >
        <MoreHorizontal className="size-4" aria-hidden />
      </button>

      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label={`More actions for ${label}`}
          onKeyDown={onMenuKeyDown}
          style={
            position
              ? {
                  position: 'fixed',
                  left: position.left,
                  top: position.top,
                  width: MENU_WIDTH,
                  transform: position.up ? 'translateY(-100%)' : undefined,
                }
              : { position: 'fixed', visibility: 'hidden', width: MENU_WIDTH }
          }
          className="z-50 rounded-2xl border border-border bg-surface p-1.5 text-start shadow-[0_10px_40px_rgba(0,0,0,0.08)]"
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
                title={action.hint}
                onClick={() => {
                  // Focus goes back to the trigger first, so a dialog the
                  // action opens has somewhere to return it when it closes.
                  close();
                  action.onSelect();
                }}
                className={cn(
                  'flex min-h-11 w-full items-center gap-2.5 rounded-xl px-3 text-start text-sm font-medium whitespace-normal transition-colors cursor-pointer',
                  'hover:bg-surface-muted focus-visible:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-50',
                  action.tone === 'danger' ? 'text-danger' : 'text-ink',
                )}
              >
                <Icon className="size-4 shrink-0 text-current opacity-80" />
                {action.label}
                {action.hint && <span className="sr-only">. {action.hint}</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
