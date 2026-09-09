import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import { Invoice, InvoiceStatus } from './entities/invoice.entity';

const CURRENCY_LOCALE = undefined;

function formatMoney(amount: number, currency: string): string {
  return new Intl.NumberFormat(CURRENCY_LOCALE, {
    style: 'currency',
    currency,
  }).format(amount);
}

@Injectable()
export class InvoicePdfService {
  generate(invoice: Invoice, organizationName: string): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margin: 50 });
      const chunks: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      this.render(doc, invoice, organizationName);
      doc.end();
    });
  }

  private render(
    doc: PDFKit.PDFDocument,
    invoice: Invoice,
    organizationName: string,
  ): void {
    const isPaid = invoice.status === InvoiceStatus.PAID;

    // Header
    doc.fontSize(18).font('Helvetica-Bold').text(organizationName, 50, 50);
    doc
      .fontSize(20)
      .font('Helvetica-Bold')
      .text('INVOICE', 0, 50, { align: 'right' });
    doc
      .fontSize(10)
      .font('Helvetica')
      .text(invoice.invoiceNumber, { align: 'right' })
      .text(`Issued: ${invoice.issuedAt.toDateString()}`, { align: 'right' })
      .text(invoice.dueDate ? `Due: ${invoice.dueDate.toDateString()}` : '', {
        align: 'right',
      });

    // Status badge
    doc
      .fontSize(11)
      .font('Helvetica-Bold')
      .fillColor(isPaid ? '#0f9d58' : '#b8860b')
      .text(isPaid ? 'PAID' : 'ISSUED', 0, 130, { align: 'right' })
      .fillColor('black');

    // Bill to
    doc
      .fontSize(11)
      .font('Helvetica-Bold')
      .text('Bill To', 50, 160)
      .font('Helvetica')
      .fontSize(10)
      .text(invoice.customerName)
      .text(invoice.customerEmail || '');

    // Line items table
    const tableTop = 230;
    const columns = {
      description: 50,
      qty: 320,
      unitPrice: 390,
      subtotal: 470,
    };

    doc
      .font('Helvetica-Bold')
      .fontSize(10)
      .text('Description', columns.description, tableTop)
      .text('Qty', columns.qty, tableTop)
      .text('Unit Price', columns.unitPrice, tableTop)
      .text('Subtotal', columns.subtotal, tableTop);

    doc
      .moveTo(50, tableTop + 15)
      .lineTo(545, tableTop + 15)
      .stroke();

    let y = tableTop + 25;
    doc.font('Helvetica').fontSize(10);
    for (const item of invoice.items || []) {
      if (item.type !== 'product') continue;
      const lineSubtotal =
        item.subtotal ??
        Number(item.quantity || 0) * Number(item.unitPrice || 0);
      doc
        .text(item.description, columns.description, y, { width: 260 })
        .text(String(item.quantity ?? ''), columns.qty, y)
        .text(
          item.unitPrice != null
            ? formatMoney(item.unitPrice, invoice.currency)
            : '',
          columns.unitPrice,
          y,
        )
        .text(formatMoney(lineSubtotal, invoice.currency), columns.subtotal, y);
      y += 20;
    }

    // Totals
    y += 15;
    doc.moveTo(350, y).lineTo(545, y).stroke();
    y += 10;

    const totalsRow = (label: string, value: number, bold = false) => {
      doc
        .font(bold ? 'Helvetica-Bold' : 'Helvetica')
        .fontSize(bold ? 12 : 10)
        .text(label, 350, y)
        .text(formatMoney(value, invoice.currency), columns.subtotal, y);
      y += bold ? 20 : 16;
    };

    totalsRow('Subtotal', invoice.subtotalAmount);
    if (invoice.discountAmount) totalsRow('Discount', -invoice.discountAmount);
    if (invoice.taxAmount) totalsRow('Tax', invoice.taxAmount);
    totalsRow('Total', invoice.amount, true);

    // Footer
    y += 20;
    doc
      .font('Helvetica-Bold')
      .fontSize(10)
      .text(`Payment Terms: ${invoice.paymentTerms}`, 50, y);
    if (invoice.notes) {
      y += 20;
      doc
        .font('Helvetica')
        .fontSize(9)
        .text(invoice.notes, 50, y, { width: 495 });
    }
  }
}
