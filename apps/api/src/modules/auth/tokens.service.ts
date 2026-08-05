import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, LessThan, Repository } from 'typeorm';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { AppConfig } from '@/config/configuration';
import { User } from '@/modules/users/entities/user.entity';
import { RefreshToken } from './entities/refresh-token.entity';

export interface AccessTokenPayload {
  sub: string;
  org: string;
  email: string;
  /** Seconds-precision copy of `user.credentialsChangedAt`, checked on every request. */
  cav: number;
}

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  accessExpiresIn: number;
  refreshExpiresIn: number;
}

interface TokenContext {
  userAgent?: string;
  ipAddress?: string;
}

@Injectable()
export class TokensService {
  constructor(
    @InjectRepository(RefreshToken) private readonly refreshTokens: Repository<RefreshToken>,
    private readonly jwt: JwtService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  /** Fresh login — starts a new refresh-token family. */
  async issue(user: User, context: TokenContext = {}): Promise<IssuedTokens> {
    return this.mint(user, randomUUID(), context);
  }

  /**
   * Rotates a refresh token. Presenting an already-rotated token means the
   * cookie leaked, so we kill every token in that family and force a re-login.
   */
  async rotate(
    presentedToken: string,
    loadUser: (userId: string) => Promise<User | null>,
    context: TokenContext = {},
  ): Promise<{ tokens: IssuedTokens; user: User }> {
    const payload = await this.verifyRefreshJwt(presentedToken);
    const stored = await this.refreshTokens.findOne({
      where: { tokenHash: this.hash(presentedToken) },
    });

    if (!stored) {
      throw new UnauthorizedException('Refresh token is not recognised');
    }

    if (stored.revokedAt) {
      await this.revokeFamily(stored.familyId);
      throw new UnauthorizedException('Refresh token was already used — all sessions revoked');
    }

    if (stored.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException('Refresh token has expired');
    }

    const user = await loadUser(payload.sub);
    if (!user || !user.isActive) {
      await this.revokeFamily(stored.familyId);
      throw new UnauthorizedException('Account is no longer active');
    }

    stored.revokedAt = new Date();
    await this.refreshTokens.save(stored);

    const tokens = await this.mint(user, stored.familyId, context);
    return { tokens, user };
  }

  async revokeByToken(presentedToken: string): Promise<void> {
    const stored = await this.refreshTokens.findOne({
      where: { tokenHash: this.hash(presentedToken) },
    });
    if (stored) {
      await this.revokeFamily(stored.familyId);
    }
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await this.refreshTokens.update({ userId, revokedAt: IsNull() }, { revokedAt: new Date() });
  }

  async purgeExpired(): Promise<number> {
    const result = await this.refreshTokens.delete({ expiresAt: LessThan(new Date()) });
    return result.affected ?? 0;
  }

  ttlSeconds(kind: 'access' | 'refresh'): number {
    const raw =
      kind === 'access' ? this.config.get('jwt.accessTtl', { infer: true }) : this.config.get('jwt.refreshTtl', { infer: true });
    return parseDuration(raw);
  }

  private async mint(user: User, familyId: string, context: TokenContext): Promise<IssuedTokens> {
    const payload: AccessTokenPayload = {
      sub: user.id,
      org: user.organizationId,
      email: user.email,
      cav: Math.floor(new Date(user.credentialsChangedAt).getTime() / 1000),
    };

    const accessExpiresIn = this.ttlSeconds('access');
    const refreshExpiresIn = this.ttlSeconds('refresh');

    const accessToken = await this.jwt.signAsync(payload, {
      secret: this.config.get('jwt.accessSecret', { infer: true }),
      expiresIn: accessExpiresIn,
    });

    // A random jti keeps two refresh tokens minted in the same second distinct.
    const refreshToken = await this.jwt.signAsync(
      { sub: user.id, org: user.organizationId, jti: randomBytes(16).toString('hex') },
      {
        secret: this.config.get('jwt.refreshSecret', { infer: true }),
        expiresIn: refreshExpiresIn,
      },
    );

    await this.refreshTokens.save(
      this.refreshTokens.create({
        userId: user.id,
        familyId,
        tokenHash: this.hash(refreshToken),
        expiresAt: new Date(Date.now() + refreshExpiresIn * 1000),
        userAgent: context.userAgent?.slice(0, 255) ?? null,
        ipAddress: context.ipAddress?.slice(0, 64) ?? null,
      }),
    );

    return { accessToken, refreshToken, accessExpiresIn, refreshExpiresIn };
  }

  private async verifyRefreshJwt(token: string): Promise<{ sub: string; org: string }> {
    try {
      return await this.jwt.verifyAsync<{ sub: string; org: string }>(token, {
        secret: this.config.get('jwt.refreshSecret', { infer: true }),
      });
    } catch {
      throw new UnauthorizedException('Refresh token is invalid or expired');
    }
  }

  private async revokeFamily(familyId: string): Promise<void> {
    await this.refreshTokens.update({ familyId, revokedAt: IsNull() }, { revokedAt: new Date() });
  }

  private hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}

/** Turns `15m` / `7d` / `900` into seconds. */
export function parseDuration(value: string): number {
  const match = /^(\d+)\s*([smhd])?$/.exec(value.trim());
  if (!match) {
    throw new Error(`Invalid duration: "${value}". Use formats like 900, 15m, 24h or 7d.`);
  }
  const amount = Number(match[1]);
  const multiplier = { s: 1, m: 60, h: 3600, d: 86400 }[match[2] ?? 's'] ?? 1;
  return amount * multiplier;
}
