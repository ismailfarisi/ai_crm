import { Injectable, Optional } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

@Injectable()
export class ChannelCryptoService {
  private readonly key: Buffer;

  constructor(@Optional() secretKey?: string) {
    const secret =
      secretKey ||
      process.env.APP_SECRET ||
      'default-secret-key-at-least-32-chars-long!';
    this.key = Buffer.from(secret.padEnd(32, '0').slice(0, 32));
  }

  encrypt(data: Record<string, any>): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const jsonStr = JSON.stringify(data);
    let encrypted = cipher.update(jsonStr, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');
    return `${iv.toString('hex')}:${authTag}:${encrypted}`;
  }

  decrypt<T = Record<string, any>>(encryptedStr: string): T {
    const [ivHex, authTagHex, encryptedText] = encryptedStr.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const decipher = createDecipheriv('aes-256-gcm', this.key, iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return JSON.parse(decrypted) as T;
  }
}
