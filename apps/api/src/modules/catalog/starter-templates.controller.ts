import { Controller, Get, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  PERMISSIONS,
  type StarterInstallResultDto,
  type StarterTemplatePreviewDto,
} from '@saas/shared';
import { CurrentUser, RequirePermissions } from '@/common/decorators';
import type { AuthenticatedUser } from '@/common/types/authenticated-user';
import { StarterTemplatesService } from './starter-templates.service';

@ApiTags('catalog')
@Controller()
export class StarterTemplatesController {
  constructor(private readonly starters: StarterTemplatesService) {}

  @Get('catalog/starter-templates')
  @RequirePermissions(PERMISSIONS.CATALOG_MANAGE)
  @ApiOperation({
    summary: 'List the starter template library',
    description:
      'Each starter with its example job priced at placeholder AED rates',
  })
  list(): StarterTemplatePreviewDto[] {
    return this.starters.list();
  }

  @Post('catalog/starter-templates/:key/install')
  @RequirePermissions(PERMISSIONS.CATALOG_MANAGE)
  @ApiOperation({
    summary: 'Install a starter template',
    description:
      'Creates the template and any materials, work centres and tooling the tenant does not have yet',
  })
  install(
    @CurrentUser() user: AuthenticatedUser,
    @Param('key') key: string,
  ): Promise<StarterInstallResultDto> {
    return this.starters.install(user.organizationId, key, user.id);
  }
}
