import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '@/config/configuration';
import { LocalStorageDriver } from './drivers/local-storage.driver';
import { S3StorageDriver } from './drivers/s3-storage.driver';
import type { StorageDriver, StoredObject } from './storage.types';

/**
 * Where attachment bytes live, and how a browser is allowed to reach them.
 *
 * Downloads are always short-lived signed URLs, whichever driver is in use:
 * S3 signs its own, and the local driver gets an API URL signed here. Serving
 * an attachment from a long-lived, guessable path would make every file in the
 * system readable by anyone who saw one link.
 */
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly driver: StorageDriver;
  private readonly ttl: number;
  private readonly secret: string;
  private readonly apiUrl: string;

  constructor(private readonly config: ConfigService<AppConfig, true>) {
    const storage = this.config.get('storage', { infer: true });
    this.ttl = storage.urlTtlSeconds;
    this.secret = storage.signingSecret;
    this.apiUrl = this.config.get('publicApiUrl', { infer: true });
    this.driver =
      storage.provider === 's3'
        ? new S3StorageDriver(storage.bucket!, storage.region)
        : new LocalStorageDriver(storage.localDir);
    this.logger.log(`Attachments stored via ${this.driver.name}`);
  }

  get providerName(): string {
    return this.driver.name;
  }

  /**
   * Keys are tenant-prefixed and random. The filename is deliberately not part
   * of the key: two people uploading `artwork.pdf` to the same quote must not
   * collide, and a key should not leak what a document is called.
   */
  keyFor(tenantId: string, ownerType: string, ownerId: string): string {
    return `${tenantId}/${ownerType.toLowerCase()}/${ownerId}/${randomUUID()}`;
  }

  put(key: string, body: Buffer, contentType: string): Promise<void> {
    return this.driver.put(key, body, contentType);
  }

  get(key: string): Promise<StoredObject> {
    return this.driver.get(key);
  }

  async delete(key: string): Promise<void> {
    try {
      await this.driver.delete(key);
    } catch (error) {
      // The row is already gone; an orphaned object is a cleanup job, not a
      // failed request.
      this.logger.warn(
        `Could not remove stored object ${key}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /** A URL good for `ttl` seconds, and the moment it stops working. */
  async linkFor(
    attachmentId: string,
    key: string,
    filename: string,
  ): Promise<{ url: string; expiresAt: Date }> {
    const expiresAt = new Date(Date.now() + this.ttl * 1000);
    const signed = await this.driver.signedUrl(key, filename, this.ttl);
    if (signed) return { url: signed, expiresAt };
    const expires = Math.floor(expiresAt.getTime() / 1000);
    const token = this.sign(attachmentId, expires);
    return {
      url: `${this.apiUrl}/attachments/${attachmentId}/download?expires=${expires}&token=${token}`,
      expiresAt,
    };
  }

  /** Throws unless the token matches this attachment and has not expired. */
  verifyLink(attachmentId: string, expires: number, token: string): void {
    const expected = Buffer.from(this.sign(attachmentId, expires));
    const given = Buffer.from(token);
    const matches =
      expected.length === given.length && timingSafeEqual(expected, given);
    if (!matches || expires * 1000 < Date.now()) {
      throw new UnauthorizedException('This download link has expired');
    }
  }

  private sign(attachmentId: string, expires: number): string {
    return createHmac('sha256', this.secret)
      .update(`${attachmentId}.${expires}`)
      .digest('hex');
  }
}
