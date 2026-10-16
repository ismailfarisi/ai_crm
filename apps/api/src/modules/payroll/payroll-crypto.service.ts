import { Injectable, Logger } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const DEV_KEY = Buffer.alloc(32, 1); // never used in production

/** AES-256-GCM for employee bank details. Output: base64(iv[12] | tag[16] | data). */
@Injectable()
export class PayrollCryptoService {
  private readonly logger = new Logger(PayrollCryptoService.name);
  private readonly key: Buffer;

  constructor(env: NodeJS.ProcessEnv = process.env) {
    this.key = PayrollCryptoService.keyFromEnv(env, this.logger);
  }

  static keyFromEnv(env: NodeJS.ProcessEnv, logger?: Logger): Buffer {
    const raw = env.PAYROLL_DATA_KEY;
    if (!raw) {
      if (env.NODE_ENV === 'production') {
        throw new Error('PAYROLL_DATA_KEY is required in production (32 bytes, base64). Employee bank details are encrypted with it.');
      }
      logger?.warn('PAYROLL_DATA_KEY not set; using a development key. Never run production like this.');
      return DEV_KEY;
    }
    const key = Buffer.from(raw, 'base64');
    if (key.length !== 32) throw new Error('PAYROLL_DATA_KEY must decode to 32 bytes (base64).');
    return key;
  }

  encrypt(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64');
  }

  decrypt(payload: string): string {
    const buf = Buffer.from(payload, 'base64');
    const decipher = createDecipheriv('aes-256-gcm', this.key, buf.subarray(0, 12));
    decipher.setAuthTag(buf.subarray(12, 28));
    return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString('utf8');
  }
}
