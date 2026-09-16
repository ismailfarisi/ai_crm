import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { StorageService } from './storage.service';

const configFor = (overrides: Record<string, unknown> = {}) =>
  ({
    get: (key: string) =>
      key === 'publicApiUrl'
        ? 'https://api.test/api/v1'
        : {
            provider: 'local',
            localDir: './storage-test',
            urlTtlSeconds: 300,
            signingSecret: 'a'.repeat(48),
            ...overrides,
          },
  }) as unknown as ConfigService<never, true>;

describe('StorageService links', () => {
  const service = new StorageService(configFor());

  it('keys are tenant-scoped and do not carry the filename', () => {
    const key = service.keyFor('org1', 'QUOTE', 'q1');
    expect(key).toMatch(/^org1\/quote\/q1\/[0-9a-f-]{36}$/);
  });

  it('signs a link the download route accepts', async () => {
    const { url, expiresAt } = await service.linkFor('a1', 'key', 'art.pdf');
    const params = new URL(url).searchParams;
    expect(url).toContain('https://api.test/api/v1/attachments/a1/download');
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(() =>
      service.verifyLink(
        'a1',
        Number(params.get('expires')),
        params.get('token')!,
      ),
    ).not.toThrow();
  });

  it('refuses a token minted for another attachment', async () => {
    const { url } = await service.linkFor('a1', 'key', 'art.pdf');
    const params = new URL(url).searchParams;
    expect(() =>
      service.verifyLink(
        'a2',
        Number(params.get('expires')),
        params.get('token')!,
      ),
    ).toThrow(UnauthorizedException);
  });

  it('refuses an expired link', () => {
    const past = Math.floor(Date.now() / 1000) - 10;
    // Sign the past timestamp the way the service would, then present it.
    const service2 = new StorageService(configFor());
    const token = (
      service2 as unknown as { sign: (id: string, exp: number) => string }
    ).sign('a1', past);
    expect(() => service2.verifyLink('a1', past, token)).toThrow(
      UnauthorizedException,
    );
  });

  it('refuses a tampered token without leaking length', () => {
    expect(() => service.verifyLink('a1', 9999999999, 'nope')).toThrow(
      UnauthorizedException,
    );
  });
});
