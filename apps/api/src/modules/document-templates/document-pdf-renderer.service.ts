import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import {
  DEFAULT_DOCUMENT_TEMPLATE_CONFIG,
  DocumentTemplateConfig,
  UniversalDocumentData,
} from '@saas/shared';

function getFont(fontFamily: string, bold = false): string {
  if (fontFamily === 'Times-Roman') {
    return bold ? 'Times-Bold' : 'Times-Roman';
  }
  if (fontFamily === 'Courier') {
    return bold ? 'Courier-Bold' : 'Courier';
  }
  return bold ? 'Helvetica-Bold' : 'Helvetica';
}

function formatMoney(
  amount: number | undefined | null,
  currency = 'USD',
): string {
  if (amount == null) return '—';
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

function formatDate(value: Date | string | undefined | null): string {
  if (!value) return '—';
  const d = typeof value === 'string' ? new Date(value) : value;
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function getDocumentTitle(
  type: UniversalDocumentData['type'],
  customLabels?: DocumentTemplateConfig['header']['customLabels'],
): string {
  const labels = customLabels || {};
  switch (type) {
    case 'INVOICE':
      return labels.invoice || 'INVOICE';
    case 'QUOTE':
      return labels.quote || 'QUOTATION';
    case 'STATEMENT':
      return labels.statement || 'STATEMENT OF ACCOUNT';
    case 'DELIVERY_NOTE':
      return labels.deliveryNote || 'PACKING SLIP';
    case 'PURCHASE_ORDER':
      return labels.purchaseOrder || 'PURCHASE ORDER';
    default:
      return type;
  }
}

function getStatusColor(status: string): string {
  const s = status.toUpperCase();
  if (['PAID', 'APPROVED', 'DELIVERED', 'COMPLETED', 'ACTIVE'].includes(s)) {
    return '#16a34a'; // green
  }
  if (['ISSUED', 'SENT', 'DRAFT', 'PENDING', 'OPEN'].includes(s)) {
    return '#d97706'; // amber
  }
  if (['OVERDUE', 'CANCELLED', 'REJECTED', 'VOID'].includes(s)) {
    return '#dc2626'; // red
  }
  return '#4b5563'; // neutral gray
}

async function safeFetchImageBuffer(url?: string): Promise<Buffer | null> {
  if (!url || typeof url !== 'string') return null;
  const trimmed = url.trim();
  if (!trimmed) return null;

  try {
    if (trimmed.startsWith('data:image/')) {
      const commaIdx = trimmed.indexOf(',');
      if (commaIdx !== -1) {
        return Buffer.from(trimmed.substring(commaIdx + 1), 'base64');
      }
    }
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 1000);
      try {
        const res = await fetch(trimmed, {
          signal: controller.signal,
        });
        if (!res.ok) return null;
        const arrayBuffer = await res.arrayBuffer();
        return Buffer.from(arrayBuffer);
      } finally {
        clearTimeout(timer);
      }
    }
  } catch {
    return null;
  }
  return null;
}

interface TableColumn {
  id: string;
  label: string;
  width: number;
  align: 'left' | 'right' | 'center';
  x: number;
}

@Injectable()
export class DocumentPdfRendererService {
  async render(
    docData: UniversalDocumentData,
    templateConfig?: DocumentTemplateConfig,
  ): Promise<Buffer> {
    const config: DocumentTemplateConfig = {
      ...DEFAULT_DOCUMENT_TEMPLATE_CONFIG,
      ...(templateConfig || {}),
      branding: {
        ...DEFAULT_DOCUMENT_TEMPLATE_CONFIG.branding,
        ...(templateConfig?.branding || {}),
        margins: {
          ...DEFAULT_DOCUMENT_TEMPLATE_CONFIG.branding.margins,
          ...(templateConfig?.branding?.margins || {}),
        },
      },
      header: {
        ...DEFAULT_DOCUMENT_TEMPLATE_CONFIG.header,
        ...(templateConfig?.header || {}),
        customLabels: {
          ...DEFAULT_DOCUMENT_TEMPLATE_CONFIG.header.customLabels,
          ...(templateConfig?.header?.customLabels || {}),
        },
      },
      parties: {
        ...DEFAULT_DOCUMENT_TEMPLATE_CONFIG.parties,
        ...(templateConfig?.parties || {}),
      },
      itemsTable: {
        ...DEFAULT_DOCUMENT_TEMPLATE_CONFIG.itemsTable,
        ...(templateConfig?.itemsTable || {}),
      },
      totals: {
        ...DEFAULT_DOCUMENT_TEMPLATE_CONFIG.totals,
        ...(templateConfig?.totals || {}),
      },
      footer: {
        ...DEFAULT_DOCUMENT_TEMPLATE_CONFIG.footer,
        ...(templateConfig?.footer || {}),
        bankDetails: {
          ...DEFAULT_DOCUMENT_TEMPLATE_CONFIG.footer.bankDetails,
          ...(templateConfig?.footer?.bankDetails || {}),
        },
      },
    };

    // Pre-fetch logo safely if enabled
    let logoBuffer: Buffer | null = null;
    if (config.header.showLogo && docData.organization?.logoUrl) {
      logoBuffer = await safeFetchImageBuffer(docData.organization.logoUrl);
    }

    return new Promise((resolve, reject) => {
      try {
        const margins = {
          top: config.branding.margins.top ?? 40,
          bottom: config.branding.margins.bottom ?? 40,
          left: config.branding.margins.left ?? 40,
          right: config.branding.margins.right ?? 40,
        };

        const doc = new PDFDocument({
          size: 'A4',
          margins,
          bufferPages: true,
        });

        const chunks: Buffer[] = [];
        doc.on('data', (chunk: Buffer) => chunks.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);

        const pageWidth = doc.page.width;
        const pageHeight = doc.page.height;
        const contentWidth = pageWidth - margins.left - margins.right;

        const primaryColor = config.branding.primaryColor || '#1e3a8a';
        const secondaryColor = config.branding.secondaryColor || '#64748b';
        const fontFamily = config.branding.fontFamily || 'Helvetica';
        const regularFont = getFont(fontFamily, false);
        const boldFont = getFont(fontFamily, true);

        const density = config.branding.layoutDensity || 'normal';
        const rowPadding =
          density === 'compact' ? 3 : density === 'relaxed' ? 7 : 5;
        const tableFontSize =
          density === 'compact' ? 8.5 : density === 'relaxed' ? 9.5 : 9;

        const docTitle = getDocumentTitle(
          docData.type,
          config.header.customLabels,
        );

        let y = margins.top;

        // --- 1. HEADER SECTION ---
        if (config.header.layout === 'banner') {
          // Banner layout: colored bar across top
          const bannerHeight = 52;
          doc.rect(0, 0, pageWidth, bannerHeight).fill(primaryColor);

          // In banner: Company Name or Logo on left, Document Title on right
          let logoDrawn = false;
          if (logoBuffer && config.header.showLogo) {
            try {
              doc.image(logoBuffer, margins.left, 8, { fit: [120, 36] });
              logoDrawn = true;
            } catch {
              logoDrawn = false;
            }
          }
          if (!logoDrawn) {
            doc
              .font(boldFont)
              .fontSize(15)
              .fillColor('#ffffff')
              .text(docData.organization.name, margins.left, 16, {
                width: contentWidth / 2,
              });
          }

          doc
            .font(boldFont)
            .fontSize(16)
            .fillColor('#ffffff')
            .text(docTitle, margins.left + contentWidth / 2, 16, {
              width: contentWidth / 2,
              align: 'right',
            });

          y = bannerHeight + 14;

          // Below banner: company info on left, metadata & status badge on right
          const leftW = contentWidth * 0.55;
          const rightX = margins.left + leftW + 10;
          const rightW = contentWidth - leftW - 10;

          const metaStartY = y;
          doc.font(regularFont).fontSize(8.5).fillColor('#475569');
          if (
            config.header.showCompanyAddress &&
            docData.organization.address
          ) {
            doc.text(docData.organization.address, margins.left, doc.y, {
              width: leftW,
            });
          }
          if (config.header.showCompanyPhone && docData.organization.phone) {
            doc.text(
              `Phone: ${docData.organization.phone}`,
              margins.left,
              doc.y,
              { width: leftW },
            );
          }
          if (config.header.showCompanyEmail && docData.organization.email) {
            doc.text(
              `Email: ${docData.organization.email}`,
              margins.left,
              doc.y,
              { width: leftW },
            );
          }
          if (config.header.showCompanyTaxId && docData.organization.taxId) {
            doc.text(
              `Tax ID: ${docData.organization.taxId}`,
              margins.left,
              doc.y,
              { width: leftW },
            );
          }
          const leftEndY = doc.y;

          let rY = metaStartY;
          doc.font(boldFont).fontSize(10).fillColor('#1e293b');
          doc.text(docData.number, rightX, rY, {
            width: rightW,
            align: 'right',
          });
          rY = doc.y + 2;

          doc.font(regularFont).fontSize(8.5).fillColor(secondaryColor);
          doc.text(`Issued: ${formatDate(docData.issuedAt)}`, rightX, rY, {
            width: rightW,
            align: 'right',
          });
          rY = doc.y + 2;

          if (docData.dueDate) {
            doc.text(`Due: ${formatDate(docData.dueDate)}`, rightX, rY, {
              width: rightW,
              align: 'right',
            });
            rY = doc.y + 2;
          }
          if (docData.validUntil) {
            doc.text(
              `Valid Until: ${formatDate(docData.validUntil)}`,
              rightX,
              rY,
              { width: rightW, align: 'right' },
            );
            rY = doc.y + 2;
          }

          // Status Badge
          const statusText = docData.status.toUpperCase().replace(/_/g, ' ');
          doc.font(boldFont).fontSize(8);
          const badgeWidth = Math.max(54, doc.widthOfString(statusText) + 14);
          const badgeHeight = 15;
          const badgeX = margins.left + contentWidth - badgeWidth;
          const statusCol = getStatusColor(docData.status);
          doc
            .roundedRect(badgeX, rY + 3, badgeWidth, badgeHeight, 3)
            .fill(statusCol);
          doc
            .font(boldFont)
            .fontSize(8)
            .fillColor('#ffffff')
            .text(statusText, badgeX, rY + 6.5, {
              width: badgeWidth,
              align: 'center',
            });

          y = Math.max(leftEndY, rY + badgeHeight + 10) + 14;
        } else if (config.header.layout === 'centered') {
          // Centered layout
          let logoDrawn = false;
          if (logoBuffer && config.header.showLogo) {
            try {
              const logoW = 120;
              const logoX = margins.left + (contentWidth - logoW) / 2;
              doc.image(logoBuffer, logoX, y, { fit: [logoW, 40] });
              y += 44;
              logoDrawn = true;
            } catch {
              logoDrawn = false;
            }
          }
          if (!logoDrawn) {
            doc
              .font(boldFont)
              .fontSize(16)
              .fillColor(primaryColor)
              .text(docData.organization.name, margins.left, y, {
                width: contentWidth,
                align: 'center',
              });
            y = doc.y + 4;
          }

          doc.font(regularFont).fontSize(8.5).fillColor('#475569');
          const compLines: string[] = [];
          if (config.header.showCompanyAddress && docData.organization.address)
            compLines.push(docData.organization.address);
          const contactParts: string[] = [];
          if (config.header.showCompanyPhone && docData.organization.phone)
            contactParts.push(`Phone: ${docData.organization.phone}`);
          if (config.header.showCompanyEmail && docData.organization.email)
            contactParts.push(`Email: ${docData.organization.email}`);
          if (contactParts.length) compLines.push(contactParts.join(' | '));
          if (config.header.showCompanyTaxId && docData.organization.taxId)
            compLines.push(`Tax ID: ${docData.organization.taxId}`);

          for (const line of compLines) {
            doc.text(line, margins.left, y, {
              width: contentWidth,
              align: 'center',
            });
            y = doc.y + 2;
          }

          y += 6;
          doc
            .moveTo(margins.left, y)
            .lineTo(margins.left + contentWidth, y)
            .strokeColor('#e2e8f0')
            .stroke();
          y += 10;

          // Title & Doc number centered
          doc
            .font(boldFont)
            .fontSize(16)
            .fillColor(primaryColor)
            .text(docTitle, margins.left, y, {
              width: contentWidth,
              align: 'center',
            });
          y = doc.y + 2;

          doc
            .font(boldFont)
            .fontSize(10)
            .fillColor('#1e293b')
            .text(docData.number, margins.left, y, {
              width: contentWidth,
              align: 'center',
            });
          y = doc.y + 3;

          const dateParts: string[] = [
            `Issued: ${formatDate(docData.issuedAt)}`,
          ];
          if (docData.dueDate)
            dateParts.push(`Due: ${formatDate(docData.dueDate)}`);
          if (docData.validUntil)
            dateParts.push(`Valid Until: ${formatDate(docData.validUntil)}`);
          doc
            .font(regularFont)
            .fontSize(8.5)
            .fillColor(secondaryColor)
            .text(dateParts.join('  •  '), margins.left, y, {
              width: contentWidth,
              align: 'center',
            });
          y = doc.y + 4;

          // Status Badge centered
          const statusText = docData.status.toUpperCase().replace(/_/g, ' ');
          doc.font(boldFont).fontSize(8);
          const badgeWidth = Math.max(54, doc.widthOfString(statusText) + 14);
          const badgeHeight = 15;
          const badgeX = margins.left + (contentWidth - badgeWidth) / 2;
          const statusCol = getStatusColor(docData.status);
          doc
            .roundedRect(badgeX, y, badgeWidth, badgeHeight, 3)
            .fill(statusCol);
          doc
            .font(boldFont)
            .fontSize(8)
            .fillColor('#ffffff')
            .text(statusText, badgeX, y + 3.5, {
              width: badgeWidth,
              align: 'center',
            });
          y += badgeHeight + 14;
        } else {
          // Default: 'split' layout
          const leftW = contentWidth * 0.55;
          const rightX = margins.left + leftW + 10;
          const rightW = contentWidth - leftW - 10;

          const startY = y;
          let logoDrawn = false;
          if (logoBuffer && config.header.showLogo) {
            try {
              doc.image(logoBuffer, margins.left, y, { fit: [140, 42] });
              y += 46;
              logoDrawn = true;
            } catch {
              logoDrawn = false;
            }
          }

          if (!logoDrawn) {
            doc
              .font(boldFont)
              .fontSize(16)
              .fillColor(primaryColor)
              .text(docData.organization.name, margins.left, y, {
                width: leftW,
              });
            y = doc.y + 3;
          }

          doc.font(regularFont).fontSize(8.5).fillColor('#475569');
          if (
            config.header.showCompanyAddress &&
            docData.organization.address
          ) {
            doc.text(docData.organization.address, margins.left, y, {
              width: leftW,
            });
            y = doc.y + 2;
          }
          if (config.header.showCompanyPhone && docData.organization.phone) {
            doc.text(`Phone: ${docData.organization.phone}`, margins.left, y, {
              width: leftW,
            });
            y = doc.y + 2;
          }
          if (config.header.showCompanyEmail && docData.organization.email) {
            doc.text(`Email: ${docData.organization.email}`, margins.left, y, {
              width: leftW,
            });
            y = doc.y + 2;
          }
          if (config.header.showCompanyTaxId && docData.organization.taxId) {
            doc.text(`Tax ID: ${docData.organization.taxId}`, margins.left, y, {
              width: leftW,
            });
            y = doc.y + 2;
          }
          const leftEndY = y;

          let rY = startY;
          doc.font(boldFont).fontSize(18).fillColor(primaryColor);
          doc.text(docTitle, rightX, rY, { width: rightW, align: 'right' });
          rY = doc.y + 2;

          doc.font(boldFont).fontSize(10).fillColor('#1e293b');
          doc.text(docData.number, rightX, rY, {
            width: rightW,
            align: 'right',
          });
          rY = doc.y + 3;

          doc.font(regularFont).fontSize(8.5).fillColor(secondaryColor);
          doc.text(`Issued: ${formatDate(docData.issuedAt)}`, rightX, rY, {
            width: rightW,
            align: 'right',
          });
          rY = doc.y + 2;

          if (docData.dueDate) {
            doc.text(`Due: ${formatDate(docData.dueDate)}`, rightX, rY, {
              width: rightW,
              align: 'right',
            });
            rY = doc.y + 2;
          }
          if (docData.validUntil) {
            doc.text(
              `Valid Until: ${formatDate(docData.validUntil)}`,
              rightX,
              rY,
              { width: rightW, align: 'right' },
            );
            rY = doc.y + 2;
          }

          // Status Badge
          const statusText = docData.status.toUpperCase().replace(/_/g, ' ');
          doc.font(boldFont).fontSize(8);
          const badgeWidth = Math.max(54, doc.widthOfString(statusText) + 14);
          const badgeHeight = 15;
          const badgeX = margins.left + contentWidth - badgeWidth;
          const statusCol = getStatusColor(docData.status);
          doc
            .roundedRect(badgeX, rY + 3, badgeWidth, badgeHeight, 3)
            .fill(statusCol);
          doc
            .font(boldFont)
            .fontSize(8)
            .fillColor('#ffffff')
            .text(statusText, badgeX, rY + 6.5, {
              width: badgeWidth,
              align: 'center',
            });

          y = Math.max(leftEndY, rY + badgeHeight + 10) + 14;
        }

        // --- 2. PARTIES SECTION ---
        const partiesY = y;
        const colW = (contentWidth - 20) / 2;

        let partyLabel = config.parties.billToLabel;
        if (docData.type === 'PURCHASE_ORDER') {
          partyLabel = config.parties.supplierLabel;
        } else if (docData.type === 'DELIVERY_NOTE') {
          partyLabel = config.parties.shipToLabel;
        }

        doc
          .font(boldFont)
          .fontSize(8.5)
          .fillColor(secondaryColor)
          .text(partyLabel.toUpperCase(), margins.left, partiesY);
        let pY = partiesY + 12;

        doc
          .font(boldFont)
          .fontSize(9.5)
          .fillColor('#0f172a')
          .text(docData.party.name, margins.left, pY, { width: colW });
        pY = doc.y + 2;

        if (
          docData.party.companyName &&
          docData.party.companyName !== docData.party.name
        ) {
          doc
            .font(regularFont)
            .fontSize(8.5)
            .fillColor('#334155')
            .text(docData.party.companyName, margins.left, pY, { width: colW });
          pY = doc.y + 2;
        }
        if (config.parties.showAddress && docData.party.address) {
          doc
            .font(regularFont)
            .fontSize(8.5)
            .fillColor('#475569')
            .text(docData.party.address, margins.left, pY, { width: colW });
          pY = doc.y + 2;
        }
        if (config.parties.showEmail && docData.party.email) {
          doc
            .font(regularFont)
            .fontSize(8.5)
            .fillColor('#475569')
            .text(docData.party.email, margins.left, pY, { width: colW });
          pY = doc.y + 2;
        }
        if (config.parties.showPhone && docData.party.phone) {
          doc
            .font(regularFont)
            .fontSize(8.5)
            .fillColor('#475569')
            .text(docData.party.phone, margins.left, pY, { width: colW });
          pY = doc.y + 2;
        }
        if (config.parties.showTaxId && docData.party.taxId) {
          doc
            .font(regularFont)
            .fontSize(8.5)
            .fillColor('#475569')
            .text(`Tax ID: ${docData.party.taxId}`, margins.left, pY, {
              width: colW,
            });
          pY = doc.y + 2;
        }

        let secEndY = partiesY;
        if (docData.secondaryParty) {
          const secX = margins.left + colW + 20;
          doc
            .font(boldFont)
            .fontSize(8.5)
            .fillColor(secondaryColor)
            .text(
              (
                docData.secondaryParty.label || config.parties.shipToLabel
              ).toUpperCase(),
              secX,
              partiesY,
            );
          let sY = partiesY + 12;

          doc
            .font(boldFont)
            .fontSize(9.5)
            .fillColor('#0f172a')
            .text(docData.secondaryParty.name, secX, sY, { width: colW });
          sY = doc.y + 2;

          if (docData.secondaryParty.address) {
            doc
              .font(regularFont)
              .fontSize(8.5)
              .fillColor('#475569')
              .text(docData.secondaryParty.address, secX, sY, { width: colW });
            sY = doc.y + 2;
          }
          if (docData.secondaryParty.carrier) {
            doc
              .font(regularFont)
              .fontSize(8.5)
              .fillColor('#475569')
              .text(`Carrier: ${docData.secondaryParty.carrier}`, secX, sY, {
                width: colW,
              });
            sY = doc.y + 2;
          }
          if (docData.secondaryParty.trackingReference) {
            doc
              .font(regularFont)
              .fontSize(8.5)
              .fillColor('#475569')
              .text(
                `Tracking: ${docData.secondaryParty.trackingReference}`,
                secX,
                sY,
                { width: colW },
              );
            sY = doc.y + 2;
          }
          secEndY = sY;
        }

        y = Math.max(pY, secEndY) + 16;

        // --- 3. ITEMS TABLE ---
        const t = config.itemsTable;
        const columns: TableColumn[] = [];

        const codeWidth = t.showItemCode ? 65 : 0;
        const qtyWidth = t.showQuantity ? 45 : 0;
        const priceWidth = t.showUnitPrice ? 65 : 0;
        const discountWidth = t.showDiscount ? 48 : 0;
        const taxWidth = t.showTaxRate ? 45 : 0;
        const totalColWidth = t.showLineTotal ? 70 : 0;

        const fixedSum =
          codeWidth +
          qtyWidth +
          priceWidth +
          discountWidth +
          taxWidth +
          totalColWidth;
        const descWidth = Math.max(100, contentWidth - fixedSum);

        if (t.showItemCode) {
          columns.push({
            id: 'code',
            label: 'Item / Code',
            width: codeWidth,
            align: 'left',
            x: 0,
          });
        }
        if (t.showDescription) {
          columns.push({
            id: 'description',
            label: 'Description',
            width: descWidth,
            align: 'left',
            x: 0,
          });
        }
        if (t.showQuantity) {
          columns.push({
            id: 'quantity',
            label: 'Qty',
            width: qtyWidth,
            align: 'right',
            x: 0,
          });
        }
        if (t.showUnitPrice) {
          columns.push({
            id: 'unitPrice',
            label: 'Unit Price',
            width: priceWidth,
            align: 'right',
            x: 0,
          });
        }
        if (t.showDiscount) {
          columns.push({
            id: 'discount',
            label: 'Disc %',
            width: discountWidth,
            align: 'right',
            x: 0,
          });
        }
        if (t.showTaxRate) {
          columns.push({
            id: 'taxRate',
            label: 'Tax %',
            width: taxWidth,
            align: 'right',
            x: 0,
          });
        }
        if (t.showLineTotal) {
          columns.push({
            id: 'lineTotal',
            label: 'Total',
            width: totalColWidth,
            align: 'right',
            x: 0,
          });
        }

        // Calculate column X coordinates
        let cX = margins.left;
        for (const col of columns) {
          col.x = cX;
          cX += col.width;
        }

        const renderTableHeader = (headerY: number): number => {
          const headerHeight = 20;
          if (config.itemsTable.headerBackgroundColor) {
            doc
              .rect(margins.left, headerY, contentWidth, headerHeight)
              .fill(config.itemsTable.headerBackgroundColor);
          } else {
            doc
              .rect(margins.left, headerY, contentWidth, headerHeight)
              .fill('#f1f5f9');
          }

          const headerTextColor =
            config.itemsTable.headerTextColor ||
            (config.itemsTable.headerBackgroundColor
              ? '#ffffff'
              : primaryColor);

          doc.font(boldFont).fontSize(8.5).fillColor(headerTextColor);

          for (const col of columns) {
            const pad = col.align === 'right' ? 4 : 4;
            const x = col.align === 'right' ? col.x : col.x + pad;
            const w = col.width - 8;
            doc.text(col.label, x, headerY + 5.5, {
              width: w,
              align: col.align,
            });
          }

          const afterHeaderY = headerY + headerHeight;
          doc
            .moveTo(margins.left, afterHeaderY)
            .lineTo(margins.left + contentWidth, afterHeaderY)
            .strokeColor('#cbd5e1')
            .stroke();
          return afterHeaderY + 2;
        };

        y = renderTableHeader(y);

        const descCol = columns.find((c) => c.id === 'description');

        if (docData.items && docData.items.length > 0) {
          for (let i = 0; i < docData.items.length; i++) {
            const item = docData.items[i];

            let itemDescHeight = 12;
            if (descCol && item.description) {
              doc.font(regularFont).fontSize(tableFontSize);
              itemDescHeight = doc.heightOfString(item.description, {
                width: descCol.width - 8,
              });
            }
            const rowHeight = Math.max(16, itemDescHeight + rowPadding * 2);

            // Pagination threshold
            if (y + rowHeight > pageHeight - margins.bottom - 45) {
              doc.addPage({
                size: 'A4',
                margins,
              });
              y = margins.top;
              y = renderTableHeader(y);
            }

            // Zebra striping
            if (config.itemsTable.zebraStriping && i % 2 === 1) {
              doc
                .rect(margins.left, y, contentWidth, rowHeight)
                .fill('#f8fafc');
            }

            doc.font(regularFont).fontSize(tableFontSize).fillColor('#1e293b');

            for (const col of columns) {
              const pad = 4;
              const cellW = col.width - pad * 2;
              const cellX = col.x + pad;
              const cellY = y + rowPadding;

              let cellText = '—';
              switch (col.id) {
                case 'code':
                  cellText = item.code || '—';
                  break;
                case 'description':
                  cellText = item.description || '';
                  break;
                case 'quantity':
                  cellText =
                    item.quantity != null ? String(item.quantity) : '—';
                  break;
                case 'unitPrice':
                  cellText =
                    item.unitPrice != null
                      ? formatMoney(item.unitPrice, docData.currency)
                      : '—';
                  break;
                case 'discount':
                  cellText = item.discount != null ? `${item.discount}%` : '—';
                  break;
                case 'taxRate':
                  cellText = item.taxRate != null ? `${item.taxRate}%` : '—';
                  break;
                case 'lineTotal':
                  cellText =
                    item.amount != null
                      ? formatMoney(item.amount, docData.currency)
                      : '—';
                  break;
              }

              doc.text(cellText, cellX, cellY, {
                width: cellW,
                align: col.align,
              });
            }

            y += rowHeight;

            // Row separator
            doc
              .moveTo(margins.left, y)
              .lineTo(margins.left + contentWidth, y)
              .strokeColor('#f1f5f9')
              .stroke();
          }
        } else {
          doc
            .font(regularFont)
            .fontSize(8.5)
            .fillColor('#94a3b8')
            .text('No line items recorded.', margins.left + 6, y + 6);
          y += 22;
        }

        // --- 4. STATEMENT SUMMARY & AGING TABLE ---
        if (docData.type === 'STATEMENT' && docData.statementSummary) {
          const summary = docData.statementSummary;
          if (y + 110 > pageHeight - margins.bottom - 45) {
            doc.addPage({ size: 'A4', margins });
            y = margins.top;
          }

          y += 12;
          doc
            .font(boldFont)
            .fontSize(9)
            .fillColor(primaryColor)
            .text('ACCOUNT SUMMARY', margins.left, y);
          y += 13;

          const summaryBoxW = contentWidth / 3;
          doc.rect(margins.left, y, contentWidth, 34).fill('#f8fafc');
          doc
            .rect(margins.left, y, contentWidth, 34)
            .strokeColor('#e2e8f0')
            .stroke();

          doc.font(boldFont).fontSize(7.5).fillColor(secondaryColor);
          doc.text('STATEMENT PERIOD', margins.left + 8, y + 5);
          doc.text('OPENING BALANCE', margins.left + summaryBoxW + 8, y + 5);
          doc.text(
            'CLOSING BALANCE',
            margins.left + summaryBoxW * 2 + 8,
            y + 5,
          );

          doc.font(regularFont).fontSize(8.5).fillColor('#0f172a');
          doc.text(
            `${formatDate(summary.periodFrom)} - ${formatDate(summary.periodTo)}`,
            margins.left + 8,
            y + 17,
          );
          doc.text(
            formatMoney(summary.openingBalance, docData.currency),
            margins.left + summaryBoxW + 8,
            y + 17,
          );
          doc
            .font(boldFont)
            .text(
              formatMoney(summary.closingBalance, docData.currency),
              margins.left + summaryBoxW * 2 + 8,
              y + 17,
            );

          y += 42;

          doc
            .font(boldFont)
            .fontSize(9)
            .fillColor(primaryColor)
            .text('AGING BREAKDOWN', margins.left, y);
          y += 13;

          const agingCols = [
            { label: 'Current', value: summary.aging.current },
            { label: '1-30 Days', value: summary.aging.days30 },
            { label: '31-60 Days', value: summary.aging.days60 },
            { label: '61-90 Days', value: (summary.aging as any).days90 ?? 0 },
            { label: '90+ Days', value: summary.aging.days90Plus },
          ];

          const agingColW = contentWidth / agingCols.length;
          doc.rect(margins.left, y, contentWidth, 34).fill('#f1f5f9');
          doc
            .rect(margins.left, y, contentWidth, 34)
            .strokeColor('#cbd5e1')
            .stroke();

          for (let j = 0; j < agingCols.length; j++) {
            const ac = agingCols[j];
            const ax = margins.left + j * agingColW;
            doc
              .font(boldFont)
              .fontSize(7.5)
              .fillColor(secondaryColor)
              .text(ac.label, ax, y + 5, { width: agingColW, align: 'center' });
            doc
              .font(boldFont)
              .fontSize(8.5)
              .fillColor('#0f172a')
              .text(formatMoney(ac.value, docData.currency), ax, y + 17, {
                width: agingColW,
                align: 'center',
              });
          }

          y += 44;
        }

        // --- 5. TOTALS SECTION ---
        if (docData.totals) {
          if (y + 110 > pageHeight - margins.bottom - 45) {
            doc.addPage({ size: 'A4', margins });
            y = margins.top;
          }

          y += 10;
          const totalsWidth = 230;
          const totalsX = margins.left + contentWidth - totalsWidth;
          const labelWidth = 115;
          const valueWidth = 115;

          const renderTotalLine = (
            label: string,
            valueStr: string,
            isHighlighted = false,
          ) => {
            doc
              .font(isHighlighted ? boldFont : regularFont)
              .fontSize(isHighlighted ? 11 : 9)
              .fillColor(isHighlighted ? primaryColor : '#334155')
              .text(label, totalsX, y, { width: labelWidth, align: 'left' })
              .text(valueStr, totalsX + labelWidth, y, {
                width: valueWidth,
                align: 'right',
              });
            y += isHighlighted ? 16 : 14;
          };

          if (config.totals.showSubtotal && docData.totals.subtotal != null) {
            renderTotalLine(
              'Subtotal:',
              formatMoney(docData.totals.subtotal, docData.currency),
            );
          }
          if (
            config.totals.showDiscountTotal &&
            docData.totals.discounts != null &&
            docData.totals.discounts > 0
          ) {
            renderTotalLine(
              'Discount:',
              `-${formatMoney(docData.totals.discounts, docData.currency)}`,
            );
          }
          if (
            config.totals.showTaxSummary &&
            docData.totals.taxes &&
            docData.totals.taxes.length > 0
          ) {
            for (const tax of docData.totals.taxes) {
              renderTotalLine(
                `${tax.label} (${tax.rate}%):`,
                formatMoney(tax.amount, docData.currency),
              );
            }
          }

          doc
            .moveTo(totalsX, y + 2)
            .lineTo(totalsX + totalsWidth, y + 2)
            .strokeColor('#cbd5e1')
            .stroke();
          y += 6;

          if (config.totals.highlightTotal) {
            renderTotalLine(
              'Total:',
              formatMoney(docData.totals.total, docData.currency),
              true,
            );
          } else {
            renderTotalLine(
              'Total:',
              formatMoney(docData.totals.total, docData.currency),
              false,
            );
          }

          if (
            config.totals.showAmountPaid &&
            docData.totals.amountPaid != null
          ) {
            renderTotalLine(
              'Amount Paid:',
              formatMoney(docData.totals.amountPaid, docData.currency),
            );
          }
          if (
            config.totals.showBalanceDue &&
            docData.totals.balanceDue != null
          ) {
            doc
              .moveTo(totalsX, y + 2)
              .lineTo(totalsX + totalsWidth, y + 2)
              .strokeColor('#cbd5e1')
              .stroke();
            y += 4;
            renderTotalLine(
              'Balance Due:',
              formatMoney(docData.totals.balanceDue, docData.currency),
              true,
            );
          }
        }

        // --- 6. FOOTER / NOTES / BANK DETAILS / SIGNATURE ---
        if (y + 90 > pageHeight - margins.bottom - 45) {
          doc.addPage({ size: 'A4', margins });
          y = margins.top;
        }

        y += 12;

        const terms = docData.paymentTerms || config.footer.paymentTerms;
        if (terms) {
          doc
            .font(boldFont)
            .fontSize(8.5)
            .fillColor('#1e293b')
            .text('Payment Terms: ', margins.left, y, { continued: true });
          doc.font(regularFont).fillColor('#475569').text(terms);
          y = doc.y + 4;
        }

        const notes = docData.notes || config.footer.notes;
        if (notes) {
          doc
            .font(boldFont)
            .fontSize(8.5)
            .fillColor('#1e293b')
            .text('Notes: ', margins.left, y, { continued: true });
          doc.font(regularFont).fillColor('#475569').text(notes);
          y = doc.y + 4;
        }

        const bank = config.footer.bankDetails;
        const hasBankDetails =
          bank &&
          (bank.bankName ||
            bank.accountNumber ||
            bank.routingOrIban ||
            bank.swiftBic);
        if (hasBankDetails) {
          y += 6;
          doc
            .font(boldFont)
            .fontSize(8.5)
            .fillColor(primaryColor)
            .text('BANK DETAILS', margins.left, y);
          y += 11;
          doc.font(regularFont).fontSize(8).fillColor('#475569');
          if (bank.bankName) {
            doc.text(`Bank: ${bank.bankName}`, margins.left, y);
            y += 10;
          }
          if (bank.accountName) {
            doc.text(`Account Name: ${bank.accountName}`, margins.left, y);
            y += 10;
          }
          if (bank.accountNumber) {
            doc.text(`Account Number: ${bank.accountNumber}`, margins.left, y);
            y += 10;
          }
          if (bank.routingOrIban) {
            doc.text(`IBAN / Routing: ${bank.routingOrIban}`, margins.left, y);
            y += 10;
          }
          if (bank.swiftBic) {
            doc.text(`SWIFT / BIC: ${bank.swiftBic}`, margins.left, y);
            y += 10;
          }
        }

        if (config.footer.showSignatureBlock) {
          if (y + 55 > pageHeight - margins.bottom - 40) {
            doc.addPage({ size: 'A4', margins });
            y = margins.top;
          }
          y += 18;
          const sigW = 180;
          const sigX = margins.left + contentWidth - sigW;
          doc
            .moveTo(sigX, y + 22)
            .lineTo(sigX + sigW, y + 22)
            .strokeColor('#94a3b8')
            .stroke();
          doc
            .font(regularFont)
            .fontSize(8)
            .fillColor('#64748b')
            .text(
              config.footer.signatureLabel || 'Authorized Signature',
              sigX,
              y + 26,
              {
                width: sigW,
                align: 'center',
              },
            );
          y += 40;
        }

        // --- 7. TWO-PASS PAGE NUMBERING ---
        if (config.footer.showPageNumbers) {
          const pageRange = doc.bufferedPageRange();
          for (
            let i = pageRange.start;
            i < pageRange.start + pageRange.count;
            i++
          ) {
            doc.switchToPage(i);
            const pageNum = i - pageRange.start + 1;
            const totalPages = pageRange.count;
            doc
              .font(regularFont)
              .fontSize(7.5)
              .fillColor(secondaryColor)
              .text(
                `Page ${pageNum} of ${totalPages}`,
                margins.left,
                pageHeight - margins.bottom + 12,
                {
                  width: contentWidth,
                  align: 'center',
                },
              );
          }
        }

        doc.end();
      } catch (err) {
        reject(err);
      }
    });
  }
}
