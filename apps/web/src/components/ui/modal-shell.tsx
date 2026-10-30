'use client';

import { useEffect, useLayoutEffect, useRef, type ReactNode, type RefObject } from 'react';
import { cn } from '@/lib/utils';

interface ModalShellProps {
  open: boolean;
  onClose: () => void;
  /** Read out when the shell opens. Give `label` or `labelledBy`. */
  label?: string;
  labelledBy?: string;
  /** Where the sheet sits: a palette near the top, or a drawer on the end edge. */
  placement?: 'top' | 'end';
  /** Focused when the shell opens, instead of the first focusable element. */
  initialFocusRef?: RefObject<HTMLElement | null>;
  className?: string;
  children: ReactNode;
}

const PLACEMENTS = {
  top: 'mx-auto mt-[10vh] mb-auto w-[calc(100vw-2rem)] rounded-2xl border border-border/60',
  end: 'ms-auto me-0 my-0 h-dvh max-h-none w-full max-w-2xl border-s border-border',
} as const;

/**
 * The bare native `<dialog>` under `Dialog`, for overlays that draw their own
 * header: the catalog picker, the template configurator, the enquiry drawer.
 *
 * Those three used to be hand-built `div`s, so focus stayed on the page
 * behind them, Tab walked out of them, and a screen reader never heard that
 * anything had opened. `showModal()` gives the trap, the inert background and
 * Escape from the platform.
 */
export function ModalShell({ open, ...props }: ModalShellProps) {
  // The dialog exists only while open: mounting it is what opens it.
  return open ? <OpenModal {...props} /> : null;
}

function OpenModal({
  onClose,
  label,
  labelledBy,
  placement = 'top',
  initialFocusRef,
  className,
  children,
}: Omit<ModalShellProps, 'open'>) {
  const ref = useRef<HTMLDialogElement>(null);
  const openerRef = useRef<Element | null>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  // Before paint, so the sheet never flashes in as a non-modal block.
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (!element.open) {
      openerRef.current = document.activeElement;
      element.showModal();
      initialFocusRef?.current?.focus();
    }
    // Closing unmounts the shell, which skips the platform's own focus
    // return, so hand focus back to whatever opened it. Checked once the
    // commit is done: React's development re-run of this effect leaves the
    // dialog in place, and whatever the closing action focused (a new line's
    // quantity, say) keeps it.
    return () => {
      queueMicrotask(() => {
        const opener = openerRef.current;
        if (element.isConnected || !(opener instanceof HTMLElement) || !opener.isConnected) return;
        if (document.activeElement && document.activeElement !== document.body) return;
        opener.focus();
      });
    };
    // Opened once, on mount; closing unmounts it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    // Escape closes a modal dialog natively; keep React's state in step.
    const handleClose = () => onCloseRef.current();
    element.addEventListener('close', handleClose);
    return () => element.removeEventListener('close', handleClose);
  }, []);

  return (
    <dialog
      ref={ref}
      aria-label={labelledBy ? undefined : label}
      aria-labelledby={labelledBy}
      onClick={(event) => {
        // Clicking the ::backdrop reports the <dialog> itself as the target.
        if (event.target === ref.current) onCloseRef.current();
      }}
      className={cn(
        'overflow-hidden bg-surface p-0 text-ink shadow-[0_10px_40px_rgba(0,0,0,0.06)]',
        'backdrop:bg-black/30 backdrop:backdrop-blur-xs',
        PLACEMENTS[placement],
        className,
      )}
    >
      {children}
    </dialog>
  );
}
