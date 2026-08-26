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
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@saas/shared';
import { CurrentUser, Public, RequirePermissions } from '@/common/decorators';
import type { AuthenticatedUser } from '@/common/types/authenticated-user';
import { AutomationsService } from './automations.service';
import { CreateAutomationDto } from './dto/create-automation.dto';
import { UpdateAutomationDto } from './dto/update-automation.dto';
import { SignalExecutionDto } from './dto/signal-execution.dto';
import { AutomationWorkflow } from './entities/automation-workflow.entity';
import { AutomationExecution } from './entities/automation-execution.entity';

@ApiTags('automations')
@Controller('automations')
export class AutomationsController {
  constructor(private readonly automationsService: AutomationsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.AUTOMATION_READ)
  @ApiOperation({
    summary: 'List workflows',
    description: 'List all automation workflows for tenant',
  })
  async findAllWorkflows(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<AutomationWorkflow[]> {
    return this.automationsService.findAllWorkflows(user.organizationId);
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
    return this.automationsService.createWorkflow(user.organizationId, dto);
  }

  @Post('webhook/:slug')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Public webhook ingress',
    description: 'Trigger workflow execution via public webhook slug',
  })
  async handleWebhook(
    @Param('slug') slug: string,
    @Body() body: Record<string, any>,
  ): Promise<AutomationExecution> {
    return this.automationsService.triggerWebhook(slug, body);
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
  ): Promise<AutomationExecution> {
    return this.automationsService.findExecutionById(
      user.organizationId,
      executionId,
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
  ): Promise<AutomationExecution> {
    return this.automationsService.signalExecution(
      user.organizationId,
      executionId,
      dto,
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
    return this.automationsService.findWorkflowById(user.organizationId, id);
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
    );
  }

  @Get(':id/executions')
  @RequirePermissions(PERMISSIONS.AUTOMATION_READ)
  @ApiOperation({
    summary: 'List workflow executions',
    description: 'List execution history for a workflow',
  })
  async findExecutions(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AutomationExecution[]> {
    return this.automationsService.findExecutionsByWorkflow(
      user.organizationId,
      id,
    );
  }
}
