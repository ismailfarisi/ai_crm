import { BadRequestException, Injectable } from '@nestjs/common';
import { buildDynamicRecordSchema, type CustomAttributeDefinitionDto } from '@saas/shared';
import type { CustomAttributeDefinition } from '../entities/custom-attribute-definition.entity';

@Injectable()
export class RecordValidationService {
  validate(
    attributes: (CustomAttributeDefinitionDto | CustomAttributeDefinition)[],
    values: Record<string, any>,
  ): Record<string, any> {
    const schema = buildDynamicRecordSchema(attributes as CustomAttributeDefinitionDto[]);
    const result = schema.safeParse(values ?? {});
    if (!result.success) {
      throw new BadRequestException({
        message: 'Invalid record values',
        errors: result.error.flatten().fieldErrors,
      });
    }
    return result.data;
  }
}
