import { Body, Controller, Get, Patch } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  PERMISSIONS,
  updateOrganizationSchema,
  type OrganizationProfileDto,
  type UpdateOrganizationPayload,
} from '@saas/shared';
import { CurrentUser, RequirePermissions } from '@/common/decorators';
import { zodBody } from '@/common/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '@/common/types/authenticated-user';
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
}
