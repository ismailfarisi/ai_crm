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
import type { ApiErrorBody } from '@saas/shared';

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
        `${request.method} ${request.url} → ${body.statusCode}`,
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

      const record = payload as Record<string, unknown>;
      const message = record.message;

      return {
        statusCode: status,
        message: Array.isArray(message)
          ? message.join(', ')
          : typeof message === 'string'
            ? message
            : exception.message,
        error: typeof record.error === 'string' ? record.error : exception.name,
        details: record.details as Record<string, string[]> | undefined,
      };
    }

    if (exception instanceof QueryFailedError) {
      // 23505 = unique_violation. Anything else is a bug, not user input.
      const code = (exception as QueryFailedError & { code?: string }).code;
      if (code === '23505') {
        return {
          statusCode: HttpStatus.CONFLICT,
          message: 'That record already exists',
          error: 'Conflict',
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
