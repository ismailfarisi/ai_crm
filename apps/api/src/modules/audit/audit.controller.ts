import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  auditQuerySchema,
  PERMISSIONS,
  type AuditQueryPayload,
} from '@saas/shared';
import { CurrentUser, RequirePermissions } from '@/common/decorators';
import { zodQuery } from '@/common/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '@/common/types/authenticated-user';
import { AuditService } from './audit.service';

@ApiTags('audit')
@Controller('audit')
@RequirePermissions(PERMISSIONS.AUDIT_READ)
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @ApiOperation({ summary: 'The audit trail, newest first' })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query(zodQuery(auditQuerySchema)) query: AuditQueryPayload,
  ) {
    return this.audit.list(user.organizationId, query);
  }

  @Get(':subjectType/:subjectId')
  @ApiOperation({ summary: 'Everything that has happened to one record' })
  forSubject(
    @CurrentUser() user: AuthenticatedUser,
    @Param('subjectType') subjectType: string,
    @Param('subjectId', ParseUUIDPipe) subjectId: string,
  ) {
    return this.audit.forSubject(
      user.organizationId,
      subjectType.toUpperCase(),
      subjectId,
    );
  }
}
