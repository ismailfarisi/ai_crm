import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import { Client, Connection } from '@temporalio/client';

/**
 * One Temporal client per process. It connects at boot when it can, and
 * otherwise on first use: a Temporal server that was down at boot (or a
 * failed connect since) is retried by the next `getClient()` call, so the
 * API recovers without a restart.
 */
@Injectable()
export class TemporalService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TemporalService.name);
  private client: Client | null = null;
  private connection: Connection | null = null;
  /** The connect in flight, shared by every caller that arrives meanwhile. */
  private connecting: Promise<Client> | null = null;

  async onModuleInit() {
    try {
      await this.getClient();
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `Temporal server connection deferred/failed: ${errorMsg}`,
      );
    }
  }

  async onModuleDestroy() {
    if (this.connection) {
      try {
        await this.connection.close();
        this.logger.log('Closed Temporal connection');
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        this.logger.warn(`Error closing Temporal connection: ${errorMsg}`);
      }
    }
  }

  /**
   * The connected client, connecting first if there is none. A failed
   * connect rejects this call only; the next call tries again.
   */
  async getClient(): Promise<Client> {
    if (this.client) return this.client;
    if (!this.connecting) {
      this.connecting = this.connect().finally(() => {
        this.connecting = null;
      });
    }
    return this.connecting;
  }

  private async connect(): Promise<Client> {
    const address = process.env.TEMPORAL_ADDRESS || 'localhost:7233';
    const connection = await Connection.connect({ address });
    this.connection = connection;
    this.client = new Client({ connection });
    this.logger.log(`Connected to Temporal Server at ${address}`);
    return this.client;
  }
}
