import { AssistantStreamHub } from './assistant-stream.hub';

describe('AssistantStreamHub', () => {
  it('subscribes once per conversation, fans out, and unsubscribes when the last listener leaves', async () => {
    const handlers: Record<string, (channel: string) => void> = {};
    const redis = {
      subscribe: jest.fn().mockResolvedValue(1),
      unsubscribe: jest.fn().mockResolvedValue(1),
      on: (event: string, fn: any) => { handlers[event] = fn; },
    } as any;
    const hub = new AssistantStreamHub(redis);
    hub.onModuleInit();
    const a = jest.fn();
    const b = jest.fn();
    const offA = hub.listen('conv-1', a);
    const offB = hub.listen('conv-1', b);
    expect(redis.subscribe).toHaveBeenCalledTimes(1);
    handlers.message('assistant:conv:conv-1');
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    offA();
    expect(redis.unsubscribe).not.toHaveBeenCalled();
    offB();
    expect(redis.unsubscribe).toHaveBeenCalledWith('assistant:conv:conv-1');
  });
});
