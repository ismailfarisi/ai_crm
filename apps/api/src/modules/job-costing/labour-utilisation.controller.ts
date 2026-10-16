import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  labourUtilisationQuerySchema,
  PERMISSIONS,
  type LabourUtilisationQueryPayload,
} from '@saas/shared';
import { CurrentUser, RequirePermissions } from '@/common/decorators';
import { zodQuery } from '@/common/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '@/common/types/authenticated-user';
import { LabourUtilisationService } from './labour-utilisation.service';

@ApiTags('finance-reports')
@Controller('finance')
export class LabourUtilisationController {
  constructor(private readonly utilisation: LabourUtilisationService) {}

  @Get('reports/labour-utilisation')
  @RequirePermissions(PERMISSIONS.FINANCE_READ, PERMISSIONS.PAYROLL_READ)
  @ApiOperation({
    summary: 'Where a month of paid labour went: jobs, indirect work, or nothing',
  })
  forPeriod(
    @CurrentUser() user: AuthenticatedUser,
    @Query(zodQuery(labourUtilisationQuerySchema))
    q: LabourUtilisationQueryPayload,
  ) {
    return this.utilisation.forPeriod(user.organizationId, q.period);
  }
}
