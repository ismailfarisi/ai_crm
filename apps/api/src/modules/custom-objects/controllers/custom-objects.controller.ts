import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { CurrentUser, RequirePermissions } from '@/common/decorators';
import { JwtAuthGuard as AuthGuard } from '@/modules/auth/guards/jwt-auth.guard';
import { PERMISSIONS } from '@saas/shared';
import { CustomObjectsService } from '../services/custom-objects.service';

@Controller('custom-objects')
@UseGuards(AuthGuard)
export class CustomObjectsController {
  constructor(private readonly service: CustomObjectsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.CUSTOM_RECORD_READ)
  list(@CurrentUser() user: any) {
    return this.service.list(user.organizationId);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.CUSTOM_OBJECT_MANAGE)
  create(@CurrentUser() user: any, @Body() body: any) {
    return this.service.create(user.organizationId, body);
  }

  @Get(':slug')
  @RequirePermissions(PERMISSIONS.CUSTOM_RECORD_READ)
  getBySlug(@CurrentUser() user: any, @Param('slug') slug: string) {
    return this.service.getBySlug(user.organizationId, slug);
  }

  @Patch(':slug')
  @RequirePermissions(PERMISSIONS.CUSTOM_OBJECT_MANAGE)
  update(@CurrentUser() user: any, @Param('slug') slug: string, @Body() body: any) {
    return this.service.update(user.organizationId, slug, body);
  }

  @Delete(':slug')
  @RequirePermissions(PERMISSIONS.CUSTOM_OBJECT_MANAGE)
  archive(@CurrentUser() user: any, @Param('slug') slug: string) {
    return this.service.archive(user.organizationId, slug);
  }

  @Post(':slug/attributes')
  @RequirePermissions(PERMISSIONS.CUSTOM_OBJECT_MANAGE)
  addAttribute(@CurrentUser() user: any, @Param('slug') slug: string, @Body() body: any) {
    return this.service.addAttribute(user.organizationId, slug, body);
  }

  @Patch(':slug/attributes/:attrSlug')
  @RequirePermissions(PERMISSIONS.CUSTOM_OBJECT_MANAGE)
  updateAttribute(
    @CurrentUser() user: any,
    @Param('slug') slug: string,
    @Param('attrSlug') attrSlug: string,
    @Body() body: any,
  ) {
    return this.service.updateAttribute(user.organizationId, slug, attrSlug, body);
  }

  @Delete(':slug/attributes/:attrSlug')
  @RequirePermissions(PERMISSIONS.CUSTOM_OBJECT_MANAGE)
  deleteAttribute(@CurrentUser() user: any, @Param('slug') slug: string, @Param('attrSlug') attrSlug: string) {
    return this.service.deleteAttribute(user.organizationId, slug, attrSlug);
  }

  @Post(':slug/relationships')
  @RequirePermissions(PERMISSIONS.CUSTOM_OBJECT_MANAGE)
  addRelationship(@CurrentUser() user: any, @Param('slug') slug: string, @Body() body: any) {
    return this.service.addRelationship(user.organizationId, slug, body);
  }

  @Delete(':slug/relationships/:relSlug')
  @RequirePermissions(PERMISSIONS.CUSTOM_OBJECT_MANAGE)
  deleteRelationship(@CurrentUser() user: any, @Param('slug') slug: string, @Param('relSlug') relSlug: string) {
    return this.service.deleteRelationship(user.organizationId, slug, relSlug);
  }
}
