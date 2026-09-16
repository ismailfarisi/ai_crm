'use client';

import React from 'react';
import { Handle, Position } from '@xyflow/react';
import { type LucideIcon } from 'lucide-react';
import clsx from 'clsx';

export type NodeExecutionStatus = 'SUCCESS' | 'FAILED' | 'WAITING' | 'IDLE' | 'SKIPPED' | 'RUNNING';

export interface BaseNodeProps {
  icon: LucideIcon;
  title: string;
  category: string;
  subtitle?: string;
  status?: NodeExecutionStatus;
  selected?: boolean;
  hasInput?: boolean;
  hasOutput?: boolean;
  inputHandleId?: string;
  outputHandleId?: string;
  inputHandlePosition?: Position;
  outputHandlePosition?: Position;
  badge?: React.ReactNode;
  iconBg?: string;
  iconColor?: string;
  className?: string;
  isConnectable?: boolean;
  children?: React.ReactNode;
  testId?: string;
}

export function BaseNode({
  icon: Icon,
  title,
  category,
  subtitle,
  status = 'IDLE',
  selected = false,
  hasInput = true,
  hasOutput = true,
  inputHandleId,
  outputHandleId,
  inputHandlePosition = Position.Left,
  outputHandlePosition = Position.Right,
  badge,
  iconBg = 'bg-surface-muted',
  iconColor = 'text-ink',
  className,
  isConnectable = true,
  children,
  testId,
}: BaseNodeProps) {
  return (
    <div
      data-testid={testId || 'base-node'}
      className={clsx(
        'w-64 rounded-xl border bg-surface p-3.5 shadow-sm transition-all duration-200 relative select-none',
        selected
          ? 'border-brand ring-2 ring-brand/20 shadow-md'
          : 'border-border hover:border-border-strong',
        status === 'SUCCESS' && 'border-success ring-2 ring-success/15',
        status === 'FAILED' && 'border-danger ring-2 ring-danger/15',
        (status === 'WAITING' || status === 'RUNNING') && 'border-brand ring-2 ring-brand/25 animate-pulse',
        status === 'SKIPPED' && 'border-dashed border-border-strong opacity-60',
        className,
      )}
    >
      {/* Target (Input) Handle */}
      {hasInput && (
        <Handle
          type="target"
          position={inputHandlePosition}
          id={inputHandleId}
          isConnectable={isConnectable}
          className="!w-3 !h-3 !bg-border-strong !border-2 !border-surface transition-all hover:scale-125 !left-[-6px]"
        />
      )}

      {/* Node Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2.5 min-w-0 flex-1">
          <div
            className={clsx(
              'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg shadow-2xs',
              iconBg,
              iconColor,
            )}
          >
            <Icon className="h-4 w-4" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-bold uppercase tracking-wider text-ink-muted truncate">
                {category}
              </span>
            </div>
            <h4 className="text-xs font-semibold text-ink truncate leading-tight mt-0.5">
              {title}
            </h4>
            {subtitle && (
              <p className="text-[11px] text-ink-muted truncate leading-tight mt-0.5">
                {subtitle}
              </p>
            )}
          </div>
        </div>

        {/* Status indicator or Custom Badge */}
        {badge ? (
          <div className="shrink-0">{badge}</div>
        ) : status !== 'IDLE' ? (
          <div className="shrink-0">
            {status === 'SUCCESS' && (
              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-success-soft text-success border border-success/20">
                Success
              </span>
            )}
            {status === 'FAILED' && (
              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-danger-soft text-danger border border-danger/20">
                Failed
              </span>
            )}
            {(status === 'WAITING' || status === 'RUNNING') && (
              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-brand-soft text-ink border border-brand/30 animate-pulse">
                {status === 'WAITING' ? 'Waiting' : 'Running'}
              </span>
            )}
            {status === 'SKIPPED' && (
              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-surface-muted text-ink-muted border border-border">
                Skipped
              </span>
            )}
          </div>
        ) : null}
      </div>

      {/* Node Body / Custom content */}
      {children && (
        <div className="mt-2.5 pt-2 border-t border-border/40 text-xs text-ink-muted">
          {children}
        </div>
      )}

      {/* Source (Output) Handle */}
      {hasOutput && (
        <Handle
          type="source"
          position={outputHandlePosition}
          id={outputHandleId}
          isConnectable={isConnectable}
          className="!w-3 !h-3 !bg-brand !border-2 !border-surface transition-all hover:scale-125 !right-[-6px]"
        />
      )}
    </div>
  );
}
