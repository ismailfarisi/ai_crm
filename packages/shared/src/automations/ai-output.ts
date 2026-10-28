import type { AutomationEdge, AutomationNode } from './types';

const AI_NODE_TYPES = new Set<string>(['aiPromptNode', 'aiAgentNode']);

function collectStrings(value: unknown, out: string[]): void {
  if (typeof value === 'string') {
    out.push(value);
  } else if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, out);
  } else if (value && typeof value === 'object') {
    for (const item of Object.values(value)) collectStrings(item, out);
  }
}

/**
 * True when a node's config pulls in text written by an AI step: either
 * `$json` while an AI node feeds it directly, or `$node["Label"]` naming an
 * AI node. Pure and import-free (types only) because the Temporal workflow
 * sandbox runs it.
 */
export function usesAiOutput(
  node: AutomationNode,
  nodes: AutomationNode[],
  edges: AutomationEdge[],
): boolean {
  const strings: string[] = [];
  collectStrings(node.data?.config, strings);
  const text = strings.join('\n');
  if (!text) return false;

  if (text.includes('$json')) {
    const fedByAi = edges.some(
      (edge) =>
        edge.target === node.id &&
        nodes.some((n) => n.id === edge.source && AI_NODE_TYPES.has(n.type)),
    );
    if (fedByAi) return true;
  }

  const refs = /\$node\[\s*(?:"([^"]*)"|'([^']*)')\s*\]/g;
  let match: RegExpExecArray | null;
  while ((match = refs.exec(text)) !== null) {
    const name = match[1] ?? match[2];
    if (
      nodes.some(
        (n) =>
          AI_NODE_TYPES.has(n.type) && (n.data?.label === name || n.id === name),
      )
    ) {
      return true;
    }
  }
  return false;
}
