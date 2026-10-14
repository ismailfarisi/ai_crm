import Redis from 'ioredis';

export const ASSISTANT_REDIS_PUBLISHER = 'ASSISTANT_REDIS_PUBLISHER';
export const ASSISTANT_REDIS_SUBSCRIBER = 'ASSISTANT_REDIS_SUBSCRIBER';

export const assistantChannel = (conversationId: string) => `assistant:conv:${conversationId}`;

/** Same connection settings as AiModule's budget guard. A subscriber needs its own connection. */
export function createAssistantRedis(): Redis {
  const host = process.env.REDIS_HOST ?? 'localhost';
  const port = process.env.REDIS_PORT ?? '6380';
  const redis = new Redis(process.env.REDIS_URL ?? `redis://${host}:${port}`, {
    maxRetriesPerRequest: 1,
    lazyConnect: true,
  });
  redis.on('error', () => undefined);
  return redis;
}
