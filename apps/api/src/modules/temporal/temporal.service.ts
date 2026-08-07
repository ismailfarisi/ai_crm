import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { Client, Connection } from '@temporalio/client';

@Injectable()
export class TemporalService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TemporalService.name);
  private client: Client | null = null;
  private connection: Connection | null = null;

  async onModuleInit() {
    try {
      const address = process.env.TEMPORAL_ADDRESS || 'localhost:7233';
      this.connection = await Connection.connect({ address });
      this.client = new Client({ connection: this.connection });
      this.logger.log(`Connected to Temporal Server at ${address}`);
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Temporal server connection deferred/failed: ${errorMsg}`);
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

  getClient(): Client {
    if (!this.client) {
      throw new Error('Temporal client is not initialized or server is offline');
    }
    return this.client;
  }
}
