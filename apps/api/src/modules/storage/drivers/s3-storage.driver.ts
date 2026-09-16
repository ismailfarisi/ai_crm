import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Injectable, NotFoundException } from '@nestjs/common';
import type { StorageDriver, StoredObject } from '../storage.types';

/**
 * Objects in a bucket, following the shape `MAIL_PROVIDER=console|ses` already
 * set: credentials come from the SDK's default chain — environment, profile,
 * instance role — never from our own `.env`.
 *
 * Downloads are presigned by S3 itself, so the bytes never pass through the
 * API and the bucket can stay private.
 */
@Injectable()
export class S3StorageDriver implements StorageDriver {
  readonly name = 's3' as const;
  private readonly client: S3Client;

  constructor(
    private readonly bucket: string,
    region: string | undefined,
  ) {
    this.client = new S3Client(region ? { region } : {});
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
  }

  async get(key: string): Promise<StoredObject> {
    try {
      const result = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      const body = Buffer.from(await result.Body!.transformToByteArray());
      return {
        body,
        contentType: result.ContentType ?? 'application/octet-stream',
      };
    } catch {
      throw new NotFoundException('File not found');
    }
  }

  async delete(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
    );
  }

  async signedUrl(
    key: string,
    filename: string,
    ttlSeconds: number,
  ): Promise<string | null> {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        // The stored key is a uuid; the browser should still save it under the
        // name the person uploaded.
        ResponseContentDisposition: `attachment; filename="${filename.replace(/"/g, '')}"`,
      }),
      { expiresIn: ttlSeconds },
    );
  }
}
