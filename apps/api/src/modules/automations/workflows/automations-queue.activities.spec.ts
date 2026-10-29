import { buildAutomationsQueueActivities } from './automations-queue.activities';

describe('buildAutomationsQueueActivities', () => {
  it('registers the run-record activities the workflow calls', () => {
    const noop = async () => undefined;
    const activities = buildAutomationsQueueActivities({
      automationActivities: { executeHttpActivity: noop },
      automationActions: {},
      agentReactActivities: {},
      scheduledTickActivities: {},
      runRecordActivities: {
        recordNodeResultActivity: noop as never,
        recordRunFinishedActivity: noop as never,
      },
    });
    expect(Object.keys(activities)).toEqual(
      expect.arrayContaining([
        'executeHttpActivity',
        'recordNodeResultActivity',
        'recordRunFinishedActivity',
      ]),
    );
  });
});
