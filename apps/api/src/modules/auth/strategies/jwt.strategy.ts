import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import {
  ExtractJwt,
  Strategy,
  type StrategyOptionsWithoutRequest,
} from 'passport-jwt';
import type { Request } from 'express';
import type { AppConfig } from '@/config/configuration';
import type { AuthenticatedUser } from '@/common/types/authenticated-user';
import { RbacService } from '@/modules/rbac/rbac.service';
import { UsersService } from '@/modules/users/users.service';
import { ACCESS_TOKEN_COOKIE } from '../auth.constants';
import type { AccessTokenPayload } from '../tokens.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    config: ConfigService<AppConfig, true>,
    private readonly users: UsersService,
    private readonly rbac: RbacService,
  ) {
    super({
      // The browser uses an httpOnly cookie; the Authorization header is kept
      // for server-to-server callers and API tooling.
      jwtFromRequest: ExtractJwt.fromExtractors([
        (req: Request) =>
          (req.cookies?.[ACCESS_TOKEN_COOKIE] as string | undefined) ?? null,
        ExtractJwt.fromAuthHeaderAsBearerToken(),
      ]),
      ignoreExpiration: false,
      secretOrKey: config.get('jwt.accessSecret', { infer: true }),
    } satisfies StrategyOptionsWithoutRequest);
  }

  /**
   * Permissions are deliberately NOT read from the token. They are resolved from
   * the database (behind a 5s cache) so a revoked role stops working right away.
   */
  async validate(payload: AccessTokenPayload): Promise<AuthenticatedUser> {
    const user = await this.users.findByIdForAuth(payload.sub);

    if (!user || !user.isActive) {
      throw new UnauthorizedException(
        'Account is inactive or no longer exists',
      );
    }
    if (user.organizationId !== payload.org) {
      throw new UnauthorizedException(
        'Token does not match the account organization',
      );
    }

    // Password change / forced logout invalidates every token minted before it.
    const credentialsChangedAt = Math.floor(
      new Date(user.credentialsChangedAt).getTime() / 1000,
    );
    if (payload.cav < credentialsChangedAt) {
      throw new UnauthorizedException('Session expired, please sign in again');
    }

    const access = await this.rbac.resolveAccess(user.id, user.organizationId);

    return {
      id: user.id,
      organizationId: user.organizationId,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      roles: access.roles,
      level: access.level,
      permissions: access.permissions,
      isOwner: access.isOwner,
      teamId: user.teamId ?? null,
      managerId: user.managerId ?? null,
    };
  }
}
