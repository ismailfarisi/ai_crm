const mockStart = jest.fn();
const mockInfo = jest.fn();

jest.mock('@temporalio/workflow', () => ({
  ...jest.requireActual('@temporalio/workflow'),
  proxyActivities: () => ({
    startScheduledRunActivity: (...args: unknown[]) => mockStart(...args),
  }),
  workflowInfo: () => mockInfo(),
}));

import {
  scheduledTickWorkflow,
  scheduledTimeOf,
} from './scheduled-tick.workflow';

// `@temporalio/common` is not a direct dependency of the API; load the copy
// the workflow SDK itself uses, so these are the real attribute classes.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const common: any = require(
  require.resolve('@temporalio/common', {
    paths: [require.resolve('@temporalio/workflow')],
  }),
);
const { SearchAttributeType, TypedSearchAttributes, defineSearchAttributeKey } =
  common;

const SCHEDULED = new Date('2026-10-29T05:30:00.000Z');
const STARTED = new Date('2026-10-29T05:30:02.417Z');
const scheduledKey = defineSearchAttributeKey(
  'TemporalScheduledStartTime',
  SearchAttributeType.DATETIME,
);

describe('scheduledTimeOf', () => {
  it('reads the TemporalScheduledStartTime search attribute set by the schedule', () => {
    expect(
      scheduledTimeOf({
        startTime: STARTED,
        typedSearchAttributes: new TypedSearchAttributes([
          { key: scheduledKey, value: SCHEDULED },
        ]),
        searchAttributes: {},
      }),
    ).toBe('2026-10-29T05:30:00.000Z');
  });

  it('accepts the untyped form when the typed one is missing', () => {
    expect(
      scheduledTimeOf({
        startTime: STARTED,
        typedSearchAttributes: new TypedSearchAttributes(),
        searchAttributes: { TemporalScheduledStartTime: [SCHEDULED] },
      }),
    ).toBe('2026-10-29T05:30:00.000Z');
  });

  it('falls back to the start time when no schedule time is attached', () => {
    expect(
      scheduledTimeOf({
        startTime: STARTED,
        typedSearchAttributes: new TypedSearchAttributes(),
        searchAttributes: {},
      }),
    ).toBe('2026-10-29T05:30:02.417Z');
  });
});

describe('scheduledTickWorkflow', () => {
  beforeEach(() => {
    mockStart
      .mockReset()
      .mockResolvedValue({ started: true, executionId: 'e1' });
    mockInfo.mockReset().mockReturnValue({
      startTime: STARTED,
      typedSearchAttributes: new TypedSearchAttributes([
        { key: scheduledKey, value: SCHEDULED },
      ]),
      searchAttributes: {},
    });
  });

  it('hands the scheduled time to the activity that starts the run', async () => {
    await expect(
      scheduledTickWorkflow({ tenantId: 't1', workflowId: 'wf-1' }),
    ).resolves.toEqual({ started: true, executionId: 'e1' });
    expect(mockStart).toHaveBeenCalledWith({
      tenantId: 't1',
      workflowId: 'wf-1',
      scheduledAt: '2026-10-29T05:30:00.000Z',
    });
  });
});
