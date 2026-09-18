import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import {
  LOGO_MAX_BYTES,
  PERMISSIONS,
  updateOrganizationSchema,
  type OrganizationProfileDto,
  type UpdateOrganizationPayload,
} from '@saas/shared';
import { CurrentUser, Public, RequirePermissions } from '@/common/decorators';
import { zodBody } from '@/common/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '@/common/types/authenticated-user';
import type { UploadedFileLike } from '../storage/storage.types';
import { OrganizationsService } from './organizations.service';

@ApiTags('organization')
@Controller('organization')
export class OrganizationsController {
  constructor(private readonly organizations: OrganizationsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.ORG_READ)
  @ApiOperation({
    summary: 'The organization',
    description: 'Name, registration details and address, as printed on documents',
  })
  get(@CurrentUser() user: AuthenticatedUser): Promise<OrganizationProfileDto> {
    return this.organizations.get(user.organizationId);
  }

  @Patch()
  @RequirePermissions(PERMISSIONS.ORG_UPDATE)
  @ApiOperation({
    summary: 'Update the organization',
    description:
      'Partial. Blank strings clear a field; base currency is changed through /finance/currencies/base, which refuses once anything is posted.',
  })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(updateOrganizationSchema)) dto: UpdateOrganizationPayload,
  ): Promise<OrganizationProfileDto> {
    return this.organizations.update(user.organizationId, dto);
  }

  @Post('logo')
  @RequirePermissions(PERMISSIONS.ORG_UPDATE)
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Upload the logo printed on documents',
    description: 'PNG, JPEG or WebP, under 2 MB. Replaces any previous logo.',
  })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: LOGO_MAX_BYTES } }))
  uploadLogo(
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() file: UploadedFileLike | undefined,
  ): Promise<OrganizationProfileDto> {
    return this.organizations.setLogo(user.organizationId, file);
  }

  @Delete('logo')
  @RequirePermissions(PERMISSIONS.ORG_UPDATE)
  @ApiOperation({ summary: 'Remove the logo' })
  clearLogo(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<OrganizationProfileDto> {
    return this.organizations.clearLogo(user.organizationId);
  }

  /**
   * The logo itself, served inline and without a session.
   *
   * Public because it has to render on the quote page a customer opens from a
   * link, and in a PDF — neither has a session to check. A logo is on every
   * document the business sends, so it is not a secret, and the id in the path
   * is one the holder of the link already has.
   *
   * The headers are the security. The content type comes from an allowlist of
   * raster formats checked on upload, `nosniff` stops a browser from deciding
   * on something else, and the CSP means that even if bytes somehow reached
   * here that a browser treated as a document, it could load and run nothing.
   */
  @Get(':tenantId/logo')
  @Public()
  @ApiOperation({ summary: 'An organization’s logo, for its documents' })
  async logo(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const logo = await this.organizations.logo(tenantId);

    res.set({
      'Content-Type': logo.contentType,
      'Content-Disposition': 'inline',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      // Immutable for a day: the URL carries the upload time, so replacing the
      // logo changes the URL rather than waiting for a cache to expire.
      'Cache-Control': 'public, max-age=86400',
    });
    return res.send(logo.body);
  }
}
