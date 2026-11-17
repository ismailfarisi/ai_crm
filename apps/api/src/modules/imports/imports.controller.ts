import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import {
  IMPORT_LIMITS,
  PERMISSIONS,
  importOptionsSchema,
  isImportEntity,
  type ImportEntity,
  type ImportOptionsPayload,
  type ImportPreviewDto,
  type ImportRunDto,
} from '@saas/shared';
import { CurrentUser, RequireAnyPermission } from '@/common/decorators';
import type { AuthenticatedUser } from '@/common/types/authenticated-user';
import type { UploadedFileLike } from '../storage/storage.types';
import { ImportsService } from './imports.service';

/** Anyone who can create one of the importable records. The service checks the exact one. */
const CAN_IMPORT = [
  PERMISSIONS.CUSTOMER_CREATE,
  PERMISSIONS.CONTACT_CREATE,
  PERMISSIONS.CATALOG_MANAGE,
  PERMISSIONS.INVENTORY_ADJUST,
] as const;

const upload = FileInterceptor('file', {
  limits: { fileSize: IMPORT_LIMITS.maxBytes, files: 1 },
});

const entityOf = (value: string): ImportEntity => {
  if (!isImportEntity(value))
    throw new NotFoundException('Nothing to import here');
  return value;
};

const formatOf = (value: string | undefined): 'csv' | 'xlsx' =>
  value === 'xlsx' ? 'xlsx' : 'csv';

/** Multipart fields arrive as strings; the mapping is JSON. */
function optionsOf(
  body: Record<string, unknown> | undefined,
): ImportOptionsPayload {
  let mapping: unknown;
  if (typeof body?.mapping === 'string' && body.mapping.trim() !== '') {
    try {
      mapping = JSON.parse(body.mapping);
    } catch {
      throw new BadRequestException('The column mapping could not be read');
    }
  }
  const parsed = importOptionsSchema.safeParse({
    mapping,
    onDuplicate: body?.onDuplicate || undefined,
  });
  if (!parsed.success) {
    throw new BadRequestException(
      parsed.error.issues[0]?.message ?? 'Invalid import options',
    );
  }
  return parsed.data;
}

@ApiTags('imports')
@Controller()
export class ImportsController {
  constructor(private readonly imports: ImportsService) {}

  @Get('imports')
  @RequireAnyPermission(...CAN_IMPORT)
  @ApiOperation({ summary: 'Recent imports' })
  list(@CurrentUser() user: AuthenticatedUser): Promise<ImportRunDto[]> {
    return this.imports.list(user);
  }

  @Get('imports/templates/:entity')
  @RequireAnyPermission(...CAN_IMPORT)
  @ApiOperation({ summary: 'A blank template with the expected columns' })
  async template(
    @Param('entity') entity: string,
    @Query('format') format: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const file = await this.imports.template(
      entityOf(entity),
      formatOf(format),
    );
    res.set({
      'Content-Type': file.contentType,
      'Content-Disposition': `attachment; filename="${file.fileName}"`,
    });
    return new StreamableFile(file.buffer);
  }

  @Get('imports/runs/:id')
  @RequireAnyPermission(...CAN_IMPORT)
  @ApiOperation({ summary: 'One import, with its failed rows' })
  findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ImportRunDto> {
    return this.imports.findOne(user, id);
  }

  @Get('imports/runs/:id/errors')
  @RequireAnyPermission(...CAN_IMPORT)
  @ApiOperation({
    summary: 'The failed rows as a file, with the reason for each',
  })
  async errors(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('format') format: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const file = await this.imports.errorsFile(user, id, formatOf(format));
    res.set({
      'Content-Type': file.contentType,
      'Content-Disposition': `attachment; filename="${file.fileName}"`,
    });
    return new StreamableFile(file.buffer);
  }

  /**
   * A dry run. Saves nothing, so it lives under its own prefix that the
   * audit trail skips.
   */
  @Post('import-previews/:entity')
  @RequireAnyPermission(...CAN_IMPORT)
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Read a file and check every row, without saving' })
  @UseInterceptors(upload)
  preview(
    @CurrentUser() user: AuthenticatedUser,
    @Param('entity') entity: string,
    @UploadedFile() file: UploadedFileLike | undefined,
    @Body() body: Record<string, unknown>,
  ): Promise<ImportPreviewDto> {
    return this.imports.preview(
      user,
      entityOf(entity),
      file,
      optionsOf(body).mapping,
    );
  }

  /** Audited once, as `import.<entity>`, with the run's counts as the record. */
  @Post('imports/:entity')
  @RequireAnyPermission(...CAN_IMPORT)
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Import a file' })
  @UseInterceptors(upload)
  commit(
    @CurrentUser() user: AuthenticatedUser,
    @Param('entity') entity: string,
    @UploadedFile() file: UploadedFileLike | undefined,
    @Body() body: Record<string, unknown>,
  ): Promise<ImportRunDto> {
    return this.imports.commit(user, entityOf(entity), file, optionsOf(body));
  }
}
