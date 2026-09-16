import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { Injectable, NotFoundException } from '@nestjs/common';
import type { StorageDriver, StoredObject } from '../storage.types';

/**
 * Files on the API's own disk. The default, so a checkout runs with no cloud
 * account, and the right answer for a single-box deployment with a volume.
 *
 * It cannot sign its own URLs, so downloads go back through the API — see
 * `StorageService.linkFor`.
 */
@Injectable()
export class LocalStorageDriver implements StorageDriver {
  readonly name = 'local' as const;

  constructor(private readonly root: string) {}

  /**
   * Keys are built by this service, but a path is still resolved and checked
   * against the root before anything is read or written: one traversal bug
   * upstream should not become an arbitrary file read.
   */
  private pathFor(key: string): string {
    const full = resolve(this.root, key);
    const base = resolve(this.root);
    if (full !== base && !full.startsWith(base + sep)) {
      throw new NotFoundException('File not found');
    }
    return full;
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    const path = this.pathFor(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body);
    // Beside the object, so a download served straight from disk still knows
    // what it is without reading the database.
    await writeFile(`${path}.type`, contentType, 'utf8');
  }

  async get(key: string): Promise<StoredObject> {
    const path = this.pathFor(key);
    try {
      const [body, type] = await Promise.all([
        readFile(path),
        readFile(`${path}.type`, 'utf8').catch(
          () => 'application/octet-stream',
        ),
      ]);
      return { body, contentType: type };
    } catch {
      throw new NotFoundException('File not found');
    }
  }

  async delete(key: string): Promise<void> {
    const path = this.pathFor(key);
    await rm(path, { force: true });
    await rm(`${path}.type`, { force: true });
  }

  signedUrl(): Promise<string | null> {
    // Nothing to sign against: the service signs an API URL instead.
    return Promise.resolve(null);
  }

  /** Where a key would live, for diagnostics. */
  locate(key: string): string {
    return join(this.root, key);
  }
}

export const checksumOf = (body: Buffer): string =>
  createHash('sha256').update(body).digest('hex');
