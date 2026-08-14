'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
}

const SIZES = {
  sm: 'max-w-sm',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
} as const;

/**
 * Built on the native <dialog> element, so focus trapping, Esc handling and
 * inertness of the background come from the platform rather than a JS library.
 */
export function Dialog({ open, onClose, title, description, children, footer, size = 'md' }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    if (open && !element.open) {
      element.showModal();
    } else if (!open && element.open) {
      element.close();
    }
  }, [open]);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    // Fires for Esc as well as programmatic close — keeps React state in sync.
    const handleClose = () => onClose();
    element.addEventListener('close', handleClose);
    return () => element.removeEventListener('close', handleClose);
  }, [onClose]);

  return (
    <dialog
      ref={ref}
      aria-labelledby="dialog-title"
      onClick={(event) => {
        // Clicking the ::backdrop reports the <dialog> itself as the target.
        if (event.target === ref.current) onClose();
      }}
      className={cn(
        'w-[calc(100vw-2rem)] rounded-2xl border border-border/80 bg-surface p-0 text-ink shadow-xl',
        'backdrop:bg-black/40 backdrop:backdrop-blur-xs',
        SIZES[size],
      )}
    >
      <div className="flex items-start justify-between gap-4 border-b border-border/80 px-5 py-4">
        <div>
          <h2 id="dialog-title" className="text-sm font-semibold text-ink">
            {title}
          </h2>
          {description && <p className="mt-1 text-sm text-ink-muted">{description}</p>}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close dialog"
          className="-mr-1 -mt-1 rounded-lg p-1.5 text-ink-subtle transition-colors hover:bg-surface-muted hover:text-ink cursor-pointer"
        >
          <X className="size-4" />
        </button>
      </div>

      <div className="max-h-[65vh] overflow-y-auto px-5 py-4 scrollbar-thin">{children}</div>

      {footer && (
        <div className="flex justify-end gap-2 border-t border-border/80 bg-surface-muted/50 px-5 py-3">
          {footer}
        </div>
      )}
    </dialog>
  );
}
