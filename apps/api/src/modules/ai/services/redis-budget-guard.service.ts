import {
  Injectable,
  Logger,
  Inject,
  Optional,
  OnModuleDestroy,
  ServiceUnavailableException,
} from '@nestjs/common';
import Redis from 'ioredis';

export const REDIS_CLIENT_TOKEN = 'REDIS_CLIENT_TOKEN';

const RESERVE_LUA = `
local key = KEYS[1]
local estimate = tonumber(ARGV[1])
local cap = tonumber(ARGV[2])
local ledgerSpend = tonumber(ARGV[3])
local currentRaw = redis.call('get', key)
local current = math.max(tonumber(currentRaw or '0'), ledgerSpend)

if (current + estimate) > cap then
  redis.call('set', key, tostring(current), 'EX', 3024000)
  return {0, tostring(current)}
else
  local newVal = current + estimate
  -- 35 day TTL ensures cleanup across month boundaries.
  redis.call('set', key, tostring(newVal), 'EX', 3024000)
  return {1, tostring(newVal)}
end
`;

const RECONCILE_LUA = `
local key = KEYS[1]
local delta = tonumber(ARGV[1])
local new_val = redis.call('incrbyfloat', key, delta)
if tonumber(new_val) < 0 then
  redis.call('set', key, '0', 'KEEPTTL')
  return '0'
end
return tostring(new_val)
`;

@Injectable()
export class RedisBudgetGuardService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisBudgetGuardService.name);

  constructor(
    @Optional()
    @Inject(REDIS_CLIENT_TOKEN)
    private readonly redis: Redis | null,
  ) {}

  onModuleDestroy(): void {
    if (this.redis) {
      this.redis.disconnect();
    }
  }

  private getPeriodKey(organizationId: string): string {
    const d = new Date();
    const period = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    return `ai:budget:${organizationId}:${period}`;
  }

  async checkAndReserve(
    organizationId: string,
    estimatedCostUsd: number,
    monthlyCapUsd: number,
    initialSpendUsd = 0,
  ): Promise<{
    allowed: boolean;
    reservedAmount: number;
    currentSpendUsd: number;
    periodKey: string;
  }> {
    if (!this.redis) {
      throw new ServiceUnavailableException(
        'AI budget enforcement is unavailable because Redis is not configured',
      );
    }

    try {
      const key = this.getPeriodKey(organizationId);
      const res = (await this.redis.eval(
        RESERVE_LUA,
        1,
        key,
        String(estimatedCostUsd),
        String(monthlyCapUsd),
        String(initialSpendUsd),
      )) as [number, string];

      const allowed = res[0] === 1;
      const currentSpendUsd = parseFloat(res[1]);

      return {
        allowed,
        reservedAmount: allowed ? estimatedCostUsd : 0,
        currentSpendUsd,
        periodKey: key,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Redis budget check failed: ${msg}`);
      throw new ServiceUnavailableException(
        'AI budget enforcement is unavailable',
      );
    }
  }

  async reconcile(
    organizationId: string,
    actualCostUsd: number,
    reservedAmount: number,
    periodKey?: string,
  ): Promise<void> {
    if (!this.redis || reservedAmount === 0) return;

    try {
      const key = periodKey ?? this.getPeriodKey(organizationId);
      const delta = Number((actualCostUsd - reservedAmount).toFixed(8));
      await this.redis.eval(RECONCILE_LUA, 1, key, String(delta));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Redis budget reconciliation failed: ${msg}`);
      throw new ServiceUnavailableException(
        'AI budget reconciliation failed',
      );
    }
  }
}
