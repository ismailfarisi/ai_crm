import {
  BadRequestException,
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
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  PERMISSIONS,
  createCustomerSchema,
  customerQuerySchema,
  updateCustomerSchema,
  type CreateCustomerInput,
  type CustomerDto,
  type CustomerOverviewDto,
  type PaginatedResult,
  type UpdateCustomerInput,
} from '@saas/shared';
import { CurrentUser, RequirePermissions } from '@/common/decorators';
import { zodBody, zodQuery } from '@/common/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '@/common/types/authenticated-user';
import { CustomersService } from './customers.service';
import { CustomerStatementService } from './customer-statement.service';
import type { CustomerQueryDto } from './dto/customer-query.dto';

@ApiTags('customers')
@Controller('customers')
export class CustomersController {
  constructor(
    private readonly customers: CustomersService,
    private readonly statementService: CustomerStatementService,
  ) {}

  @Get()
  @RequirePermissions(PERMISSIONS.CUSTOMER_READ)
  @ApiOperation({
    summary: 'List customers',
    description: "Returns all customers in the caller's organization.",
  })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query(zodQuery(customerQuerySchema)) query: CustomerQueryDto,
  ): Promise<PaginatedResult<CustomerDto>> {
    return this.customers.list(user, query);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.CUSTOMER_READ)
  findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<CustomerDto> {
    return this.customers.findOne(user, id);
  }

  /*
   * Declared after `:id` but matched before it would be: Nest routes in
   * declaration order, and `:id` would otherwise swallow nothing here since
   * the path has an extra segment. Kept adjacent to `findOne` for the reader.
   */
  @Get(':id/overview')
  @RequirePermissions(PERMISSIONS.CUSTOMER_READ)
  @ApiOperation({
    summary: 'One customer’s quotes, orders, invoices and balance',
  })
  overview(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<CustomerOverviewDto> {
    return this.customers.overview(user, id);
  }

  @Get(':id/statement/pdf')
  @RequirePermissions(PERMISSIONS.CUSTOMER_READ)
  @ApiOperation({ summary: 'Download customer statement of account PDF' })
  async getStatementPdf(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('from') fromStr?: string,
    @Query('to') toStr?: string,
    @Res() res?: Response,
  ): Promise<void> {
    const from = this.parseDateParam(
      fromStr,
      () => new Date(Date.now() - 30 * 86400000),
      'from',
      false,
    );
    const to = this.parseDateParam(
      toStr,
      () => new Date(),
      'to',
      true,
    );

    if (from.getTime() > to.getTime()) {
      throw new BadRequestException(
        '"from" date must be before or equal to "to" date',
      );
    }

    const { buffer, filename } = await this.statementService.getStatementPdf(
      user.organizationId,
      id,
      from,
      to,
    );
    if (res) {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.end(buffer);
    }
  }

  private parseDateParam(
    val: string | undefined,
    defaultFn: () => Date,
    paramName: string,
    isEndBoundary: boolean,
  ): Date {
    if (!val) {
      return defaultFn();
    }
    const d = new Date(val);
    if (isNaN(d.getTime())) {
      throw new BadRequestException(
        `Invalid "${paramName}" date parameter: ${val}`,
      );
    }
    if (isEndBoundary && val.trim().length <= 10) {
      d.setUTCHours(23, 59, 59, 999);
    }
    return d;
  }

  @Post()
  @RequirePermissions(PERMISSIONS.CUSTOMER_CREATE)
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(createCustomerSchema)) input: CreateCustomerInput,
  ): Promise<CustomerDto> {
    return this.customers.create(user, input);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.CUSTOMER_UPDATE)
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(updateCustomerSchema)) input: UpdateCustomerInput,
  ): Promise<CustomerDto> {
    return this.customers.update(user, id, input);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions(PERMISSIONS.CUSTOMER_DELETE)
  @ApiOperation({ summary: 'Soft-delete a customer' })
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.customers.remove(user, id);
  }
}
