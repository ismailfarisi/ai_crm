import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  ATTACHMENT_MAX_BYTES,
  BILL_CAPTURE_MAX_BYTES,
  isBillCaptureContentType,
  PERMISSIONS,
} from '@saas/shared';
import type { UploadedFileLike } from '../storage/storage.types';
import { CurrentUser, RequirePermissions } from '@/common/decorators';
import type { AuthenticatedUser } from '@/common/types/authenticated-user';
import { JwtAuthGuard } from '@/modules/auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '@/modules/rbac/guards/permissions.guard';
import { ExpensesService } from './expenses.service';
import {
  CreateExpenseClaimDto,
  UpdateExpenseClaimDto,
  SignalExpenseDto,
  ScanReceiptDto,
  ScannedReceiptResult,
} from './dto';
import { ExpenseClaim } from './entities/expense-claim.entity';
import { ExpenseReceiptsService } from './expense-receipts.service';

@ApiTags('finance/expenses')
@Controller('finance/expenses')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ExpensesController {
  constructor(
    private readonly expensesService: ExpensesService,
    private readonly receipts: ExpenseReceiptsService,
  ) {}

  @Get()
  @RequirePermissions(PERMISSIONS.FINANCE_READ)
  @ApiOperation({
    summary: 'List expense claims',
    description: 'Lists all employee expense claims for tenant',
  })
  async findAll(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ExpenseClaim[]> {
    return this.expensesService.findAll(user.organizationId);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.EXPENSE_SUBMIT)
  @ApiOperation({
    summary: 'Submit expense claim',
    description:
      'Submits a new expense claim and starts Temporal approval workflow',
  })
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateExpenseClaimDto,
  ): Promise<ExpenseClaim> {
    // A new claim has no attachments yet; its receipt is uploaded after.
    await this.receipts.assertReceiptUrl(
      user.organizationId,
      null,
      dto.receiptUrl,
    );
    return this.expensesService.create(user.organizationId, dto, user);
  }

  @Post('scan-receipt')
  @RequirePermissions(PERMISSIONS.EXPENSE_SUBMIT, PERMISSIONS.AI_USE)
  @ApiOperation({
    summary: 'Scan receipt with AI OCR',
    description:
      'Extracts merchant, amount, date, category, and items from receipt image or text',
  })
  @ApiConsumes('application/json', 'multipart/form-data')
  // A receipt photo or PDF is sent as a file: as base64 in JSON it would hit
  // the 100 KB body limit. The JSON form stays for text and links.
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: BILL_CAPTURE_MAX_BYTES } }),
  )
  async scanReceipt(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ScanReceiptDto,
    @UploadedFile() file?: UploadedFileLike,
  ): Promise<ScannedReceiptResult> {
    if (file) {
      if (!isBillCaptureContentType(file.mimetype)) {
        throw new BadRequestException(
          'Upload the receipt as a PDF or a photo (JPEG, PNG or WebP).',
        );
      }
      dto = {
        ...dto,
        base64: file.buffer.toString('base64'),
        mimeType: file.mimetype,
        imageUrl: undefined,
      };
    }
    return this.expensesService.scanReceipt(dto, {
      organizationId: user.organizationId,
      userId: user.id,
    });
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.FINANCE_READ)
  @ApiOperation({
    summary: 'Get expense claim',
    description: 'Gets a single expense claim by ID',
  })
  async findById(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ExpenseClaim> {
    return this.expensesService.findById(user.organizationId, id);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.EXPENSE_SUBMIT)
  @ApiOperation({
    summary: 'Update expense claim',
    description: 'Updates expense claim attributes',
  })
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateExpenseClaimDto,
  ): Promise<ExpenseClaim> {
    await this.receipts.assertReceiptUrl(
      user.organizationId,
      id,
      dto.receiptUrl,
    );
    return this.expensesService.update(user.organizationId, id, dto);
  }

  @Post(':id/receipt')
  @RequirePermissions(PERMISSIONS.EXPENSE_SUBMIT)
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Attach the receipt to an expense claim',
    description:
      'Stores the file as an attachment on the claim and makes it the claim’s receipt. PDF or image.',
  })
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: ATTACHMENT_MAX_BYTES } }),
  )
  async attachReceipt(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file?: UploadedFileLike,
  ): Promise<ExpenseClaim> {
    return this.receipts.attach(user, id, file);
  }

  @Post(':id/signal')
  @RequirePermissions(PERMISSIONS.EXPENSE_APPROVE)
  @ApiOperation({
    summary: 'Signal expense claim',
    description:
      'Approve, reject, or reimburse an expense claim via Temporal workflow',
  })
  async signal(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SignalExpenseDto,
  ): Promise<ExpenseClaim> {
    return this.expensesService.sendSignal(user.organizationId, id, dto);
  }
}
