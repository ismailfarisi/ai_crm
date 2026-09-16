import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import { PurchaseOrder } from './entities/purchase-order.entity';
import { Supplier } from './entities/supplier.entity';

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
 * Mirrors `InvoicePdfService` — same pdfkit setup, same A4 margin, same
 * buffer-collecting promise — so that the two documents a tenant sends out
 * look like they came from the same company.
 */
@Injectable()
export class PurchaseOrderPdfService {
  generate(
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

      this.render(doc, order, supplier, organizationName);
      doc.end();
    });
  }

  private render(
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

    // Table
    let tableY = Math.max(y, detailsTop + 70) + 20;
    doc.fontSize(9).font('Helvetica-Bold');
    doc.text('DESCRIPTION', 50, tableY);
    doc.text('QTY', 330, tableY, { width: 50, align: 'right' });
    doc.text('UNIT', 385, tableY, { width: 60, align: 'right' });
    doc.text('TOTAL', 450, tableY, { width: 95, align: 'right' });
    tableY += 14;
    doc.moveTo(50, tableY).lineTo(545, tableY).stroke();
    tableY += 8;

    doc.font('Helvetica').fontSize(10);
    for (const line of order.lines ?? []) {
      doc.text(line.description, 50, tableY, { width: 270 });
      doc.text(String(line.qtyOrdered), 330, tableY, {
        width: 50,
        align: 'right',
      });
      doc.text(line.unitCost.toFixed(4), 385, tableY, {
        width: 60,
        align: 'right',
      });
      doc.text(formatMoney(line.lineTotal, order.currency), 450, tableY, {
        width: 95,
        align: 'right',
      });
      tableY += Math.max(
        18,
        doc.heightOfString(line.description, { width: 270 }) + 4,
      );

      if (tableY > 720) {
        doc.addPage();
        tableY = 60;
      }
    }

    doc.moveTo(330, tableY).lineTo(545, tableY).stroke();
    tableY += 10;
    doc.font('Helvetica-Bold').fontSize(11);
    doc.text('Total', 330, tableY, { width: 110, align: 'right' });
    doc.text(formatMoney(order.totalAmount, order.currency), 450, tableY, {
      width: 95,
      align: 'right',
    });

    if (order.notes) {
      tableY += 30;
      doc.font('Helvetica-Bold').fontSize(9).text('NOTES', 50, tableY);
      doc
        .font('Helvetica')
        .fontSize(9)
        .text(order.notes, 50, tableY + 12, { width: 495 });
    }
  }
}
