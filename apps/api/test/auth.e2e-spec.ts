import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { App } from 'supertest/types';
import { ConfigService } from '@nestjs/config';
import cookieParser from 'cookie-parser';
import type { AppConfig } from '../src/config/configuration';
import { AppModule } from './../src/app.module';

/**
 * End-to-end auth flow against a real Postgres (the `crm_test` database, created
 * by `test/global-setup.ts`). Covers the cookie-based session lifecycle:
 * register → me → refresh rotation → logout.
 */
describe('Auth (e2e)', () => {
  let app: INestApplication<App>;

  const TIMEOUT = 30_000;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication<NestExpressApplication>();
    // Mirror main.ts so the global prefix, cookies and proxy handling behave
    // exactly like production.
    const config = app.get(ConfigService<AppConfig, true>);
    app.setGlobalPrefix(config.get('apiPrefix', { infer: true }));
    app.use(cookieParser());
    app.set('trust proxy', 1);
    await app.init();
  }, TIMEOUT);

  afterAll(async () => {
    await app.close();
  }, TIMEOUT);

  function cookies(res: request.Response): Record<string, string> {
    const header = res.headers['set-cookie'] as unknown as string[] | undefined;
    if (!header) return {};
    return Object.fromEntries(
      header.map((cookie) => {
        const [pair] = cookie.split(';');
        const idx = pair.indexOf('=');
        return [pair.slice(0, idx), pair.slice(idx + 1)];
      }),
    );
  }

  it(
    'registers, reads the session, rotates the refresh token, and logs out',
    async () => {
      const email = `e2e-${Date.now()}@example.com`;

      // 1. Register → session cookies
      const register = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({
          organizationName: 'E2E Org',
          firstName: 'E2E',
          lastName: 'User',
          email,
          password: 'Password123!',
        })
        .expect(201);

      const jar = cookies(register);
      expect(jar.crm_access_token).toBeTruthy();
      expect(jar.crm_refresh_token).toBeTruthy();

      // 2. /auth/me with the access cookie
      await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Cookie', [`crm_access_token=${jar.crm_access_token}`])
        .expect(200)
        .expect((res) => {
          expect(res.body.user.email).toBe(email);
        });

      // 3. Refresh rotates the refresh token
      const refresh = await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .set('Cookie', [`crm_refresh_token=${jar.crm_refresh_token}`])
        .expect(200);
      const rotated = cookies(refresh);
      expect(rotated.crm_refresh_token).toBeTruthy();
      expect(rotated.crm_refresh_token).not.toBe(jar.crm_refresh_token);

      // 4. The old refresh token is now dead (rotation + family revocation)
      await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .set('Cookie', [`crm_refresh_token=${jar.crm_refresh_token}`])
        .expect(401);

      // 5. Logout revokes the family; the rotated token no longer works
      await request(app.getHttpServer())
        .post('/api/v1/auth/logout')
        .set('Cookie', [`crm_refresh_token=${rotated.crm_refresh_token}`])
        .expect(200);
      await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .set('Cookie', [`crm_refresh_token=${rotated.crm_refresh_token}`])
        .expect(401);
    },
    TIMEOUT,
  );

  it(
    'rejects a wrong password without leaking whether the email exists',
    async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: 'ghost@example.com', password: 'WrongPass123!' })
        .expect(401);
    },
    TIMEOUT,
  );
});
