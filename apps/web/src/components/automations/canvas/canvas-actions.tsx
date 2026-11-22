'use client';

import { createContext, useContext } from 'react';
import { useNodeId } from '@xyflow/react';

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
  /** A step's text with the data it uses shown by name: "Quote accepted: [Quote number]". */
  nameData?: (nodeId: string, text: string) => string;
}

export const CanvasActionsContext = createContext<CanvasActions | null>(null);

export function useCanvasActions(): CanvasActions | null {
  return useContext(CanvasActionsContext);
}

/**
 * For a step's card: turns a text into the same text with the data it uses
 * shown by name, "Quote accepted: [Quote number]" instead of `{{ … }}`.
 */
export function useNamedText(): (text: unknown) => string {
  const nodeId = useNodeId();
  const nameData = useContext(CanvasActionsContext)?.nameData;
  return (text) => (typeof text !== 'string' ? '' : nodeId && nameData ? nameData(nodeId, text) : text);
}

export function outputKey(nodeId: string, handle: string | null | undefined): string {
  return `${nodeId}:${handle ?? ''}`;
}
