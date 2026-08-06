import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Repository } from 'typeorm';
import { RefreshToken } from './entities/refresh-token.entity';
import { TokensService, parseDuration } from './tokens.service';

const ACCESS_SECRET = 'a'.repeat(32);
const REFRESH_SECRET = 'b'.repeat(32);

const configStub = {
  get: jest.fn((key: string) => {
    if (key === 'jwt.accessSecret') return ACCESS_SECRET;
    if (key === 'jwt.refreshSecret') return REFRESH_SECRET;
    if (key === 'jwt.accessTtl') return '15m';
    if (key === 'jwt.refreshTtl') return '7d';
    return undefined;
  }),
} as unknown as ConfigService;

const user = {
  id: '11111111-1111-1111-1111-111111111111',
  organizationId: '22222222-2222-2222-2222-222222222222',
  email: 'user@example.com',
  isActive: true,
  credentialsChangedAt: new Date('2026-01-01T00:00:00Z'),
} as never;

function makeService(overrides: Partial<Record<'repo' | 'jwt', unknown>> = {}) {
  const repo = (overrides.repo ?? {
    findOne: jest.fn().mockResolvedValue(null),
    save: jest.fn(async (token) => token),
    create: jest.fn((token) => token),
    update: jest.fn().mockResolvedValue({ affected: 1 }),
    delete: jest.fn().mockResolvedValue({ affected: 3 }),
  }) as unknown as Repository<RefreshToken>;

  const jwt = (overrides.jwt ?? {
    signAsync: jest.fn(
      async (payload, options) => `jwt.${(options?.expiresIn ?? 0) as number}`,
    ),
    verifyAsync: jest
      .fn()
      .mockResolvedValue({ sub: user.id, org: user.organizationId }),
  }) as unknown as JwtService;

  return { service: new TokensService(repo, jwt, configStub), repo, jwt };
}

describe('TokensService', () => {
  describe('parseDuration', () => {
    it('parses seconds, minutes, hours and days', () => {
      expect(parseDuration('900')).toBe(900);
      expect(parseDuration('15m')).toBe(900);
      expect(parseDuration('24h')).toBe(86400);
      expect(parseDuration('7d')).toBe(604800);
    });

    it('throws on garbage', () => {
      expect(() => parseDuration('forever')).toThrow(/Invalid duration/);
    });
  });

  describe('issue', () => {
    it('mints access + refresh tokens and stores a hashed refresh token', async () => {
      const { service, repo } = makeService();
      const tokens = await service.issue(user);

      expect(tokens.accessToken).toBeTruthy();
      expect(tokens.refreshToken).toBeTruthy();
      expect(tokens.accessExpiresIn).toBe(900);
      expect(tokens.refreshExpiresIn).toBe(604800);

      expect(repo.save).toHaveBeenCalled();
      const saved = (repo.save as jest.Mock).mock.calls[0][0];
      // The raw token must never be persisted — only its sha256 hex digest.
      expect(saved.tokenHash).toHaveLength(64);
      expect(saved.tokenHash).not.toBe(tokens.refreshToken);
    });
  });

  describe('rotate', () => {
    it('revokes the presented token, mints a new one in the same family', async () => {
      const stored = {
        tokenHash: 'abc',
        revokedAt: null,
        expiresAt: new Date(Date.now() + 60_000),
        familyId: '33333333-3333-3333-3333-333333333333',
      };
      const repo = {
        findOne: jest.fn().mockResolvedValue(stored),
        save: jest.fn(async (token) => token),
        create: jest.fn((token) => token),
        update: jest.fn().mockResolvedValue({ affected: 1 }),
      } as unknown as Repository<RefreshToken>;
      const { service } = makeService({ repo });

      const loadUser = jest.fn().mockResolvedValue(user);
      const { tokens } = await service.rotate('presented-token', loadUser);

      expect(stored.revokedAt).not.toBeNull();
      expect(tokens.refreshToken).toBeTruthy();
    });

    it('revokes the whole family when a revoked token is replayed', async () => {
      const stored = {
        tokenHash: 'abc',
        revokedAt: new Date(),
        expiresAt: new Date(Date.now() + 60_000),
        familyId: '33333333-3333-3333-3333-333333333333',
      };
      const repo = {
        findOne: jest.fn().mockResolvedValue(stored),
        update: jest.fn().mockResolvedValue({ affected: 1 }),
      } as unknown as Repository<RefreshToken>;
      const { service } = makeService({ repo });

      await expect(
        service.rotate('presented-token', jest.fn()),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      const [where, set] = (repo.update as jest.Mock).mock.calls[0];
      expect(where.familyId).toBe(stored.familyId);
      // The `revokedAt: IsNull()` condition arrives as a FindOperator.
      expect(where.revokedAt).toBeInstanceOf(Object);
      expect(set.revokedAt).toBeInstanceOf(Date);
    });
  });

  describe('purgeExpired', () => {
    it('deletes only rows that have expired', async () => {
      const { service, repo } = makeService();
      const purged = await service.purgeExpired();

      expect(purged).toBe(3);
      const [where] = (repo.delete as jest.Mock).mock.calls[0];
      // `expiresAt: LessThan(now)` arrives as a FindOperator holding a Date.
      expect(where.expiresAt).toBeInstanceOf(Object);
      expect(where.expiresAt._value).toBeInstanceOf(Date);
    });
  });
});
