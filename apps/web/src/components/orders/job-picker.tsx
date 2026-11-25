'use client';

import { forwardRef, type SelectHTMLAttributes } from 'react';
import { Select } from '@/components/ui/field';
import { useSalesOrders } from '@/hooks/use-sales-orders';

/** Orders a cost can still land on: a cancelled one has stopped. */
const LIVE = new Set(['OPEN', 'IN_PRODUCTION', 'FULFILLED', 'CLOSED']);

export interface JobPickerProps
  extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'children'> {
  label?: string;
  hint?: string;
  error?: string;
  containerClassName?: string;
  /** Keeps an order picked earlier in the list even if it has since closed. */
  currentId?: string | null;
}

/**
 * "For job": which customer order a purchase, a bill or an expense is for, so
 * its cost counts against that order's profit. Optional - most overheads are
 * for no job at all.
 */
export const JobPicker = forwardRef<HTMLSelectElement, JobPickerProps>(function JobPicker(
  {
    label = 'For job',
    hint = 'Pick the customer order this cost is for. It then counts against that order’s profit.',
    currentId,
    ...props
  },
  ref,
) {
  const { data, isLoading } = useSalesOrders({});
  const orders = (data ?? []).filter((o) => LIVE.has(o.status) || o.id === currentId);
  return (
    <Select
      ref={ref}
      label={label}
      hint={hint}
      placeholder={isLoading ? 'Loading orders…' : 'Not for a job'}
      options={orders.map((o) => ({
        value: o.id,
        label: `${o.orderNumber} · ${o.customerName}`,
      }))}
      {...props}
    />
  );
});
