import { CHANNEL_SKILLS, type ChannelSkillName } from '@saas/shared';

/**
 * The routing set: recorded messages and the skill each one means.
 *
 * `null` is a real expectation, not a gap — greetings, questions, customer
 * messages that reached the staff path and near-misses between two skills all
 * have to route nowhere. A model that routes them somewhere is worse than one
 * that routes nothing, because the first one acts.
 *
 * `recorded` is what the model actually answered when this case was added.
 * In CI it is replayed, so a prompt change shows up as a diff in this file
 * rather than as a mystery failure; nightly, the same set runs against the
 * live provider and reports accuracy.
 */
export interface RoutingCase {
  message: string;
  expect: ChannelSkillName | null;
  /** What the recorded provider answers. Usually the expectation. */
  recorded?: { skill: string | null; confidence: number };
  note?: string;
}

const PO = CHANNEL_SKILLS.PURCHASE_ORDER_CREATE;
const APPROVE = CHANNEL_SKILLS.QUOTE_APPROVE;
const LOG = CHANNEL_SKILLS.WORK_ORDER_LOG_TIME;
const DISPATCH = CHANNEL_SKILLS.DELIVERY_DISPATCH;
const SO_FROM_DOC = CHANNEL_SKILLS.SALES_ORDER_FROM_DOCUMENT;

export const ROUTING_CASES: RoutingCase[] = [
  /* ---- purchase orders ---- */
  { message: 'order 500 sheets of 350gsm board from Wexford', expect: PO },
  { message: 'raise a PO to Wexford for 20 boxes of A4 white', expect: PO },
  { message: 'we need more 350gsm, usual supplier, 1000 sheets', expect: PO },
  {
    message: 'can you put an order in for a couple of boxes of ink',
    expect: PO,
  },
  { message: 'buy 200 mailer boxes from Kraft & Co please', expect: PO },
  { message: 'PO for 5 reams of 120gsm silk', expect: PO },
  { message: 'get 50kg of white ink ordered', expect: PO },
  { message: 'reorder the same board as last time, 500 sheets', expect: PO },
  { message: 'purchase order: Wexford, 350gsm board, 500 sheets', expect: PO },
  { message: 'stick an order in with Kraft for 1000 boxes', expect: PO },

  /* ---- quote approval ---- */
  { message: 'approve QT-2026-0001', expect: APPROVE },
  { message: 'yes approve that quote', expect: APPROVE },
  { message: 'sign off quote 0042', expect: APPROVE },
  { message: 'QT-2026-0107 is fine, approve it', expect: APPROVE },
  { message: 'reject QT-2026-0033, margin is too thin', expect: APPROVE },
  { message: 'turn down quote 0033', expect: APPROVE },
  { message: 'approve the Henderson quote', expect: APPROVE },
  { message: 'that quote for Lyon SARL can go ahead', expect: APPROVE },

  /* ---- work order time ---- */
  { message: 'log 2 hours on WO-2026-0004', expect: LOG },
  { message: 'spent 90 minutes on the Henderson job', expect: LOG },
  { message: 'put 3.5 hours against work order 12 for me', expect: LOG },
  {
    message: 'finished setup on WO-0004, took an hour and a half',
    expect: LOG,
  },
  { message: 'book 45 mins to the guillotine job', expect: LOG },
  { message: 'I did 6 hours on the mailer box run today', expect: LOG },

  /* ---- delivery dispatch ---- */
  {
    message: 'dispatch DN-2026-0001',
    expect: DISPATCH,
    recorded: { skill: DISPATCH, confidence: 0.95 },
  },
  {
    message: 'ship delivery note 0002',
    expect: DISPATCH,
    recorded: { skill: DISPATCH, confidence: 0.9 },
  },
  {
    message: 'ship the remaining items on SO-2026-0005',
    expect: DISPATCH,
    recorded: { skill: DISPATCH, confidence: 0.92 },
  },
  {
    message: 'dispatch order SO-2026-0003 for Acme',
    expect: DISPATCH,
    recorded: { skill: DISPATCH, confidence: 0.9 },
  },

  /* ---- sales order from document ---- */
  {
    message: 'customer sent PO-9912 for quote QT-2026-0004',
    expect: SO_FROM_DOC,
    recorded: { skill: SO_FROM_DOC, confidence: 0.95 },
  },
  {
    message: 'customer PO-1029 approving our quote QT-2026-0010',
    expect: SO_FROM_DOC,
    recorded: { skill: SO_FROM_DOC, confidence: 0.93 },
  },
  {
    message: 'turn customer PO-8831 into an order',
    expect: SO_FROM_DOC,
    recorded: { skill: SO_FROM_DOC, confidence: 0.9 },
  },
  {
    message:
      'create sales order from customer PO-4551 for Acme Corp: 500 units of custom boxes',
    expect: SO_FROM_DOC,
    recorded: { skill: SO_FROM_DOC, confidence: 0.92 },
  },

  /* ---- nothing: greetings and chatter ---- */
  { message: 'morning', expect: null, note: 'greeting' },
  { message: 'hello?', expect: null, note: 'greeting' },
  { message: 'thanks, appreciated', expect: null, note: 'pleasantry' },
  { message: 'ok', expect: null, note: 'bare acknowledgement' },

  /* ---- nothing: questions, which are not commands ---- */
  {
    message: 'how much 350gsm is left?',
    expect: null,
    note: 'a stock question — no inventory skill is registered yet',
  },
  { message: 'what did we pay Wexford last time?', expect: null },
  {
    message: 'is QT-2026-0001 approved yet?',
    expect: null,
    note: 'status question, not an approval',
  },
  { message: 'when is the Henderson job due out?', expect: null },

  /* ---- nothing: customer messages that reached the staff path ---- */
  {
    message: 'Hi, can I get a price for 500 business cards?',
    expect: null,
    note: 'a customer enquiry — belongs to the customer agent, not a staff skill',
  },
  {
    message: 'Where is my order? It was due Friday.',
    expect: null,
    note: 'customer chasing delivery',
  },
  {
    message: 'Please cancel my order, we no longer need it.',
    expect: null,
    note: 'customer instruction — never actioned from the staff path',
  },

  /* ---- near-misses: the pairs that are easiest to confuse ---- */
  {
    message: 'receive the 500 sheets that came in from Wexford',
    expect: null,
    note: 'receiving, not ordering — no receive skill is registered yet',
  },
  {
    message: 'the Wexford order arrived, book it in',
    expect: null,
    note: 'goods receipt, not a new purchase order',
  },
  {
    message: 'chase Wexford about the order I raised yesterday',
    expect: null,
    note: 'a reminder about an order, not a request to raise one',
  },
  {
    message: 'how many hours are on WO-2026-0004 so far?',
    expect: null,
    note: 'asking about logged time, not logging it',
  },
  {
    message: 'send QT-2026-0001 to the customer',
    expect: null,
    note: 'sending a quote is not approving it',
  },
  {
    message: 'invoice the Henderson job',
    expect: null,
    note: 'invoicing — no skill for it yet, and it must not fall back to approval',
  },
];
