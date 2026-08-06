import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { TokensService } from './tokens.service';

/**
 * Expired refresh-token rows are never deleted by the auth flow itself (they
 * stay for replay detection until they expire), so this hourly job sweeps them.
 */
@Injectable()
export class TokenHousekeepingService {
  private readonly logger = new Logger(TokenHousekeepingService.name);

  constructor(private readonly tokens: TokensService) {}

  @Cron(CronExpression.EVERY_HOUR)
  async purgeExpiredTokens(): Promise<void> {
    const purged = await this.tokens.purgeExpired();
    if (purged > 0) {
      this.logger.log(`Purged ${purged} expired refresh token(s)`);
    }
  }
}
