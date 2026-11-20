'use client';

import React from 'react';
import { Plus } from 'lucide-react';
import { useNodeId } from '@xyflow/react';
import clsx from 'clsx';
import { outputKey, useCanvasActions } from '../canvas/canvas-actions';

export interface AddStepButtonProps {
  /** The named output this button continues from; none for a step with one output. */
  handle?: string | null;
  /** What the output is called, for the button's label: "Yes", "Approved"… */
  outputName?: string;
  className?: string;
}

/**
 * The "+" beside a step's output. It opens the step chooser, and the chosen
 * step arrives placed and connected. Always visible on an output that leads
 * nowhere yet; on a connected one it shows on hover, to add a step in between.
 */
export function AddStepButton({ handle = null, outputName, className }: AddStepButtonProps) {
  const nodeId = useNodeId();
  const actions = useCanvasActions();
  if (!nodeId || !actions) return null;

  const connected = actions.connectedOutputs.has(outputKey(nodeId, handle));
  const label = connected
    ? `Add a step in between${outputName ? ` on the ${outputName} path` : ''}`
    : `Add a step${outputName ? ` on the ${outputName} path` : ' after this one'}`;

  return (
    <button
      type="button"
      data-testid={`add-step-after-${nodeId}${handle ? `-${handle}` : ''}`}
      aria-label={label}
      title={label}
      // The canvas would otherwise read the press as dragging or selecting the step.
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        actions.onAddAfter(nodeId, handle);
      }}
      className={clsx(
        'nodrag nopan absolute top-1/2 -translate-y-1/2 flex h-6 w-6 items-center justify-center rounded-full border border-brand bg-surface text-ink shadow-sm transition hover:bg-brand hover:text-on-brand cursor-pointer z-10',
        connected ? 'opacity-0 group-hover/step:opacity-100 focus-visible:opacity-100' : 'opacity-100',
        className ?? 'right-[-38px]',
      )}
    >
      <Plus aria-hidden className="h-3.5 w-3.5" />
    </button>
  );
}
