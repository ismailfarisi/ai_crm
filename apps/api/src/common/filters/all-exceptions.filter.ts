import {
  ArgumentsHost,
  Catch,
  HttpException,
  HttpStatus,
  Logger,
  type ExceptionFilter,
} from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import type { Request, Response } from 'express';
import { PERIOD_LOCKED_SQLSTATE, type ApiErrorBody } from '@saas/shared';

/** An automation webhook's token is its only credential: never log it. */
const WEBHOOK_TOKEN_IN_URL =
  /(\/automations\/webhook\/)[A-Za-z0-9_-]{43}(?![A-Za-z0-9_-])/g;

export function maskSecretsInUrl(url: string): string {
  return url.replace(WEBHOOK_TOKEN_IN_URL, '$1***');
}

/**
 * One error shape for the whole API. Unexpected errors are logged with a stack
 * but answered with a generic message — no internals leak to the client.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const body = this.toBody(exception);

    if (body.statusCode >= 500) {
      this.logger.error(
        `${request.method} ${maskSecretsInUrl(request.url)} → ${body.statusCode}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    response.status(body.statusCode).json(body);
  }

  private toBody(exception: unknown): ApiErrorBody {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const payload = exception.getResponse();

      if (typeof payload === 'string') {
        return { statusCode: status, message: payload, error: exception.name };
      }

      const { message, error, details, ...extra } = payload as Record<
        string,
        unknown
      >;
      delete extra.statusCode;

      return {
        statusCode: status,
        message: Array.isArray(message)
          ? message.join(', ')
          : typeof message === 'string'
            ? message
            : exception.message,
        error: typeof error === 'string' ? error : exception.name,
        details: details as Record<string, string[]> | undefined,
        // A 4xx may carry what the client needs to explain it (who decided an
        // approval first, which rules a quote breaks). A 5xx never does.
        // Every extra field of a 4xx HttpException body is client-visible:
        // throw sites must not put internal data (ids of other tenants,
        // queries, stack details) in them.
        ...(status < 500 ? extra : {}),
      };
    }

    if (exception instanceof QueryFailedError) {
      // 23505 = unique_violation; KB001 = the period-lock trigger, whose
      // message is written for the user. Anything else is a bug.
      const code = (exception as QueryFailedError & { code?: string }).code;
      if (code === '23505') {
        return {
          statusCode: HttpStatus.CONFLICT,
          message: 'That record already exists',
          error: 'Conflict',
        };
      }
      if (code === PERIOD_LOCKED_SQLSTATE) {
        return {
          statusCode: HttpStatus.CONFLICT,
          message: exception.message,
          error: 'PeriodLocked',
        };
      }
    }

    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Something went wrong. Please try again.',
      error: 'Internal Server Error',
    };
  }
}
