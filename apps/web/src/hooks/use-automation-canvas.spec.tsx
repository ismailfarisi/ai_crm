import { describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { AutomationEdge, AutomationNode } from '@saas/shared';
import { positionAfter, useAutomationCanvas } from './use-automation-canvas';

const trigger: AutomationNode = {
  id: 't',
  type: 'crmEventTrigger',
  position: { x: 100, y: 200 },
  data: { label: 'Start', config: { event: 'quote.accepted' } },
};
const email: AutomationNode = {
  id: 'mail',
  type: 'sendEmailNode',
  position: { x: 440, y: 200 },
  data: { label: 'Email', config: {} },
};
const edge: AutomationEdge = { id: 'e1', source: 't', target: 'mail' };

const open = (nodes: AutomationNode[], edges: AutomationEdge[] = []) =>
  renderHook(() => useAutomationCanvas({ initialNodes: nodes, initialEdges: edges }));

describe('adding a step after another', () => {
  it('places the new step beside the one it follows and connects the two', () => {
    const { result } = open([trigger]);

    act(() => {
      result.current.addNode({ type: 'delayNode', after: { nodeId: 't' } });
    });

    const added = result.current.nodes.find((n) => n.type === 'delayNode')!;
    expect(added.position).toEqual({ x: 440, y: 200 });
    expect(added.data.label).toBe('Wait');
    expect(result.current.edges).toHaveLength(1);
    expect(result.current.edges[0]).toMatchObject({ source: 't', target: added.id });
    expect(result.current.selectedNode?.id).toBe(added.id);
    expect(result.current.isDirty).toBe(true);
  });

  it('builds "quote accepted, wait, email" as one connected line', () => {
    const { result } = open([trigger]);

    let waitId = '';
    act(() => {
      waitId = result.current.addNode({ type: 'delayNode', after: { nodeId: 't' } }).id;
    });
    act(() => {
      result.current.addNode({ type: 'sendEmailNode', after: { nodeId: waitId } });
    });

    const mail = result.current.nodes.find((n) => n.type === 'sendEmailNode')!;
    expect(result.current.edges.map((e) => [e.source, e.target])).toEqual([
      ['t', waitId],
      [waitId, mail.id],
    ]);
    expect(mail.position.x).toBeGreaterThan(result.current.nodes.find((n) => n.id === waitId)!.position.x);
    expect(result.current.isValid).toBe(true);
  });

  it('goes in between when that output already leads somewhere, and moves the rest along', () => {
    const { result } = open([trigger, email], [edge]);

    act(() => {
      result.current.addNode({ type: 'delayNode', after: { nodeId: 't' } });
    });

    const wait = result.current.nodes.find((n) => n.type === 'delayNode')!;
    expect(wait.position).toEqual({ x: 440, y: 200 });
    expect(result.current.nodes.find((n) => n.id === 'mail')!.position.x).toBe(780);
    expect(result.current.edges.map((e) => [e.source, e.target]).sort()).toEqual(
      [
        ['t', wait.id],
        [wait.id, 'mail'],
      ].sort(),
    );
  });

  it('continues a branch from the output it was added on', () => {
    const check: AutomationNode = {
      id: 'check',
      type: 'conditionNode',
      position: { x: 440, y: 200 },
      data: { label: 'Big quote?', config: {} },
    };
    const { result } = open([trigger, check], [{ id: 'e1', source: 't', target: 'check' }]);

    act(() => {
      result.current.addNode({ type: 'sendEmailNode', after: { nodeId: 'check', handle: 'true' } });
    });
    act(() => {
      result.current.addNode({ type: 'delayNode', after: { nodeId: 'check', handle: 'false' } });
    });

    const yes = result.current.nodes.find((n) => n.type === 'sendEmailNode')!;
    const no = result.current.nodes.find((n) => n.type === 'delayNode')!;
    expect(result.current.edges.find((e) => e.target === yes.id)).toMatchObject({ source: 'check', sourceHandle: 'true' });
    expect(result.current.edges.find((e) => e.target === no.id)).toMatchObject({ source: 'check', sourceHandle: 'false' });
    // The two paths fan out instead of landing on each other.
    expect(yes.position.y).toBeLessThan(no.position.y);
  });

  it('never puts a step on top of another', () => {
    const taken = [{ position: { x: 440, y: 200 } }, { position: { x: 440, y: 360 } }];
    expect(positionAfter(taken, { position: { x: 100, y: 200 } })).toEqual({ x: 440, y: 520 });
  });

  it('gives a new wait a duration the engine reads', () => {
    const { result } = open([trigger]);
    act(() => {
      result.current.addNode({ type: 'delayNode', after: { nodeId: 't' } });
    });
    const wait = result.current.nodes.find((n) => n.type === 'delayNode')!;
    expect(wait.data.config).toEqual({ duration: '5 minutes' });
  });
});
