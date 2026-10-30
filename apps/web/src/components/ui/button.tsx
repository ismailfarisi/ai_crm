import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export type Variant = 'primary' | 'secondary' | 'dark' | 'ghost' | 'danger' | 'outline';
export type Size = 'sm' | 'md' | 'lg' | 'icon';

const VARIANTS: Record<Variant, string> = {
  primary:
    'bg-brand text-on-brand font-semibold hover:bg-brand-hover shadow-xs active:scale-[0.99] transition-all',
  secondary:
    'bg-charcoal text-on-charcoal font-medium hover:bg-charcoal-hover shadow-xs active:scale-[0.99] transition-all',
  dark:
    'bg-charcoal text-on-charcoal font-medium hover:bg-charcoal-hover shadow-xs active:scale-[0.99] transition-all',
  outline:
    'border border-border/50 bg-surface/50 hover:bg-surface text-ink active:scale-[0.99] transition-all',
  ghost:
    'hover:bg-surface-muted/60 text-ink-muted hover:text-ink transition-all',
  danger:
    'bg-danger text-ink-inverted hover:bg-danger-hover shadow-xs font-semibold active:scale-[0.99] transition-all',
};

const SIZES: Record<Size, string> = {
  sm: 'h-8 px-3 text-xs gap-1.5',
  md: 'h-10 px-4.5 text-sm gap-2',
  lg: 'h-11 px-6 text-sm gap-2',
  icon: 'h-9 w-9 p-0',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = 'primary', size = 'md', loading = false, disabled, children, onClick, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      // A loading button stays focusable but rejects clicks, so screen-reader
      // users are not thrown out of the form mid-submit. Disabling it would
      // drop focus to the page body the moment it started loading.
      disabled={disabled}
      aria-disabled={loading || undefined}
      aria-busy={loading || undefined}
      onClick={(event) => {
        if (loading) {
          event.preventDefault();
          return;
        }
        onClick?.(event);
      }}
      className={cn(
        'inline-flex items-center justify-center rounded-full font-medium transition-all duration-150 cursor-pointer',
        'disabled:pointer-events-none disabled:opacity-50 aria-disabled:cursor-progress',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...props}
    >
      {loading && <Loader2 className="size-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
});
