import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@saas/shared';
import { CurrentUser, RequirePermissions } from '@/common/decorators';
import type { AuthenticatedUser } from '@/common/types/authenticated-user';
import { JwtAuthGuard } from '@/modules/auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '@/modules/rbac/guards/permissions.guard';
import { AiService } from './ai.service';
import { UpsertAiBudgetDto } from './dto/upsert-ai-budget.dto';
import { AiConfigService } from './services/ai-config.service';
import { AiProviderType } from './entities/ai-config.entity';

@ApiTags('ai')
@Controller('ai')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class AiController {
  constructor(
    private readonly aiService: AiService,
    private readonly aiConfigService: AiConfigService,
  ) {}

  @Get('configs')
  @RequirePermissions(PERMISSIONS.AI_MANAGE)
  @ApiOperation({
    summary: 'Get all AI provider configurations for the organization',
  })
  getConfigs(@CurrentUser() user: AuthenticatedUser) {
    return this.aiConfigService.getConfigs(user.organizationId);
  }

  @Post('configs/:provider')
  @RequirePermissions(PERMISSIONS.AI_MANAGE)
  @ApiOperation({
    summary: 'Save or update AI provider configuration for a provider',
  })
  saveConfig(
    @CurrentUser() user: AuthenticatedUser,
    @Param('provider') provider: AiProviderType,
    @Body()
    body: {
      isEnabled?: boolean;
      credentials?: { apiKey?: string; model?: string };
    },
  ) {
    return this.aiConfigService.saveConfig(
      user.organizationId,
      provider,
      body.isEnabled ?? true,
      body.credentials,
    );
  }

  @Post('configs/:provider/test')
  @RequirePermissions(PERMISSIONS.AI_MANAGE)
  @ApiOperation({ summary: 'Test connection for an AI provider' })
  testConfig(
    @CurrentUser() user: AuthenticatedUser,
    @Param('provider') provider: AiProviderType,
  ) {
    return this.aiConfigService.testConnection(user.organizationId, provider);
  }

  @Post('configs/:provider/default')
  @RequirePermissions(PERMISSIONS.AI_MANAGE)
  @ApiOperation({ summary: "Set an AI provider as the organization's default" })
  setDefaultConfig(
    @CurrentUser() user: AuthenticatedUser,
    @Param('provider') provider: AiProviderType,
  ) {
    return this.aiConfigService.setDefault(user.organizationId, provider);
  }

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
