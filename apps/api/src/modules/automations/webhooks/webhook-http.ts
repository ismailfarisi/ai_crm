import {
  PayloadTooLargeException,
  type INestApplication,
} from '@nestjs/common';
import type {
  CorsOptions,
  CorsOptionsDelegate,
} from '@nestjs/common/interfaces/external/cors-options.interface';
import type { NextFunction, Request, Response } from 'express';

/** 100 KB: the largest webhook body accepted. */
export const WEBHOOK_BODY_LIMIT_BYTES = 100 * 1024;

/**
 * Webhook senders are other people's websites and tools, so this one route
 * answers any origin. No credentials: the token in the path is the only
 * credential, and the API's auth cookies must never ride along.
 */
const WEBHOOK_CORS: CorsOptions = {
  origin: '*',
  credentials: false,
  methods: ['POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Idempotency-Key', 'X-Kerf-Signature'],
};

/**
 * Installs the API's CORS policy and the webhook route's body handling. Must
 * be called before the app initialises: the reader has to run before Nest's
 * global JSON/form parsers, which would otherwise reject a JSON scalar body,
 * and the CORS handler has to answer the webhook route's preflight before the
 * global policy refuses it.
 *
 * @param prefix the global route prefix, e.g. `api/v1`
 * @param cors the policy for every other route
 */
export function configureCorsAndWebhookBodies(
  app: INestApplication,
  prefix: string,
  cors: CorsOptions,
): void {
  const base = `/${prefix.replace(/^\/+|\/+$/g, '')}/automations/webhook`;
  const isWebhook = (req: Request): boolean =>
    (req.originalUrl ?? req.url).split('?')[0].startsWith(`${base}/`);

  const delegate: CorsOptionsDelegate<Request> = (req, callback) =>
    callback(null, isWebhook(req) ? WEBHOOK_CORS : cors);
  app.enableCors(delegate);
  app.use(base, readWebhookBody(WEBHOOK_BODY_LIMIT_BYTES));
}

/**
 * Reads a POST body as raw bytes into `req.rawBody`, refusing more than
 * `limit` bytes with 413. Once the stream has been consumed Nest's global
 * parsers skip the request, so the webhook service sees exactly what was sent.
 */
export function readWebhookBody(limit: number) {
  return (
    req: Request & { rawBody?: Buffer },
    _res: Response,
    next: NextFunction,
  ): void => {
    if (req.method !== 'POST') return next();

    const chunks: Buffer[] = [];
    let size = 0;
    let tooLarge = Number(req.headers['content-length']) > limit;
    let done = false;
    const finish = (err?: unknown) => {
      if (done) return;
      done = true;
      next(err);
    };

    // Past the limit the rest is still read and dropped, so the 413 reaches
    // a client that is still sending.
    req.on('data', (chunk: Buffer) => {
      if (tooLarge) return;
      size += chunk.length;
      if (size > limit) {
        tooLarge = true;
        chunks.length = 0;
        return;
      }
      chunks.push(chunk);
    });
    req.once('end', () => {
      if (tooLarge) {
        return finish(
          new PayloadTooLargeException('The body is larger than 100 KB'),
        );
      }
      req.rawBody = Buffer.concat(chunks);
      finish();
    });
    req.once('error', finish);
  };
}
