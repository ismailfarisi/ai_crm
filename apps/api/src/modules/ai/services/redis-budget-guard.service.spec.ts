import Redis from 'ioredis';
import { RedisBudgetGuardService } from './redis-budget-guard.service';

describe('RedisBudgetGuardService', () => {
  let service: RedisBudgetGuardService;
  let mockRedis: {
    eval: jest.Mock;
    incrbyfloat: jest.Mock;
    get: jest.Mock;
  };

  beforeEach(() => {
    mockRedis = {
      eval: jest.fn(),
      incrbyfloat: jest.fn(),
      get: jest.fn(),
    };
    service = new RedisBudgetGuardService(mockRedis as unknown as Redis);
  });

  it('allows reservation when spend + estimate is within monthly cap', async () => {
    mockRedis.eval.mockResolvedValue([1, '12.50']); // [allowed (1=true), new_spend]

    const result = await service.checkAndReserve('org-123', 0.05, 50.0);
    expect(mockRedis.eval.mock.calls[0][0]).toContain('math.max');
    expect(result.allowed).toBe(true);
    expect(result.reservedAmount).toBe(0.05);
    expect(result.currentSpendUsd).toBe(12.5);
  });

  it('rejects reservation when spend exceeds monthly cap', async () => {
    mockRedis.eval.mockResolvedValue([0, '50.10']);

    const result = await service.checkAndReserve('org-123', 0.05, 50.0);
    expect(result.allowed).toBe(false);
    expect(result.reservedAmount).toBe(0);
  });

  it('reconciles reserved amount with actual provider cost difference', async () => {
    mockRedis.eval.mockResolvedValue('12.48');

    await service.reconcile('org-123', 0.03, 0.05);
    expect(mockRedis.eval).toHaveBeenCalledWith(
      expect.stringContaining('redis.call'),
      1,
      expect.stringContaining('org-123'),
      '-0.02',
    );
  });

  it('fails closed if Redis is not configured for an enabled budget', async () => {
    const unconfiguredService = new RedisBudgetGuardService(null);
    await expect(
      unconfiguredService.checkAndReserve('org-123', 0.05, 50.0),
    ).rejects.toThrow('AI budget enforcement is unavailable');
    await expect(
      unconfiguredService.reconcile('org-123', 0.03, 0.05),
    ).resolves.not.toThrow();
  });

  it('fails closed if Redis throws during checkAndReserve', async () => {
    mockRedis.eval.mockRejectedValue(new Error('Redis connection timeout'));

    await expect(
      service.checkAndReserve('org-123', 0.05, 50.0),
    ).rejects.toThrow('AI budget enforcement is unavailable');
  });

  it('surfaces a reconciliation failure', async () => {
    mockRedis.eval.mockRejectedValue(new Error('Redis connection error'));

    await expect(
      service.reconcile('org-123', 0.03, 0.05),
    ).rejects.toThrow('AI budget reconciliation failed');
  });

  it('skips reconciliation if reservedAmount is 0', async () => {
    await service.reconcile('org-123', 0.03, 0);
    expect(mockRedis.eval).not.toHaveBeenCalled();
  });
});
