import { CHANNEL_SKILLS, type ChannelSkillName } from '@saas/shared';

/**
 * Golden extractions: message in, exact slot object out.
 *
 * The awkward ones are the point. "a couple of boxes" has no number in it,
 * "same as last time" names no material, and one sentence can carry two
 * materials — each is a place where a model that tries to be helpful invents
 * something. The slot schema is the safety net underneath: anything it
 * refuses becomes a question, never an action.
 */
export interface ExtractionCase {
  skill: ChannelSkillName;
  message: string;
  /** What the model is recorded as returning. */
  recorded: Record<string, unknown>;
  /** What must survive `slotSchema.parse` — the contract the services see. */
  slots: Record<string, unknown>;
  note?: string;
}

const PO = CHANNEL_SKILLS.PURCHASE_ORDER_CREATE;
const APPROVE = CHANNEL_SKILLS.QUOTE_APPROVE;
const LOG = CHANNEL_SKILLS.WORK_ORDER_LOG_TIME;

export const EXTRACTION_CASES: ExtractionCase[] = [
  {
    skill: PO,
    message: 'order 500 sheets of 350gsm board from Wexford',
    recorded: {
      supplierQuery: 'Wexford',
      lines: [{ materialQuery: '350gsm board', qty: 500, uom: 'sheets' }],
    },
    slots: {
      supplierQuery: 'Wexford',
      lines: [{ materialQuery: '350gsm board', qty: 500, uom: 'sheets' }],
    },
  },
  {
    skill: PO,
    message: 'can you put an order in for a couple of boxes of ink',
    recorded: { lines: [{ materialQuery: 'ink', uom: 'boxes' }] },
    slots: { lines: [{ materialQuery: 'ink', uom: 'boxes' }] },
    note: '"a couple" is not a quantity: the skill must ask, not assume two',
  },
  {
    skill: PO,
    message: 'reorder the same board as last time, 500 sheets',
    recorded: {
      lines: [
        {
          materialQuery: 'the same board as last time',
          qty: 500,
          uom: 'sheets',
        },
      ],
    },
    slots: {
      lines: [
        {
          materialQuery: 'the same board as last time',
          qty: 500,
          uom: 'sheets',
        },
      ],
    },
    note: 'no supplier stated; resolution asks rather than guessing the last one',
  },
  {
    skill: PO,
    message: '200 mailer boxes and 5 reams of 120gsm silk from Kraft & Co',
    recorded: {
      supplierQuery: 'Kraft & Co',
      lines: [
        { materialQuery: 'mailer boxes', qty: 200 },
        { materialQuery: '120gsm silk', qty: 5, uom: 'reams' },
      ],
    },
    slots: {
      supplierQuery: 'Kraft & Co',
      lines: [
        { materialQuery: 'mailer boxes', qty: 200 },
        { materialQuery: '120gsm silk', qty: 5, uom: 'reams' },
      ],
    },
    note: 'two materials in one sentence',
  },
  {
    skill: PO,
    message: 'order 500 sheets of 350gsm at about 40p from Wexford',
    recorded: {
      supplierQuery: 'Wexford',
      lines: [{ materialQuery: '350gsm', qty: 500, uom: 'sheets' }],
    },
    slots: {
      supplierQuery: 'Wexford',
      lines: [{ materialQuery: '350gsm', qty: 500, uom: 'sheets' }],
    },
    note: 'the price in the message is not a slot: prices come from the catalog',
  },
  {
    skill: PO,
    message: 'order minus 5 boxes of ink',
    recorded: { lines: [{ materialQuery: 'ink', qty: -5, uom: 'boxes' }] },
    slots: {},
    note: 'a negative quantity fails the schema, so nothing reaches the service',
  },
  {
    skill: APPROVE,
    message: 'approve QT-2026-0001',
    recorded: { action: 'APPROVE', quoteNumber: 'QT-2026-0001' },
    slots: { action: 'APPROVE', quoteNumber: 'QT-2026-0001' },
  },
  {
    skill: APPROVE,
    message: 'approve the Henderson quote and send it',
    recorded: { action: 'APPROVE_AND_SEND', customerName: 'Henderson' },
    slots: { action: 'APPROVE_AND_SEND', customerName: 'Henderson' },
  },
  {
    skill: APPROVE,
    message: 'approve it',
    recorded: { action: 'APPROVE' },
    slots: { action: 'APPROVE' },
    note: 'no quote named; resolution has to ask which',
  },
  {
    skill: LOG,
    message: 'log 2 hours on WO-2026-0004',
    recorded: { workOrderNumber: 'WO-2026-0004', minutes: 120 },
    slots: { workOrderNumber: 'WO-2026-0004', minutes: 120 },
  },
  {
    skill: LOG,
    message: 'finished setup on WO-0004, took an hour and a half',
    recorded: {
      workOrderNumber: 'WO-0004',
      operationQuery: 'setup',
      minutes: 90,
    },
    slots: {
      workOrderNumber: 'WO-0004',
      operationQuery: 'setup',
      minutes: 90,
    },
    note: 'prose duration normalised to minutes by the model, checked by the schema',
  },
  {
    skill: LOG,
    message: 'book 45 mins to the guillotine job',
    recorded: { operationQuery: 'guillotine', minutes: 45 },
    slots: { operationQuery: 'guillotine', minutes: 45 },
  },
];
