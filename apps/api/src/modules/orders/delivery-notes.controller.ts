import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
  StreamableFile,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Repository } from 'typeorm';
import {
  createDeliveryNoteSchema,
  PERMISSIONS,
  type CreateDeliveryNotePayload,
} from '@saas/shared';
import { CurrentUser, RequirePermissions } from '@/common/decorators';
import { zodBody } from '@/common/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '@/common/types/authenticated-user';
import { Organization } from '../organizations/entities/organization.entity';
import { DeliveryNotesService } from './delivery-notes.service';
import { PackingSlipPdfService } from './packing-slip-pdf.service';

@ApiTags('delivery-notes')
@Controller()
export class DeliveryNotesController {
  constructor(
    private readonly deliveries: DeliveryNotesService,
    private readonly pdf: PackingSlipPdfService,
    @InjectRepository(Organization)
    private readonly organizations: Repository<Organization>,
  ) {}

  @Get('sales-orders/:id/delivery-notes')
  @RequirePermissions(PERMISSIONS.DELIVERY_NOTE_READ)
  @ApiOperation({ summary: 'Deliveries on a sales order' })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.deliveries.listForOrder(user.organizationId, id);
  }

  @Post('sales-orders/:id/delivery-notes')
  @RequirePermissions(PERMISSIONS.DELIVERY_NOTE_CREATE)
  @ApiOperation({ summary: 'Prepare a delivery from a sales order' })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(createDeliveryNoteSchema)) body: CreateDeliveryNotePayload,
  ) {
    return this.deliveries.create(user.organizationId, user.id, id, body);
  }

  @Get('delivery-notes/:id')
  @RequirePermissions(PERMISSIONS.DELIVERY_NOTE_READ)
  @ApiOperation({ summary: 'Get a delivery note' })
  get(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.deliveries.get(user.organizationId, id);
  }

  @Post('delivery-notes/:id/dispatch')
  @RequirePermissions(PERMISSIONS.DELIVERY_NOTE_DISPATCH)
  @ApiOperation({
    summary: 'Dispatch a delivery',
    description:
      'Advances fulfilled quantities and takes stocked goods off the shelf.',
  })
  dispatch(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.deliveries.dispatch(user.organizationId, id, user.id);
  }

  @Post('delivery-notes/:id/cancel')
  @RequirePermissions(PERMISSIONS.DELIVERY_NOTE_CREATE)
  @ApiOperation({ summary: 'Discard a draft delivery' })
  cancel(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.deliveries.cancel(user.organizationId, id);
  }

  @Post('delivery-notes/:id/invoice')
  @RequirePermissions(PERMISSIONS.SALES_ORDER_INVOICE)
  @ApiOperation({ summary: 'Invoice what one dispatched delivery carried' })
  invoice(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.deliveries.invoice(user.organizationId, id);
  }

  @Get('delivery-notes/:id/pdf')
  @RequirePermissions(PERMISSIONS.DELIVERY_NOTE_READ)
  @ApiOperation({ summary: 'Download the packing slip' })
  async packingSlip(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { note, lines, order } = await this.deliveries.forPdf(
      user.organizationId,
      id,
    );
    const organization = await this.organizations.findOne({
      where: { id: user.organizationId },
    });
    const buffer = await this.pdf.generate(
      note,
      lines,
      order,
      organization?.name ?? 'Relay CRM',
    );
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${note.deliveryNoteNumber}.pdf"`,
    });
    return new StreamableFile(buffer);
  }
}
