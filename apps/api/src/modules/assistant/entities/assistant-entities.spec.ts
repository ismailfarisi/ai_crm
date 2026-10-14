import { readFileSync } from 'fs';
import { join } from 'path';
import { getMetadataArgsStorage } from 'typeorm';
import { AssistantConversation } from './assistant-conversation.entity';
import { AssistantMessage } from './assistant-message.entity';
import { AssistantTurn } from './assistant-turn.entity';

const storage = () => getMetadataArgsStorage();
const table = (t: Function) => storage().tables.find((x) => x.target === t)?.name;
const indexes = (t: Function) => storage().indices.filter((x) => x.target === t);

describe('assistant entities', () => {
  it('map to the expected tables', () => {
    expect(table(AssistantConversation)).toBe('assistant_conversations');
    expect(table(AssistantTurn)).toBe('assistant_turns');
    expect(table(AssistantMessage)).toBe('assistant_messages');
  });

  it('allows one active turn per conversation via a partial unique index', () => {
    const idx = indexes(AssistantTurn).find(
      (i) => i.name === 'uq_assistant_turns_one_active_per_conversation',
    );
    expect(idx?.unique).toBe(true);
    expect(idx?.where).toBe(`"status" IN ('RUNNING', 'AWAITING_APPROVAL')`);
  });

  it('dedupes messages per turn event and orders by a generated seq', () => {
    const idx = indexes(AssistantMessage).find((i) => i.name === 'uq_assistant_messages_turn_event');
    expect(idx?.unique).toBe(true);
    expect(idx?.columns).toEqual(['turnId', 'eventKey']);
    const gen = storage().generations.find(
      (g) => g.target === AssistantMessage && g.propertyName === 'seq',
    );
    expect(gen?.strategy).toBe('increment');
  });
});

describe('AssistantChat migration', () => {
  const sql = readFileSync(
    join(__dirname, '../../../database/migrations/1789800000000-AssistantChat.ts'),
    'utf8',
  );

  it('creates indexes, the seq column and tenant/user FKs', () => {
    for (const s of [
      'idx_assistant_conversations_owner_recent',
      'uq_assistant_turns_one_active_per_conversation',
      'idx_assistant_messages_conversation_seq',
      'uq_assistant_messages_turn_event',
      'BIGSERIAL',
      'REFERENCES "users"("id")',
      'REFERENCES "organizations"("id")',
    ]) {
      expect(sql).toContain(s);
    }
  });

  it('forces row level security on all three tables', () => {
    for (const t of ['assistant_conversations', 'assistant_turns', 'assistant_messages']) {
      expect(sql).toContain(t);
    }
    expect(sql).toContain('FORCE ROW LEVEL SECURITY');
    expect(sql).toMatch(/for \(const table of \[[^\]]*assistant_conversations[^\]]*assistant_turns[^\]]*assistant_messages/);
  });
});
