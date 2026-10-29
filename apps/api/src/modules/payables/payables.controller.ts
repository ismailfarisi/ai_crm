import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  BILL_CAPTURE_MAX_BYTES,
  billQuerySchema,
  billReasonSchema,
  createBillSchema,
  PERMISSIONS,
  recordBillPaymentSchema,
  type BillCaptureResult,
  type BillQueryPayload,
  type BillReasonPayload,
  type CreateBillPayload,
  type PaginatedResult,
  type RecordBillPaymentPayload,
} from '@saas/shared';
import { CurrentUser, RequirePermissions } from '@/common/decorators';
import { zodBody, zodQuery } from '@/common/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '@/common/types/authenticated-user';
import type { UploadedFileLike } from '../storage/storage.types';
import { BillCaptureService } from './bill-capture.service';
import { BillPayment, SupplierBill } from './entities/supplier-bill.entity';
import {
  PayablesService,
  type AgingReport,
  type BillableOrderLine,
} from './payables.service';

@ApiTags('payables')
@Controller()
export class PayablesController {
  constructor(
    private readonly payables: PayablesService,
    private readonly capture: BillCaptureService,
  ) {}

  @Get('bills')
  @RequirePermissions(PERMISSIONS.BILL_READ)
  @ApiOperation({ summary: 'List supplier bills' })
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Query(zodQuery(billQuerySchema)) query: BillQueryPayload,
  ): Promise<PaginatedResult<SupplierBill>> {
    return this.payables.list(user.organizationId, query);
  }

  @Get('bills/aging')
  @RequirePermissions(PERMISSIONS.BILL_READ)
  @ApiOperation({
    summary: 'What is owed to suppliers, by how overdue',
    description:
      'Reconciles against the payables ledger account. A non-zero `difference` means a bill and its journal entry have come apart.',
  })
  async aging(@CurrentUser() user: AuthenticatedUser): Promise<AgingReport> {
    return this.payables.aging(user.organizationId);
  }

  @Get('bills/:id')
  @RequirePermissions(PERMISSIONS.BILL_READ)
  @ApiOperation({ summary: 'Get one bill' })
  async get(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<SupplierBill> {
    return this.payables.findById(user.organizationId, id);
  }

  @Get('bills/:id/match')
  @RequirePermissions(PERMISSIONS.BILL_READ)
  @ApiOperation({ summary: 'The current three-way match for a bill' })
  async match(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.payables.check(user.organizationId, id);
  }

  @Get('bills/:id/payments')
  @RequirePermissions(PERMISSIONS.BILL_READ)
  @ApiOperation({ summary: 'Payments recorded against a bill' })
  async payments(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<BillPayment[]> {
    return this.payables.listPayments(user.organizationId, id);
  }

  @Get('purchase-orders/:id/billable')
  @RequirePermissions(PERMISSIONS.BILL_CREATE)
  @ApiOperation({
    summary: 'Quantities received on an order and not yet billed',
  })
  async billable(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<BillableOrderLine[]> {
    return this.payables.billableLines(user.organizationId, id);
  }

  @Post('bills')
  @RequirePermissions(PERMISSIONS.BILL_CREATE)
  @ApiOperation({ summary: 'Enter a supplier bill as a draft' })
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(createBillSchema)) body: CreateBillPayload,
  ): Promise<SupplierBill> {
    return this.payables.create(user.organizationId, user.id, body);
  }

  @Post('bills/capture')
  @RequirePermissions(PERMISSIONS.BILL_CREATE)
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Read a supplier invoice into a proposed bill',
    description:
      'Saves nothing. Returns what the document says, the supplier, order and order lines it appears to be for, and what to check. Enter the bill with POST /bills.',
  })
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: BILL_CAPTURE_MAX_BYTES } }),
  )
  async captureInvoice(
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() file: UploadedFileLike | undefined,
  ): Promise<BillCaptureResult> {
    if (!file) throw new BadRequestException('Attach the invoice as "file".');
    return this.capture.capture(user.organizationId, user.id, {
      buffer: file.buffer,
      mimeType: file.mimetype,
      filename: file.originalname,
    });
  }

  @Post('bills/:id/approve')
  @RequirePermissions(PERMISSIONS.BILL_APPROVE)
  @ApiOperation({
    summary: 'Approve a bill and post it',
    description:
      'A bill that bills more than was received, or at a price outside tolerance, also needs bill:approve_variance.',
  })
  async approve(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<SupplierBill> {
    return this.payables.approve(user.organizationId, id, {
      userId: user.id,
      permissions: user.permissions,
    });
  }

  @Post('bills/:id/dispute')
  @RequirePermissions(PERMISSIONS.BILL_UPDATE)
  @ApiOperation({
    summary: 'Hold a bill while it is queried with the supplier',
  })
  async dispute(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(billReasonSchema)) body: BillReasonPayload,
  ): Promise<SupplierBill> {
    return this.payables.dispute(user.organizationId, id, body.reason);
  }

  @Post('bills/:id/reopen')
  @RequirePermissions(PERMISSIONS.BILL_UPDATE)
  @ApiOperation({ summary: 'Return a disputed bill to draft' })
  async reopen(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<SupplierBill> {
    return this.payables.reopen(user.organizationId, id);
  }

  @Post('bills/:id/cancel')
  @RequirePermissions(PERMISSIONS.BILL_UPDATE)
  @ApiOperation({ summary: 'Cancel a bill that has not been approved' })
  async cancel(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<SupplierBill> {
    return this.payables.cancel(user.organizationId, id);
  }

  @Post('bills/:id/payments')
  @RequirePermissions(PERMISSIONS.BILL_PAY)
  @ApiOperation({ summary: 'Pay some or all of an approved bill' })
  async pay(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(recordBillPaymentSchema)) body: RecordBillPaymentPayload,
  ): Promise<SupplierBill> {
    return this.payables.recordPayment(user.organizationId, id, user.id, body);
  }

  @Post('bills/:id/payments/:paymentId/reverse')
  @RequirePermissions(PERMISSIONS.BILL_PAY)
  @ApiOperation({ summary: 'Reverse a payment and put the money back' })
  async reverse(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('paymentId', ParseUUIDPipe) paymentId: string,
  ): Promise<SupplierBill> {
    return this.payables.reversePayment(
      user.organizationId,
      id,
      paymentId,
      user.id,
    );
  }
}
