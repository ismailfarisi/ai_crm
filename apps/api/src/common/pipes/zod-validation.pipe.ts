import { BadRequestException, Injectable, type PipeTransform } from '@nestjs/common';
import { ZodError, type ZodType } from 'zod';

/**
 * Validates a body/query against a schema from `@saas/shared`, so the API and
 * the web form enforce exactly the same rules. Field errors come back keyed by
 * path, which is what the frontend forms consume.
 */
@Injectable()
export class ZodValidationPipe<T extends ZodType> implements PipeTransform {
  constructor(private readonly schema: T) {}

  transform(value: unknown): unknown {
    try {
      return this.schema.parse(value);
    } catch (error) {
      if (error instanceof ZodError) {
        const details: Record<string, string[]> = {};
        for (const issue of error.issues) {
          const path = issue.path.join('.') || '_';
          (details[path] ??= []).push(issue.message);
        }

        throw new BadRequestException({
          statusCode: 400,
          error: 'Bad Request',
          message: error.issues[0]?.message ?? 'Validation failed',
          details,
        });
      }
      throw error;
    }
  }
}

/** Sugar so controllers read `@Body(zodBody(createContactSchema))`. */
export const zodBody = <T extends ZodType>(schema: T) => new ZodValidationPipe(schema);
export const zodQuery = <T extends ZodType>(schema: T) => new ZodValidationPipe(schema);
