import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ChannelCryptoService } from '@/modules/channels/services/channel-crypto.service';
import { EmailAccount } from '../entities/email-account.entity';
import type { GoogleTokens } from './google-oauth.service';
import type { GmailMessagePart } from './mime';

const GMAIL_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

/** Refresh a token this close to expiry rather than race it mid-request. */
const EXPIRY_MARGIN_MS = 60_000;

export class GmailApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'GmailApiError';
  }
}

/** Refresh token was revoked or rotated away — the account needs reconnecting. */
export class GmailAuthError extends GmailApiError {}

interface TokenEndpointResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
  error?: string;
}

export interface StoredCredentials {
  accessToken: string;
  refreshToken: string | null;
  expiryDate: number;
  scope?: string;
  tokenType?: string;
}

export interface GmailMessage {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet?: string;
  internalDate?: string;
  payload?: GmailMessagePart;
}

/**
 * Thin REST wrapper over the Gmail API — no googleapis dependency; the calls
 * we need are a handful of GETs and POSTs against users/me/*. Token refresh
 * is transparent: callers hand over an account row and get working requests.
 */
@Injectable()
export class GmailClientService {
  private readonly logger = new Logger(GmailClientService.name);

  constructor(
    @InjectRepository(EmailAccount)
    private readonly accounts: Repository<EmailAccount>,
    private readonly crypto: ChannelCryptoService,
    private readonly config: ConfigService,
  ) {}

  readCredentials(account: EmailAccount): StoredCredentials | null {
    if (!account.encryptedCredentials) return null;
    try {
      return this.crypto.decrypt<StoredCredentials>(
        account.encryptedCredentials,
      );
    } catch {
      return null;
    }
  }

  writeCredentials(account: EmailAccount, creds: StoredCredentials): string {
    return this.crypto.encrypt(creds);
  }

  /** A token that is guaranteed fresh, refreshing and persisting as needed. */
  private async accessToken(account: EmailAccount): Promise<string> {
    const creds = this.readCredentials(account);
    if (!creds?.refreshToken) {
      throw new GmailAuthError(
        401,
        'Stored credentials are missing a refresh token — reconnect the account',
      );
    }
    if (creds.accessToken && creds.expiryDate > Date.now() + EXPIRY_MARGIN_MS) {
      return creds.accessToken;
    }

    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.config.get<string>('google.clientId') ?? '',
        client_secret: this.config.get<string>('google.clientSecret') ?? '',
        refresh_token: creds.refreshToken,
        grant_type: 'refresh_token',
      }),
    });
    const json = (await res.json().catch(() => ({}))) as TokenEndpointResponse;
    if (!res.ok) {
      if (json.error === 'invalid_grant' || res.status === 400) {
        throw new GmailAuthError(
          res.status,
          'Google revoked the grant — reconnect the account',
        );
      }
      throw new GmailApiError(
        res.status,
        `Token refresh failed: ${json.error ?? res.status}`,
      );
    }

    const next: StoredCredentials = {
      accessToken: json.access_token ?? '',
      // Google only returns a refresh token when it rotates; keep the old one.
      refreshToken: json.refresh_token ?? creds.refreshToken,
      expiryDate: Date.now() + Number(json.expires_in ?? 3600) * 1000,
      scope: creds.scope,
      tokenType: creds.tokenType,
    };
    const encrypted = this.writeCredentials(account, next);
    await this.accounts.update(account.id, {
      encryptedCredentials: encrypted,
    });
    account.encryptedCredentials = encrypted;
    return next.accessToken;
  }

  private async request<T>(
    account: EmailAccount,
    method: 'GET' | 'POST',
    path: string,
    opts: {
      params?: Record<string, string | number | string[]>;
      body?: unknown;
    } = {},
  ): Promise<T> {
    const token = await this.accessToken(account);
    const url = new URL(`${GMAIL_BASE}${path}`);
    for (const [key, value] of Object.entries(opts.params ?? {})) {
      if (Array.isArray(value)) {
        value.forEach((v) => url.searchParams.append(key, v));
      } else {
        url.searchParams.set(key, String(value));
      }
    }
    const res = await fetch(url.toString(), {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(opts.body !== undefined
          ? { 'Content-Type': 'application/json' }
          : {}),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new GmailApiError(
        res.status,
        `Gmail ${path}: ${res.status} ${text.slice(0, 300)}`,
      );
    }
    return (await res.json()) as T;
  }

  getProfile(
    account: EmailAccount,
  ): Promise<{ historyId?: string; emailAddress?: string }> {
    return this.request(account, 'GET', '/profile');
  }

  listMessages(
    account: EmailAccount,
    params: { maxResults?: number; pageToken?: string; q?: string } = {},
  ): Promise<{
    messages?: { id: string; threadId: string }[];
    nextPageToken?: string;
  }> {
    return this.request(account, 'GET', '/messages', {
      params: {
        maxResults: params.maxResults ?? 100,
        ...(params.pageToken ? { pageToken: params.pageToken } : {}),
        ...(params.q ? { q: params.q } : {}),
      },
    });
  }

  getMessage(account: EmailAccount, id: string): Promise<GmailMessage> {
    return this.request(account, 'GET', `/messages/${id}`, {
      params: { format: 'full' },
    });
  }

  /** Incremental sync — throws GmailApiError(404) when the cursor expired. */
  listHistory(
    account: EmailAccount,
    startHistoryId: string,
    pageToken?: string,
  ): Promise<{
    history?: {
      id: string;
      messagesAdded?: { message: { id: string; threadId: string } }[];
      messagesDeleted?: { message: { id: string } }[];
      labelsAdded?: { message: { id: string } }[];
      labelsRemoved?: { message: { id: string } }[];
    }[];
    historyId?: string;
    nextPageToken?: string;
  }> {
    return this.request(account, 'GET', '/history', {
      params: {
        startHistoryId,
        historyTypes: [
          'messageAdded',
          'messageDeleted',
          'labelAdded',
          'labelRemoved',
        ],
        ...(pageToken ? { pageToken } : {}),
      },
    });
  }

  sendMessage(
    account: EmailAccount,
    rawBase64Url: string,
    threadId?: string,
  ): Promise<{ id: string; threadId: string }> {
    return this.request(account, 'POST', '/messages/send', {
      body: { raw: rawBase64Url, ...(threadId ? { threadId } : {}) },
    });
  }

  modifyMessage(
    account: EmailAccount,
    id: string,
    addLabelIds: string[],
    removeLabelIds: string[],
  ): Promise<unknown> {
    return this.request(account, 'POST', `/messages/${id}/modify`, {
      body: { addLabelIds, removeLabelIds },
    });
  }

  getAttachment(
    account: EmailAccount,
    messageId: string,
    attachmentId: string,
  ): Promise<{ data: string; size: number }> {
    return this.request(
      account,
      'GET',
      `/messages/${messageId}/attachments/${attachmentId}`,
    );
  }

  /** Push the fresh tokens through without wiping fields callers keep. */
  persistTokens(account: EmailAccount, tokens: GoogleTokens): string {
    const existing = this.readCredentials(account);
    const merged: StoredCredentials = {
      ...tokens,
      refreshToken: tokens.refreshToken ?? existing?.refreshToken ?? null,
    };
    return this.writeCredentials(account, merged);
  }
}
