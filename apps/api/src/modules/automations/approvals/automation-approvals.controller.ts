import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS, type AutomationApprovalDto } from '@saas/shared';
import { CurrentUser, RequirePermissions } from '@/common/decorators';
import { zodBody } from '@/common/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '@/common/types/authenticated-user';
import { AutomationApprovalsService } from './automation-approvals.service';
import {
  approvalDecisionSchema,
  type ApprovalDecisionDto,
} from './approval-decision.dto';

// Its own prefix, not `automations/approvals`, so it can never be captured by
// AutomationsController's `@Get(':id')`.
@ApiTags('automations')
@Controller('automation-approvals')
export class AutomationApprovalsController {
  constructor(private readonly approvals: AutomationApprovalsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.AUTOMATION_APPROVE)
  @ApiOperation({
    summary: 'List pending approvals',
    description:
      'Everything waiting for approval in the organisation, oldest first',
  })
  async list(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<AutomationApprovalDto[]> {
    return this.approvals.listPending(user.organizationId);
  }

  // Static route: stays above ':approvalId'.
  @Get('count')
  @RequirePermissions(PERMISSIONS.AUTOMATION_APPROVE)
  @ApiOperation({ summary: 'Count pending approvals' })
  async count(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ count: number }> {
    return { count: await this.approvals.countPending(user.organizationId) };
  }

  @Post(':approvalId/decision')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.AUTOMATION_APPROVE)
  @ApiOperation({
    summary: 'Approve or reject',
    description:
      'The first decision wins; a later one answers 409 with who decided',
  })
  async decide(
    @CurrentUser() user: AuthenticatedUser,
    @Param('approvalId', ParseUUIDPipe) approvalId: string,
    @Body(zodBody(approvalDecisionSchema)) body: ApprovalDecisionDto,
  ): Promise<AutomationApprovalDto> {
    return this.approvals.decide(user.organizationId, approvalId, user, body);
  }
}
