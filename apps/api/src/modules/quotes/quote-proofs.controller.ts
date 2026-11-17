import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  ATTACHMENT_MAX_BYTES,
  PERMISSIONS,
  proofRequirementSchema,
  uploadProofSchema,
  type ProofRequirementPayload,
  type QuoteProofsSummaryDto,
  type UploadProofPayload,
  type WorkOrderProofDto,
} from '@saas/shared';
import { CurrentUser, RequirePermissions } from '@/common/decorators';
import { zodBody } from '@/common/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '@/common/types/authenticated-user';
import type { UploadedFileLike } from '../storage/storage.types';
import { QuoteProofsService } from './quote-proofs.service';

@ApiTags('quotes')
@Controller()
export class QuoteProofsController {
  constructor(private readonly proofs: QuoteProofsService) {}

  @Get('quotes/:id/proofs')
  @RequirePermissions(PERMISSIONS.QUOTE_READ)
  @ApiOperation({ summary: 'Artwork proof versions on a quote, newest first' })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<QuoteProofsSummaryDto> {
    return this.proofs.list(user.organizationId, id);
  }

  @Post('quotes/:id/proofs')
  @RequirePermissions(PERMISSIONS.QUOTE_UPDATE)
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload the next proof version' })
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: ATTACHMENT_MAX_BYTES } }),
  )
  upload(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: UploadedFileLike,
    @Body(zodBody(uploadProofSchema)) body: UploadProofPayload,
  ): Promise<QuoteProofsSummaryDto> {
    return this.proofs.upload(user, id, file, body.note);
  }

  @Put('quotes/:id/proof-requirement')
  @RequirePermissions(PERMISSIONS.QUOTE_UPDATE)
  @ApiOperation({ summary: 'Whether accepting waits for an approved proof' })
  setRequirement(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(proofRequirementSchema)) body: ProofRequirementPayload,
  ): Promise<{ proofRequired: boolean }> {
    return this.proofs.setRequirement(user.organizationId, id, body.required);
  }

  @Get('work-orders/:id/proof')
  @RequirePermissions(PERMISSIONS.WORK_ORDER_READ)
  @ApiOperation({ summary: 'The approved artwork proof behind a work order' })
  forWorkOrder(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<WorkOrderProofDto | null> {
    return this.proofs.forWorkOrder(user.organizationId, id);
  }
}
