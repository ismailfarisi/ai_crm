import { createHmac, timingSafeEqual } from 'crypto';
import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AuthenticatedUser } from '@/common/types/authenticated-user';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const USERINFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo';

/** gmail.send for outbound, gmail.modify for sync + read/star/archive labels. */
const SCOPES = [
  'openid',
  'email',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.modify',
];

/** States are self-contained and short-lived — ten minutes to finish consent. */
const STATE_TTL_MS = 10 * 60 * 1000;

export interface GoogleTokens {
  accessToken: string;
  refreshToken: string | null;
  /** Epoch ms at which the access token stops being usable. */
  expiryDate: number;
  scope: string;
  tokenType: string;
}

/**
 * The browser-facing half of the Gmail connection: builds the consent URL
 * and exchanges the returned code. `state` is an HMAC-signed payload naming
 * the CRM user, so the callback endpoint can stay public — a visitor who
 * lands on it without the state Google was given learns nothing and can
 * bind nothing.
 */
@Injectable()
export class GoogleOAuthService {
  constructor(private readonly config: ConfigService) {}

  get isConfigured(): boolean {
    return Boolean(this.clientId && this.clientSecret);
  }

  private get clientId(): string | undefined {
    return this.config.get<string>('google.clientId');
  }

  private get clientSecret(): string | undefined {
    return this.config.get<string>('google.clientSecret');
  }

  get redirectUri(): string {
    const configured = this.config.get<string>('google.redirectUri');
    if (configured) return configured;
    const publicApi = (this.config.get<string>('publicApiUrl') ?? '').replace(
      /\/$/,
      '',
    );
    return `${publicApi}/email/oauth/google/callback`;
  }

  private assertConfigured(): void {
    if (!this.isConfigured) {
      throw new ServiceUnavailableException(
        'Google OAuth is not configured — set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET on the API',
      );
    }
  }

  buildAuthUrl(user: AuthenticatedUser): string {
    this.assertConfigured();
    const url = new URL(AUTH_URL);
    url.searchParams.set('client_id', this.clientId!);
    url.searchParams.set('redirect_uri', this.redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', SCOPES.join(' '));
    url.searchParams.set('access_type', 'offline');
    // Without prompt=consent Google can skip the consent screen for a
    // returning user and withhold the refresh token we depend on.
    url.searchParams.set('prompt', 'consent');
    url.searchParams.set('state', this.signState(user.id, user.organizationId));
    return url.toString();
  }

  private signState(userId: string, organizationId: string): string {
    const payload = Buffer.from(
      JSON.stringify({
        u: userId,
        o: organizationId,
        e: Date.now() + STATE_TTL_MS,
      }),
      'utf8',
    ).toString('base64url');
    const sig = this.hmac(payload);
    return `${payload}.${sig}`;
  }

  verifyState(state: string): { userId: string; organizationId: string } {
    const [payload, sig] = state.split('.');
    if (!payload || !sig) throw new BadRequestException('Invalid OAuth state');
    const expected = this.hmac(payload);
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new BadRequestException('Invalid OAuth state');
    }
    let parsed: { u?: string; o?: string; e?: number };
    try {
      parsed = JSON.parse(
        Buffer.from(payload, 'base64url').toString('utf8'),
      ) as { u?: string; o?: string; e?: number };
    } catch {
      throw new BadRequestException('Invalid OAuth state');
    }
    if (!parsed.u || !parsed.o || !parsed.e || parsed.e < Date.now()) {
      throw new BadRequestException('OAuth state expired — start again');
    }
    return { userId: parsed.u, organizationId: parsed.o };
  }

  private hmac(value: string): string {
    const secret =
      this.config.get<string>('jwt.accessSecret') ??
      process.env.APP_SECRET ??
      'dev-only-secret';
    return createHmac('sha256', secret).update(value).digest('base64url');
  }

  /** Swaps the one-time code for access + refresh tokens. */
  async exchangeCode(code: string): Promise<GoogleTokens> {
    this.assertConfigured();
    const body = new URLSearchParams({
      code,
      client_id: this.clientId!,
      client_secret: this.clientSecret!,
      redirect_uri: this.redirectUri,
      grant_type: 'authorization_code',
    });
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    const json = (await res.json().catch(() => ({}))) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      scope?: string;
      token_type?: string;
      error?: string;
      error_description?: string;
    };
    if (!res.ok) {
      throw new BadRequestException(
        `Google rejected the code: ${json.error_description ?? json.error ?? res.status}`,
      );
    }
    return {
      accessToken: json.access_token ?? '',
      refreshToken: json.refresh_token ?? null,
      expiryDate: Date.now() + Number(json.expires_in ?? 3600) * 1000,
      scope: String(json.scope ?? ''),
      tokenType: String(json.token_type ?? 'Bearer'),
    };
  }

  /** Who did we just connect? `getProfile` also returns the sync cursor. */
  async fetchIdentity(accessToken: string): Promise<{
    emailAddress: string;
    name: string;
    historyId: string | null;
  }> {
    const headers = { Authorization: `Bearer ${accessToken}` };
    const [profileRes, userinfoRes] = await Promise.all([
      fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
        headers,
      }),
      fetch(USERINFO_URL, { headers }),
    ]);
    if (!profileRes.ok) {
      throw new BadRequestException(
        `Could not read the Gmail profile (HTTP ${profileRes.status}) — is the Gmail API enabled on the Google Cloud project?`,
      );
    }
    const profile = (await profileRes.json()) as Record<string, any>;
    const userinfo = userinfoRes.ok
      ? ((await userinfoRes.json()) as Record<string, any>)
      : {};
    return {
      emailAddress: String(profile.emailAddress ?? userinfo.email ?? ''),
      name: String(userinfo.name ?? ''),
      historyId: profile.historyId ? String(profile.historyId) : null,
    };
  }
}
