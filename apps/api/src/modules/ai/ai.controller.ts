import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@saas/shared';
import { CurrentUser, RequirePermissions } from '@/common/decorators';
import type { AuthenticatedUser } from '@/common/types/authenticated-user';
import { JwtAuthGuard } from '@/modules/auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '@/modules/rbac/guards/permissions.guard';
import { AiService } from './ai.service';
import { UpsertAiBudgetDto } from './dto/upsert-ai-budget.dto';

@ApiTags('ai')
@Controller('ai')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class AiController {
  constructor(private readonly aiService: AiService) {}

  @Get('budget')
  @RequirePermissions(PERMISSIONS.AI_MANAGE)
  @ApiOperation({
    summary: 'Get AI budget status',
    description: "Current-month AI spend vs. the org's configured cap",
  })
  async getBudgetStatus(@CurrentUser() user: AuthenticatedUser) {
    return this.aiService.getBudgetStatus(user.organizationId);
  }

  @Patch('budget')
  @RequirePermissions(PERMISSIONS.AI_MANAGE)
  @ApiOperation({
    summary: 'Set AI budget',
    description: "Create or update the org's monthly AI spend cap",
  })
  async upsertBudget(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpsertAiBudgetDto,
  ) {
    return this.aiService.upsertBudget(user.organizationId, dto);
  }

  @Get('usage')
  @RequirePermissions(PERMISSIONS.AI_MANAGE)
  @ApiOperation({
    summary: 'List recent AI usage',
    description: 'Recent ai_usage_logs rows for the org, most recent first',
  })
  async listUsage(@CurrentUser() user: AuthenticatedUser) {
    return this.aiService.listUsage(user.organizationId);
  }
}
