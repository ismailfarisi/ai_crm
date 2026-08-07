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
  createCustomerSchema,
  customerQuerySchema,
  updateCustomerSchema,
  type CreateCustomerInput,
  type CustomerDto,
  type PaginatedResult,
  type UpdateCustomerInput,
} from '@saas/shared';
import { CurrentUser, RequirePermissions } from '@/common/decorators';
import { zodBody, zodQuery } from '@/common/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '@/common/types/authenticated-user';
import { CustomersService } from './customers.service';
import type { CustomerQueryDto } from './dto/customer-query.dto';

@ApiTags('customers')
@Controller('customers')
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

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
