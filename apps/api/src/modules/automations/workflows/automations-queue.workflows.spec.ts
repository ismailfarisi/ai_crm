import * as entry from './automations-queue.workflows';

describe('automations-queue workflow entry', () => {
  // Temporal registers a queue's workflows by the export names of its
  // workflowsPath module. The DAG starts agentReActWorkflow as a child on this
  // same queue, so it must be registered here too.
  it('exports exactly the workflows the automations-queue runs', () => {
    expect(Object.keys(entry).sort()).toEqual([
      'agentReActWorkflow',
      'dynamicDagWorkflow',
      'scheduledTickWorkflow',
    ]);
    for (const fn of Object.values(entry)) {
      expect(typeof fn).toBe('function');
    }
  });
});
