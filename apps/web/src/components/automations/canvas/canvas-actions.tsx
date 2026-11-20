'use client';

import { createContext, useContext } from 'react';

/**
 * What the canvas offers each step drawn on it. A step outside a canvas (a
 * preview, a test) gets `null` and simply shows no "+".
 */
export interface CanvasActions {
  /** Open the step chooser to add a step after this output of this step. */
  onAddAfter: (nodeId: string, handle: string | null) => void;
  /** `${nodeId}:${handle ?? ''}` for every output that already leads somewhere. */
  connectedOutputs: Set<string>;
  /** "Every weekday at 09:00": the automation's schedule, for the step that starts it. */
  scheduleSummary?: string | null;
}

export const CanvasActionsContext = createContext<CanvasActions | null>(null);

export function useCanvasActions(): CanvasActions | null {
  return useContext(CanvasActionsContext);
}

export function outputKey(nodeId: string, handle: string | null | undefined): string {
  return `${nodeId}:${handle ?? ''}`;
}
