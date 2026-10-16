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
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  createSettlementSchema,
  PERMISSIONS,
  paySettlementSchema,
  updateSettlementSchema,
  type CreateSettlementPayload,
  type PaySettlementPayload,
  type SettlementDto,
  type SettlementStatementDto,
  type UpdateSettlementPayload,
} from '@saas/shared';
import { CurrentUser, RequirePermissions } from '@/common/decorators';
import { zodBody } from '@/common/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '@/common/types/authenticated-user';
import { JwtAuthGuard } from '@/modules/auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '@/modules/rbac/guards/permissions.guard';
import type { PayrollActor } from './payroll-posting.service';
import { SettlementsService } from './settlements.service';

const actorOf = (user: AuthenticatedUser): PayrollActor => ({
  userId: user.id,
  permissions: user.permissions,
});

@ApiTags('payroll')
@Controller('settlements')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class SettlementsController {
  constructor(private readonly settlements: SettlementsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.PAYROLL_READ)
  @ApiOperation({ summary: 'List final settlements' })
  list(@CurrentUser() user: AuthenticatedUser): Promise<SettlementDto[]> {
    return this.settlements.list(user.organizationId);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.PAYROLL_READ)
  @ApiOperation({ summary: 'A final settlement with its lines' })
  get(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<SettlementDto> {
    return this.settlements.get(user.organizationId, id);
  }

  @Get(':id/statement')
  @RequirePermissions(PERMISSIONS.PAYROLL_READ)
  @ApiOperation({ summary: 'Printable settlement statement' })
  statement(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<SettlementStatementDto> {
    return this.settlements.statement(user.organizationId, id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.PAYROLL_MANAGE)
  @ApiOperation({ summary: 'Draft a final settlement for a leaver' })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(createSettlementSchema)) body: CreateSettlementPayload,
  ): Promise<SettlementDto> {
    return this.settlements.create(user.organizationId, user.id, body);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.PAYROLL_MANAGE)
  @ApiOperation({ summary: 'Edit a draft settlement' })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(updateSettlementSchema)) body: UpdateSettlementPayload,
  ): Promise<SettlementDto> {
    return this.settlements.update(user.organizationId, id, body);
  }

  @Post(':id/refresh')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.PAYROLL_MANAGE)
  @ApiOperation({ summary: 'Recompute the calculated lines of a draft' })
  refresh(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<SettlementDto> {
    return this.settlements.refresh(user.organizationId, id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions(PERMISSIONS.PAYROLL_MANAGE)
  @ApiOperation({ summary: 'Delete a draft settlement' })
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.settlements.remove(user.organizationId, id);
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.PAYROLL_APPROVE)
  @ApiOperation({ summary: 'Approve and post a settlement' })
  approve(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<SettlementDto> {
    return this.settlements.approve(user.organizationId, id, actorOf(user));
  }

  @Post(':id/void')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.PAYROLL_APPROVE)
  @ApiOperation({ summary: 'Void an approved, unpaid settlement' })
  void(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<SettlementDto> {
    return this.settlements.void(user.organizationId, id, actorOf(user));
  }

  @Post(':id/pay')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.PAYROLL_PAY)
  @ApiOperation({ summary: 'Pay an approved settlement' })
  pay(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(paySettlementSchema)) body: PaySettlementPayload,
  ): Promise<SettlementDto> {
    return this.settlements.pay(user.organizationId, id, actorOf(user), body);
  }
}
