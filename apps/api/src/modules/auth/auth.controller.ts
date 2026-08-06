import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { CookieOptions, Request, Response } from 'express';
import {
  acceptInviteSchema,
  changePasswordSchema,
  loginSchema,
  registerSchema,
  type AcceptInviteInput,
  type ChangePasswordInput,
  type LoginInput,
  type RegisterInput,
  type SessionDto,
} from '@saas/shared';
import { CurrentUser, Public } from '@/common/decorators';
import { zodBody } from '@/common/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '@/common/types/authenticated-user';
import type { AppConfig } from '@/config/configuration';
import {
  ACCESS_TOKEN_COOKIE,
  REFRESH_COOKIE_PATH_SUFFIX,
  REFRESH_TOKEN_COOKIE,
} from './auth.constants';
import { AuthService } from './auth.service';
import type { IssuedTokens } from './tokens.service';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  @Public()
  @Post('register')
  @Throttle({ auth: { limit: 5, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Create an organization and its first owner account',
  })
  async register(
    @Body(zodBody(registerSchema)) input: RegisterInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SessionDto> {
    const { userId, ...tokens } = await this.auth.register(
      input,
      this.context(req),
    );
    this.setAuthCookies(res, tokens);
    return this.auth.getSessionForUser(userId);
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ auth: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Exchange credentials for session cookies' })
  async login(
    @Body(zodBody(loginSchema)) input: LoginInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SessionDto> {
    const { userId, ...tokens } = await this.auth.login(
      input,
      this.context(req),
    );
    this.setAuthCookies(res, tokens);
    return this.auth.getSessionForUser(userId);
  }

  @Public()
  @Post('accept-invite')
  @HttpCode(HttpStatus.OK)
  @Throttle({ auth: { limit: 10, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Set your password from an email invite and sign in',
  })
  async acceptInvite(
    @Body(zodBody(acceptInviteSchema)) input: AcceptInviteInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SessionDto> {
    const { userId, ...tokens } = await this.auth.acceptInvite(
      input.token,
      input.password,
      this.context(req),
    );
    this.setAuthCookies(res, tokens);
    return this.auth.getSessionForUser(userId);
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @Throttle({ auth: { limit: 10, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Rotate the refresh token and mint a new access token',
  })
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ success: true }> {
    const token = req.cookies?.[REFRESH_TOKEN_COOKIE] as string | undefined;
    if (!token) {
      throw new UnauthorizedException('No refresh token present');
    }

    const tokens = await this.auth.refresh(token, this.context(req));
    this.setAuthCookies(res, tokens);
    return { success: true };
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @Throttle({ auth: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Revoke the current session and clear cookies' })
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ success: true }> {
    await this.auth.logout(
      req.cookies?.[REFRESH_TOKEN_COOKIE] as string | undefined,
    );
    this.clearAuthCookies(res);
    return { success: true };
  }

  @Get('me')
  @ApiOperation({
    summary: 'The signed-in user, their organization and effective permissions',
  })
  async me(@CurrentUser() user: AuthenticatedUser): Promise<SessionDto> {
    return this.auth.getSession(user.id, user.organizationId);
  }

  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Change your own password; signs out every other device',
  })
  async changePassword(
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(changePasswordSchema)) input: ChangePasswordInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ success: true }> {
    await this.auth.changePassword(user.id, input);

    // The caller stays signed in — re-issue against the new credentials stamp.
    const tokens = await this.auth.reissueForUser(user.id, this.context(req));
    this.setAuthCookies(res, tokens);
    return { success: true };
  }

  // ─── Cookies ────────────────────────────────────────────────────────────────

  private setAuthCookies(res: Response, tokens: IssuedTokens): void {
    res.cookie(ACCESS_TOKEN_COOKIE, tokens.accessToken, {
      ...this.cookieOptions(),
      maxAge: tokens.accessExpiresIn * 1000,
    });
    // The refresh cookie is scoped to auth routes only, so it is never sent on
    // ordinary API calls. That shrinks the CSRF surface to just the auth
    // endpoints, which are the ones already protected by the auth throttler.
    res.cookie(REFRESH_TOKEN_COOKIE, tokens.refreshToken, {
      ...this.cookieOptions(),
      path: this.refreshCookiePath(),
      maxAge: tokens.refreshExpiresIn * 1000,
    });
  }

  private clearAuthCookies(res: Response): void {
    const options = this.cookieOptions();
    res.clearCookie(ACCESS_TOKEN_COOKIE, options);
    res.clearCookie(REFRESH_TOKEN_COOKIE, {
      ...options,
      path: this.refreshCookiePath(),
    });
  }

  private refreshCookiePath(): string {
    const prefix = this.config.get('apiPrefix', { infer: true });
    return `${prefix}${REFRESH_COOKIE_PATH_SUFFIX}`;
  }

  private cookieOptions(): CookieOptions {
    const cookies = this.config.get('cookies', { infer: true });
    return {
      httpOnly: true,
      secure: cookies.secure,
      sameSite: cookies.sameSite,
      domain: cookies.domain,
      path: '/',
    };
  }

  private context(req: Request) {
    return {
      userAgent: req.headers['user-agent'],
      ipAddress: req.ip,
    };
  }
}
