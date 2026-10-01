import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import PDFDocument from 'pdfkit';
import {
  DEFAULT_DOCUMENT_TEMPLATE_CONFIG,
  UniversalDocumentData,
} from '@saas/shared';
import { PurchaseOrder } from './entities/purchase-order.entity';
import { Supplier } from './entities/supplier.entity';
import { Organization } from '../organizations/entities/organization.entity';
import { DocumentTemplatesService } from '../document-templates/document-templates.service';
import { DocumentPdfRendererService } from '../document-templates/document-pdf-renderer.service';

const CURRENCY_LOCALE = undefined;

function formatMoney(amount: number, currency: string): string {
  return new Intl.NumberFormat(CURRENCY_LOCALE, {
    style: 'currency',
    currency,
  }).format(amount);
}

function formatDate(value: Date | null): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat(CURRENCY_LOCALE, {
    dateStyle: 'medium',
  }).format(new Date(value));
}

/**
 * Renders a purchase order for the supplier.
 *
 * Uses the unified `DocumentPdfRendererService` and `DocumentTemplatesService`,
 * with fallback to the legacy pdfkit renderer.
 */
@Injectable()
export class PurchaseOrderPdfService {
  constructor(
    private readonly pdfRenderer?: DocumentPdfRendererService,
    private readonly documentTemplatesService?: DocumentTemplatesService,
    @InjectRepository(Organization)
    private readonly organizationRepository?: Repository<Organization>,
  ) {}

  async generate(
    order: PurchaseOrder,
    supplier: Supplier | null,
    organizationName: string,
  ): Promise<Buffer> {
    if (this.pdfRenderer && this.documentTemplatesService) {
      const template =
        await this.documentTemplatesService.resolveForDocumentType(
          order.tenantId,
          'PURCHASE_ORDER',
        );

      const org =
        order.tenantId && this.organizationRepository
          ? await this.organizationRepository.findOne({
              where: { id: order.tenantId },
            })
          : null;

      const orgAddress =
        [
          org?.addressLine1,
          org?.addressLine2,
          [org?.city, org?.region, org?.postalCode].filter(Boolean).join(' '),
          org?.country,
        ]
          .filter(Boolean)
          .join(', ') || undefined;

      const supplierAddress =
        [
          supplier?.addressLine1,
          supplier?.addressLine2,
          [supplier?.city, supplier?.postalCode].filter(Boolean).join(' '),
          supplier?.country,
        ]
          .filter(Boolean)
          .join(', ') || undefined;

      const docData: UniversalDocumentData = {
        type: 'PURCHASE_ORDER',
        number: order.poNumber,
        status: order.status,
        issuedAt: order.orderDate || (order as any).createdAt || new Date(),
        dueDate: order.expectedDate || undefined,
        currency: order.currency || 'USD',
        organization: {
          name: org?.name || organizationName || 'Your Company',
          address: orgAddress,
          taxId: org?.taxId || undefined,
          phone: org?.phone || undefined,
          email: org?.email || undefined,
          website: org?.website || undefined,
        },
        party: {
          name: supplier?.companyName || order.supplierName || 'Supplier',
          companyName: supplier?.companyName || order.supplierName || undefined,
          address: supplierAddress,
          email: supplier?.email || undefined,
          phone: supplier?.phone || undefined,
          taxId: supplier?.taxId || undefined,
        },
        items: (order.lines || []).map((l) => ({
          code: l.materialId || undefined,
          description: l.description + (l.uom ? ` (${l.uom})` : ''),
          quantity: Number(l.qtyOrdered || 0),
          unitPrice: Number(l.unitCost || 0),
          amount: Number(
            l.lineTotal != null
              ? l.lineTotal
              : Number(l.qtyOrdered || 0) * Number(l.unitCost || 0),
          ),
        })),
        totals: {
          subtotal: Number(order.subtotalAmount || 0),
          total: Number(order.totalAmount || 0),
        },
        notes: order.notes || undefined,
      };

      return this.pdfRenderer.render(
        docData,
        template?.config ?? DEFAULT_DOCUMENT_TEMPLATE_CONFIG,
      );
    }

    return this.legacyGenerate(order, supplier, organizationName);
  }

  private legacyGenerate(
    order: PurchaseOrder,
    supplier: Supplier | null,
    organizationName: string,
  ): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margin: 50 });
      const chunks: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      this.legacyRender(doc, order, supplier, organizationName);
      doc.end();
    });
  }

  private legacyRender(
    doc: PDFKit.PDFDocument,
    order: PurchaseOrder,
    supplier: Supplier | null,
    organizationName: string,
  ): void {
    doc.fontSize(18).font('Helvetica-Bold').text(organizationName, 50, 50);
    doc
      .fontSize(20)
      .font('Helvetica-Bold')
      .text('PURCHASE ORDER', 0, 50, { align: 'right' });
    doc.fontSize(10).font('Helvetica').text(order.poNumber, { align: 'right' });

    // A draft that reaches a supplier by accident must not look orderable.
    if (order.status !== 'SENT' && order.status !== 'APPROVED') {
      doc
        .fontSize(9)
        .font('Helvetica-Bold')
        .fillColor('#9B3626')
        .text(`${order.status.replace(/_/g, ' ')} — NOT AN ORDER`, {
          align: 'right',
        })
        .fillColor('black');
    }

    doc.moveDown(2);

    const detailsTop = 120;
    doc.fontSize(9).font('Helvetica-Bold').text('SUPPLIER', 50, detailsTop);
    doc
      .font('Helvetica')
      .fontSize(10)
      .text(order.supplierName, 50, detailsTop + 14);
    let y = detailsTop + 28;
    for (const line of [
      supplier?.contactName,
      supplier?.addressLine1,
      supplier?.addressLine2,
      [supplier?.city, supplier?.postalCode].filter(Boolean).join(' '),
      supplier?.country,
      supplier?.email,
    ]) {
      if (!line) continue;
      doc.fontSize(9).text(line, 50, y);
      y += 12;
    }

    doc.fontSize(9).font('Helvetica-Bold').text('ORDER DATE', 350, detailsTop);
    doc
      .font('Helvetica')
      .fontSize(10)
      .text(formatDate(order.orderDate), 350, detailsTop + 14);
    doc.fontSize(9).font('Helvetica-Bold').text('EXPECTED', 450, detailsTop);
    doc
      .font('Helvetica')
      .fontSize(10)
      .text(formatDate(order.expectedDate), 450, detailsTop + 14);

    const tableTop = Math.max(y + 20, 230);
    const columns = {
      description: 50,
      qty: 300,
      uom: 360,
      unitCost: 410,
      total: 480,
    };

    doc
      .font('Helvetica-Bold')
      .fontSize(10)
      .text('Description', columns.description, tableTop)
      .text('Qty', columns.qty, tableTop)
      .text('Unit', columns.uom, tableTop)
      .text('Unit Cost', columns.unitCost, tableTop)
      .text('Total', columns.total, tableTop);

    doc
      .moveTo(50, tableTop + 15)
      .lineTo(545, tableTop + 15)
      .stroke();

    y = tableTop + 25;
    doc.font('Helvetica').fontSize(10);
    for (const line of order.lines ?? []) {
      doc
        .text(line.description, columns.description, y, { width: 240 })
        .text(String(line.qtyOrdered), columns.qty, y)
        .text(line.uom, columns.uom, y)
        .text(formatMoney(line.unitCost, order.currency), columns.unitCost, y)
        .text(formatMoney(line.lineTotal, order.currency), columns.total, y);
      y += 20;
    }

    y += 15;
    doc.moveTo(350, y).lineTo(545, y).stroke();
    y += 10;
    doc
      .font('Helvetica-Bold')
      .fontSize(12)
      .text('Total', 350, y)
      .text(formatMoney(order.totalAmount, order.currency), columns.total, y);

    if (order.notes) {
      y += 30;
      doc
        .font('Helvetica-Bold')
        .fontSize(10)
        .text('Notes', 50, y)
        .font('Helvetica')
        .fontSize(9)
        .text(order.notes, 50, y + 14, { width: 495 });
    }
  }
}
