import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentUser, RequirePermissions } from '@/common/decorators';
import { JwtAuthGuard as AuthGuard } from '@/modules/auth/guards/jwt-auth.guard';
import { PERMISSIONS } from '@saas/shared';
import { CustomRecordsService } from '../services/custom-records.service';

@Controller('objects/:slug/records')
@UseGuards(AuthGuard)
export class CustomRecordsController {
  constructor(private readonly service: CustomRecordsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.CUSTOM_RECORD_READ)
  list(@CurrentUser() user: any, @Param('slug') slug: string, @Query() query: any) {
    return this.service.list(user.organizationId, slug, query, user);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.CUSTOM_RECORD_CREATE)
  create(@CurrentUser() user: any, @Param('slug') slug: string, @Body() body: any) {
    return this.service.create(user.organizationId, slug, body, user);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.CUSTOM_RECORD_READ)
  getById(@CurrentUser() user: any, @Param('slug') slug: string, @Param('id') id: string) {
    return this.service.getById(user.organizationId, slug, id, user);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.CUSTOM_RECORD_UPDATE)
  update(@CurrentUser() user: any, @Param('slug') slug: string, @Param('id') id: string, @Body() body: any) {
    return this.service.update(user.organizationId, slug, id, body, user);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.CUSTOM_RECORD_DELETE)
  delete(@CurrentUser() user: any, @Param('slug') slug: string, @Param('id') id: string) {
    return this.service.delete(user.organizationId, slug, id, user);
  }
}
