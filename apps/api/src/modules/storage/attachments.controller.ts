import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import {
  ATTACHMENT_MAX_BYTES,
  attachmentOwnerSchema,
  type AttachmentOwnerPayload,
} from '@saas/shared';
import { CurrentUser, Public } from '@/common/decorators';
import { zodQuery } from '@/common/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '@/common/types/authenticated-user';
import { AttachmentsService } from './attachments.service';
import type { UploadedFileLike } from './storage.types';

/**
 * Files on a document. There is no attachment permission: every route here
 * re-checks the permission of the record the file hangs off.
 */
@ApiTags('attachments')
@Controller('attachments')
export class AttachmentsController {
  constructor(private readonly attachments: AttachmentsService) {}

  @Get()
  @ApiOperation({ summary: 'Files attached to one record' })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query(zodQuery(attachmentOwnerSchema)) owner: AttachmentOwnerPayload,
  ) {
    return this.attachments.list(user, owner.ownerType, owner.ownerId);
  }

  @Post()
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Attach a file to a record' })
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: ATTACHMENT_MAX_BYTES } }),
  )
  upload(
    @CurrentUser() user: AuthenticatedUser,
    @Query(zodQuery(attachmentOwnerSchema)) owner: AttachmentOwnerPayload,
    @UploadedFile() file: UploadedFileLike,
  ) {
    return this.attachments.upload(user, owner.ownerType, owner.ownerId, file);
  }

  @Get(':id/link')
  @ApiOperation({ summary: 'A short-lived download URL for one file' })
  link(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.attachments.link(user, id);
  }

  /**
   * Public by design: the signature in the query string is the authority, and
   * it expires. This is the route a local-driver link points at; with S3 the
   * browser goes to the bucket instead.
   */
  @Get(':id/download')
  @Public()
  @ApiOperation({ summary: 'The file itself, for a signed link' })
  async download(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('expires') expires: string,
    @Query('token') token: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const file = await this.attachments.download(
      id,
      Number(expires) || 0,
      token ?? '',
    );
    res.set({
      'Content-Type': file.contentType,
      // Always an attachment: a stored SVG rendered inline would run its own
      // script on the API's origin.
      'Content-Disposition': `attachment; filename="${file.filename.replace(/"/g, '')}"`,
      'Cache-Control': 'private, no-store',
    });
    return res.send(file.body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove a file from a record' })
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.attachments.remove(user, id);
  }
}
