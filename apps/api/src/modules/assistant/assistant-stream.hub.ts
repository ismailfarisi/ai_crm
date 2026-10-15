// assistant-stream.hub.ts
import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type Redis from 'ioredis';
import { ASSISTANT_REDIS_SUBSCRIBER, assistantChannel } from './assistant-redis';

/** One Redis subscription per conversation per API process, fanned out to every open stream. */
@Injectable()
export class AssistantStreamHub implements OnModuleInit, OnModuleDestroy {
  private readonly listeners = new Map<string, Set<() => void>>();

  constructor(@Inject(ASSISTANT_REDIS_SUBSCRIBER) private readonly redis: Redis) {}

  onModuleInit() {
    this.redis.on('message', (channel: string) => {
      for (const listener of this.listeners.get(channel) ?? []) listener();
    });
  }

  async onModuleDestroy() {
    await this.redis.quit().catch(() => undefined);
  }

  listen(conversationId: string, onNudge: () => void): () => void {
    const channel = assistantChannel(conversationId);
    let set = this.listeners.get(channel);
    if (!set) {
      set = new Set();
      this.listeners.set(channel, set);
      this.redis.subscribe(channel).catch(() => undefined);
    }
    set.add(onNudge);
    return () => {
      set!.delete(onNudge);
      if (set!.size === 0) {
        this.listeners.delete(channel);
        this.redis.unsubscribe(channel).catch(() => undefined);
      }
    };
  }
}
