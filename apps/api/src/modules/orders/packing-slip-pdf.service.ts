import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import PDFDocument from 'pdfkit';
import {
  DEFAULT_DOCUMENT_TEMPLATE_CONFIG,
  DocumentTemplateConfig,
  UniversalDocumentData,
} from '@saas/shared';
import type {
  DeliveryNote,
  DeliveryNoteLine,
} from '../credits/entities/credit-note.entity';
import type { SalesOrder } from './entities/sales-order.entity';
import { Organization } from '../organizations/entities/organization.entity';
import { DocumentTemplatesService } from '../document-templates/document-templates.service';
import { DocumentPdfRendererService } from '../document-templates/document-pdf-renderer.service';

/**
 * The packing slip that goes in the box. Quantities only — no prices, because
 * the person unpacking it is rarely the person who pays for it.
 */
@Injectable()
export class PackingSlipPdfService {
  constructor(
    private readonly pdfRenderer?: DocumentPdfRendererService,
    private readonly documentTemplatesService?: DocumentTemplatesService,
    @InjectRepository(Organization)
    private readonly organizationRepository?: Repository<Organization>,
  ) {}

  async generate(
    note: DeliveryNote,
    lines: DeliveryNoteLine[],
    order: SalesOrder | null,
    organizationName: string,
  ): Promise<Buffer> {
    if (this.pdfRenderer && this.documentTemplatesService) {
      const template =
        await this.documentTemplatesService.resolveForDocumentType(
          note.tenantId,
          'DELIVERY_NOTE',
        );

      const org =
        note.tenantId && this.organizationRepository
          ? await this.organizationRepository.findOne({
              where: { id: note.tenantId },
            })
          : null;

      const address =
        [
          org?.addressLine1,
          org?.addressLine2,
          [org?.city, org?.region, org?.postalCode].filter(Boolean).join(' '),
          org?.country,
        ]
          .filter(Boolean)
          .join(', ') || undefined;

      const docData: UniversalDocumentData = {
        type: 'DELIVERY_NOTE',
        number: note.deliveryNoteNumber,
        status: note.status,
        issuedAt: note.dispatchedAt || (note as any).createdAt || new Date(),
        currency: 'USD',
        organization: {
          name: org?.name || organizationName || 'Your Company',
          address,
          taxId: org?.taxId || undefined,
          phone: org?.phone || undefined,
          email: org?.email || undefined,
          website: org?.website || undefined,
        },
        party: {
          name: note.customerName || 'Customer',
          address: note.shipTo || undefined,
        },
        secondaryParty: {
          label: 'Ship To',
          name: note.customerName || 'Customer',
          address: note.shipTo || undefined,
          carrier: note.carrier || undefined,
          trackingReference: note.trackingReference || undefined,
        },
        items: lines.map((line) => ({
          code: line.salesOrderLineId || undefined,
          description: line.description + (line.uom ? ` (${line.uom})` : ''),
          quantity: Number(line.qty || 0),
        })),
        totals: {
          total: 0,
        },
        notes: [
          order ? `Order: ${order.orderNumber}` : null,
          note.notes,
        ]
          .filter(Boolean)
          .join('\n') || undefined,
      };

      const baseConfig = template?.config ?? DEFAULT_DOCUMENT_TEMPLATE_CONFIG;
      const config: DocumentTemplateConfig = {
        ...baseConfig,
        itemsTable: {
          ...baseConfig.itemsTable,
          showUnitPrice: template?.config
            ? baseConfig.itemsTable.showUnitPrice
            : false,
          showDiscount: template?.config
            ? baseConfig.itemsTable.showDiscount
            : false,
          showTaxRate: template?.config
            ? baseConfig.itemsTable.showTaxRate
            : false,
          showLineTotal: template?.config
            ? baseConfig.itemsTable.showLineTotal
            : false,
        },
        totals: {
          ...baseConfig.totals,
          showSubtotal: template?.config
            ? baseConfig.totals.showSubtotal
            : false,
          showDiscountTotal: template?.config
            ? baseConfig.totals.showDiscountTotal
            : false,
          showTaxSummary: template?.config
            ? baseConfig.totals.showTaxSummary
            : false,
          showAmountPaid: false,
          showBalanceDue: false,
          highlightTotal: template?.config
            ? baseConfig.totals.highlightTotal
            : false,
        },
      };

      return this.pdfRenderer.render(docData, config);
    }

    return this.legacyGenerate(note, lines, order, organizationName);
  }

  private legacyGenerate(
    note: DeliveryNote,
    lines: DeliveryNoteLine[],
    order: SalesOrder | null,
    organizationName: string,
  ): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margin: 50 });
      const chunks: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      doc.fontSize(18).font('Helvetica-Bold').text(organizationName, 50, 50);
      doc
        .fontSize(20)
        .font('Helvetica-Bold')
        .text('PACKING SLIP', 0, 50, { align: 'right' });
      doc
        .fontSize(10)
        .font('Helvetica')
        .text(note.deliveryNoteNumber, { align: 'right' })
        .text(order ? `Order ${order.orderNumber}` : '', { align: 'right' })
        .text(
          note.dispatchedAt
            ? `Dispatched ${note.dispatchedAt.toDateString()}`
            : 'Not yet dispatched',
          { align: 'right' },
        );

      doc.fontSize(11).font('Helvetica-Bold').text('Deliver to', 50, 140);
      doc.fontSize(10).font('Helvetica').text(note.customerName);
      if (note.shipTo) doc.text(note.shipTo, { width: 260 });

      if (note.carrier || note.trackingReference) {
        doc
          .fontSize(11)
          .font('Helvetica-Bold')
          .text('Carrier', 330, 140)
          .fontSize(10)
          .font('Helvetica')
          .text(note.carrier ?? '', 330)
          .text(
            note.trackingReference ? `Tracking ${note.trackingReference}` : '',
            330,
          );
      }

      const top = Math.max(doc.y + 30, 240);
      doc.fontSize(10).font('Helvetica-Bold');
      doc.text('Item', 50, top);
      doc.text('Qty', 420, top, { width: 60, align: 'right' });
      doc.text('Checked', 490, top, { width: 60, align: 'right' });
      doc
        .moveTo(50, top + 15)
        .lineTo(545, top + 15)
        .stroke();

      let y = top + 25;
      doc.font('Helvetica');
      for (const line of lines) {
        if (y > 760) {
          doc.addPage();
          y = 50;
        }
        const height = doc.heightOfString(line.description, { width: 350 });
        doc.text(line.description, 50, y, { width: 350 });
        doc.text(`${Number(line.qty)} ${line.uom ?? ''}`.trim(), 420, y, {
          width: 60,
          align: 'right',
        });
        doc.rect(525, y - 2, 12, 12).stroke();
        y += Math.max(height, 14) + 8;
      }

      if (note.notes) {
        doc
          .moveDown(2)
          .font('Helvetica-Bold')
          .text('Notes', 50)
          .font('Helvetica')
          .text(note.notes, { width: 495 });
      }
      doc.end();
    });
  }
}
