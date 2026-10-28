import type { AutomationEdge, AutomationNode } from './types';

const AI_NODE_TYPES = new Set<string>(['aiPromptNode', 'aiAgentNode']);

/** The email fields whose text decides who reads it and what it says. */
const EMAIL_TEXT_FIELDS = ['to', 'subject', 'body'] as const;

/** `$json` or `$node` in any form: dot or bracket access, any quoting. */
const UPSTREAM_REF = /\$(?:json|node)(?![\w$])/;

/** `$node["Label"]`, `$node['Label']`, `` $node[`Label`] `` or `$node.Label`. */
const NAMED_NODE_REF =
  /\$node\s*(?:\[\s*(?:"([^"]*)"|'([^']*)'|`([^`]*)`)\s*\]|\.\s*([\w$]+))/;

function collectStrings(value: unknown, out: string[]): void {
  if (typeof value === 'string') {
    out.push(value);
  } else if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, out);
  } else if (value && typeof value === 'object') {
    for (const item of Object.values(value)) collectStrings(item, out);
  }
}

function hasAiAncestor(
  nodeId: string,
  nodes: AutomationNode[],
  edges: AutomationEdge[],
): boolean {
  const aiIds = new Set(
    nodes.filter((n) => AI_NODE_TYPES.has(n.type)).map((n) => n.id),
  );
  if (aiIds.size === 0) return false;

  const visited = new Set<string>([nodeId]);
  const queue = [nodeId];
  while (queue.length > 0) {
    const current = queue.shift() as string;
    for (const edge of edges) {
      if (edge.target !== current || visited.has(edge.source)) continue;
      if (aiIds.has(edge.source)) return true;
      visited.add(edge.source);
      queue.push(edge.source);
    }
  }
  return false;
}

/**
 * True when an email step's `to`, `subject` or `body` can carry text written
 * by an AI step: it references `$json` or `$node` (any form) and an AI prompt
 * or agent node is upstream of it anywhere in the graph, or a `$node`
 * reference names an AI node directly. Pure and import-free (types only)
 * because the Temporal workflow sandbox runs it.
 */
export function usesAiOutput(
  node: AutomationNode,
  nodes: AutomationNode[],
  edges: AutomationEdge[],
): boolean {
  const config = (node.data?.config ?? {}) as Record<string, unknown>;
  const strings: string[] = [];
  for (const field of EMAIL_TEXT_FIELDS) collectStrings(config[field], strings);
  const text = strings.join('\n');
  if (!UPSTREAM_REF.test(text)) return false;

  if (hasAiAncestor(node.id, nodes, edges)) return true;

  const namedRefs = new RegExp(NAMED_NODE_REF.source, 'g');
  let match: RegExpExecArray | null;
  while ((match = namedRefs.exec(text)) !== null) {
    const name = match[1] ?? match[2] ?? match[3] ?? match[4];
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
