import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  PERMISSIONS,
  type AutomationExecutionDto,
  type AutomationExecutionPageDto,
} from '@saas/shared';
import { CurrentUser, RequirePermissions } from '@/common/decorators';
import { zodQuery } from '@/common/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '@/common/types/authenticated-user';
import { AutomationsService, redactForReader } from './automations.service';
import { AiService } from '../ai/ai.service';
import { CreateAutomationDto } from './dto/create-automation.dto';
import { UpdateAutomationDto } from './dto/update-automation.dto';
import {
  listExecutionsQuerySchema,
  type ListExecutionsQuery,
} from './dto/list-executions-query.dto';
import { SignalExecutionDto } from './dto/signal-execution.dto';
import { AutomationWorkflow } from './entities/automation-workflow.entity';
import { AutomationExecution } from './entities/automation-execution.entity';

@ApiTags('automations')
@Controller('automations')
export class AutomationsController {
  constructor(
    private readonly automationsService: AutomationsService,
    private readonly aiService: AiService,
  ) {}

  // Static route: must stay above @Get(':id') so it is not captured as an id.
  @Get('settings')
  @RequirePermissions(PERMISSIONS.AUTOMATION_READ)
  @ApiOperation({
    summary: 'Get automation settings',
    description: 'Organisation-level automation settings set by an AI admin',
  })
  async getSettings(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ aiEmailToCustomers: boolean }> {
    const status = await this.aiService.getBudgetStatus(user.organizationId);
    return { aiEmailToCustomers: status.automationAiEmailToCustomers };
  }

  @Get()
  @RequirePermissions(PERMISSIONS.AUTOMATION_READ)
  @ApiOperation({
    summary: 'List workflows',
    description: 'List all automation workflows for tenant',
  })
  async findAllWorkflows(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<AutomationWorkflow[]> {
    const rows = await this.automationsService.findAllWorkflows(
      user.organizationId,
    );
    return rows.map((wf) => redactForReader(wf, user.permissions));
  }

  @Post()
  @RequirePermissions(PERMISSIONS.AUTOMATION_CREATE)
  @ApiOperation({
    summary: 'Create workflow',
    description: 'Create a new automation workflow',
  })
  async createWorkflow(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateAutomationDto,
  ): Promise<AutomationWorkflow> {
    const wf = await this.automationsService.createWorkflow(
      user.organizationId,
      dto,
    );
    return redactForReader(wf, user.permissions);
  }

  @Get('executions/:executionId')
  @RequirePermissions(PERMISSIONS.AUTOMATION_READ)
  @ApiOperation({
    summary: 'Get execution details',
    description: 'Get single execution record and node results',
  })
  async findExecutionById(
    @CurrentUser() user: AuthenticatedUser,
    @Param('executionId', ParseUUIDPipe) executionId: string,
  ): Promise<AutomationExecutionDto> {
    // Payloads and step data can hold customer details: only people who can
    // edit automations see them.
    return this.automationsService.findExecutionById(
      user.organizationId,
      executionId,
      user.permissions.includes(PERMISSIONS.AUTOMATION_UPDATE),
    );
  }

  @Post('executions/:executionId/signal')
  @RequirePermissions(PERMISSIONS.AUTOMATION_APPROVE)
  @ApiOperation({
    summary: 'Signal execution',
    description: 'Send approval or rejection signal to execution workflow',
  })
  async signalExecution(
    @CurrentUser() user: AuthenticatedUser,
    @Param('executionId', ParseUUIDPipe) executionId: string,
    @Body() dto: SignalExecutionDto,
  ): Promise<AutomationExecutionDto> {
    return this.automationsService.signalExecution(
      user.organizationId,
      executionId,
      dto,
      user,
    );
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.AUTOMATION_READ)
  @ApiOperation({
    summary: 'Get workflow',
    description: 'Get a single automation workflow by ID',
  })
  async findWorkflowById(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AutomationWorkflow> {
    const wf = await this.automationsService.findWorkflowById(
      user.organizationId,
      id,
    );
    return redactForReader(wf, user.permissions);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.AUTOMATION_UPDATE)
  @ApiOperation({
    summary: 'Update workflow',
    description: 'Update automation workflow metadata and graph',
  })
  async updateWorkflow(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAutomationDto,
  ): Promise<AutomationWorkflow> {
    return this.automationsService.updateWorkflow(
      user.organizationId,
      id,
      dto,
      user.id,
    );
  }

  @Post(':id/webhook/regenerate')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.AUTOMATION_UPDATE)
  @ApiOperation({
    summary: 'Regenerate webhook address',
    description:
      'Replace the secret web address of a webhook automation; the old one stops working',
  })
  async regenerateWebhookToken(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AutomationWorkflow> {
    return this.automationsService.regenerateWebhookToken(
      user.organizationId,
      id,
      user.id,
    );
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions(PERMISSIONS.AUTOMATION_DELETE)
  @ApiOperation({
    summary: 'Delete workflow',
    description: 'Delete an automation workflow',
  })
  async deleteWorkflow(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.automationsService.deleteWorkflow(user.organizationId, id);
  }

  @Post(':id/test-run')
  @RequirePermissions(PERMISSIONS.AUTOMATION_EXECUTE)
  @ApiOperation({
    summary: 'Test run workflow',
    description: 'Trigger immediate manual test run of workflow',
  })
  async testRunWorkflow(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: Record<string, any>,
  ): Promise<AutomationExecution> {
    return this.automationsService.triggerExecution(
      user.organizationId,
      id,
      body,
      user.id,
      { testRun: true },
    );
  }

  @Get(':id/executions')
  @RequirePermissions(PERMISSIONS.AUTOMATION_READ)
  @ApiOperation({
    summary: 'List workflow executions',
    description: 'One page of a workflow run history, newest first',
  })
  async findExecutions(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query(zodQuery(listExecutionsQuerySchema)) query: ListExecutionsQuery,
  ): Promise<AutomationExecutionPageDto> {
    return this.automationsService.findExecutionsPage(
      user.organizationId,
      id,
      query,
    );
  }
}
