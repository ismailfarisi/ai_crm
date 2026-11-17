import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import {
  arabicTaxLabel,
  DEFAULT_DOCUMENT_TEMPLATE_CONFIG,
  DOCUMENT_LABELS,
  DOCUMENT_STATUS_LABELS_AR,
  DOCUMENT_TIME_ZONE,
  documentLabel,
  DocumentLabelKey,
  DocumentLanguage,
  DocumentTemplateConfig,
  formatPaymentTerms,
  formatTaxLineLabel,
  isRtlDocument,
  localizedLabel,
  toArabicIndicDigits,
  UniversalDocumentData,
} from '@saas/shared';
import { hasRtl, isolateLtr } from './pdf/bidi-text';
import { installDocumentText } from './pdf/document-text';

/**
 * Characters the built-in PDF fonts can print besides Latin-1: the
 * Windows-1252 extras (curly quotes, dashes, bullet, euro, ...). Anything else
 * pdfkit writes as raw bytes, which shows up as junk or nothing at all.
 */
const WIN_ANSI_EXTRAS = new Set(
  '\u20ac\u201a\u0192\u201e\u2026\u2020\u2021\u02c6\u2030\u0160\u2039\u0152\u017d' +
    '\u2018\u2019\u201c\u201d\u2022\u2013\u2014\u02dc\u2122\u0161\u203a\u0153\u017e\u0178',
);

const PDF_TEXT_SUBSTITUTES: Record<string, string> = {
  '\u2010': '-', // hyphen
  '\u2011': '-', // non-breaking hyphen
  '\u2012': '\u2013', // figure dash
  '\u2015': '\u2014', // horizontal bar
  '\u2212': '-', // minus sign
  '\u2009': ' ', // thin space
  '\u202f': ' ', // narrow no-break space
  '\u2002': ' ',
  '\u2003': ' ',
  '\u200b': '', // zero-width space
  '\u2032': "'",
  '\u2033': '"',
  '\u2190': '<-',
  '\u2192': '->',
  '\u2264': '<=',
  '\u2265': '>=',
  '\u2248': '~',
  '\u2260': '!=',
  '\u2713': 'v',
  '\u2714': 'v',
};

/**
 * Maps text onto what the built-in (WinAnsi) PDF fonts can print: supported
 * characters pass through, a few look-alikes are swapped in, accents the font
 * lacks are dropped, and anything left becomes "?" rather than garbage.
 */
export function toPdfText(text: string): string {
  let out = '';
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    if (
      code < 0x7f ||
      (code >= 0xa0 && code <= 0xff) ||
      WIN_ANSI_EXTRAS.has(ch)
    ) {
      out += ch;
    } else if (ch in PDF_TEXT_SUBSTITUTES) {
      out += PDF_TEXT_SUBSTITUTES[ch];
    } else {
      const base = ch.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
      out +=
        base && [...base].every((c) => c.codePointAt(0)! < 0x7f) ? base : '?';
    }
  }
  return out;
}

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

function formatDate(
  value: Date | string | undefined | null,
  arabic = false,
): string {
  if (!value) return '—';
  const d = typeof value === 'string' ? new Date(value) : value;
  if (isNaN(d.getTime())) return '—';
  // Arabic month names, Western digits unless the template asks otherwise.
  return d.toLocaleDateString(arabic ? 'ar-AE-u-nu-latn' : 'en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: DOCUMENT_TIME_ZONE,
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

function getArabicDocumentTitle(
  type: UniversalDocumentData['type'],
  taxRegistered: boolean,
): string {
  switch (type) {
    case 'INVOICE':
      return taxRegistered
        ? DOCUMENT_LABELS.taxInvoice.ar
        : DOCUMENT_LABELS.invoice.ar;
    case 'QUOTE':
      return DOCUMENT_LABELS.quote.ar;
    case 'STATEMENT':
      return DOCUMENT_LABELS.statement.ar;
    case 'DELIVERY_NOTE':
      return DOCUMENT_LABELS.deliveryNote.ar;
    case 'PURCHASE_ORDER':
      return DOCUMENT_LABELS.purchaseOrder.ar;
    default:
      return type;
  }
}

/**
 * The title in the document's language. A UAE invoice from a VAT-registered
 * seller is a tax invoice; the English title keeps any custom label.
 */
function getLocalizedDocumentTitle(
  type: UniversalDocumentData['type'],
  customLabels: DocumentTemplateConfig['header']['customLabels'] | undefined,
  language: DocumentLanguage,
  taxRegistered: boolean,
  joiner: string,
): string {
  if (language === 'en') return getDocumentTitle(type, customLabels);
  const arabic = getArabicDocumentTitle(type, taxRegistered);
  if (language === 'ar') return arabic;
  const english =
    type === 'INVOICE' && taxRegistered && !customLabels?.invoice
      ? DOCUMENT_LABELS.taxInvoice.en
      : getDocumentTitle(type, customLabels);
  return `${english}${joiner}${arabic}`;
}

interface StatusStyle {
  bg: string;
  text: string;
  border: string;
}

function getStatusStyle(status: string): StatusStyle {
  const s = status.toUpperCase();
  if (['PAID', 'APPROVED', 'DELIVERED', 'COMPLETED', 'ACTIVE'].includes(s)) {
    return { bg: '#f0fdf4', text: '#15803d', border: '#bbf7d0' };
  }
  if (['ISSUED', 'SENT', 'DRAFT', 'PENDING', 'OPEN'].includes(s)) {
    return { bg: '#fffbeb', text: '#b45309', border: '#fde68a' };
  }
  if (['OVERDUE', 'CANCELLED', 'REJECTED', 'VOID'].includes(s)) {
    return { bg: '#fef2f2', text: '#b91c1c', border: '#fecaca' };
  }
  return { bg: '#f8fafc', text: '#475569', border: '#e2e8f0' };
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
      localization: {
        ...DEFAULT_DOCUMENT_TEMPLATE_CONFIG.localization,
        ...(templateConfig?.localization || {}),
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
        const language: DocumentLanguage =
          docData.language ?? config.localization.language;
        // Arabic documents mirror the whole layout; bilingual ones keep the
        // English reading order and print Arabic beside it.
        installDocumentText(doc, {
          clean: toPdfText,
          mirror: isRtlDocument(language),
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

        const L = (key: DocumentLabelKey, joiner?: string) =>
          documentLabel(key, language, joiner);
        const digits = (value: string) =>
          config.localization.digits === 'arabic-indic' && language !== 'en'
            ? toArabicIndicDigits(value)
            : value;
        const money = (amount: number | undefined | null, currency?: string) =>
          digits(formatMoney(amount, currency));
        const date = (value: Date | string | undefined | null) =>
          digits(formatDate(value, language === 'ar'));
        // Phone numbers, emails and TRNs read left to right inside Arabic.
        const ltr = (value: string) =>
          language === 'en' || hasRtl(value) ? value : isolateLtr(value);
        // A colon after "Total / الإجمالي" lands between the two scripts, so
        // bilingual labels go without one.
        const colon = language === 'bilingual' ? '' : ':';
        const labelled = (key: DocumentLabelKey, value: string) =>
          `${L(key)}${colon} ${ltr(value)}`;
        const taxIdKey: DocumentLabelKey = language === 'en' ? 'taxId' : 'trn';
        const both = (english?: string, arabic?: string) => {
          if (language === 'ar') return arabic || english;
          if (language === 'bilingual' && arabic && arabic !== english) {
            return english ? `${english}\n${arabic}` : arabic;
          }
          return english;
        };
        const orgName =
          both(docData.organization.name, docData.organization.nameAr) || '';
        const orgAddress = both(
          docData.organization.address,
          docData.organization.addressAr,
        );
        const partyName = both(docData.party.name, docData.party.nameAr) || '';
        const partyAddress = both(
          docData.party.address,
          docData.party.addressAr,
        );
        const secName =
          both(docData.secondaryParty?.name, docData.secondaryParty?.nameAr) ||
          '';
        const secAddress = both(
          docData.secondaryParty?.address,
          docData.secondaryParty?.addressAr,
        );
        const itemDescription = (
          item: UniversalDocumentData['items'][number],
        ) => both(item.description, item.descriptionAr || undefined) || '';
        const statusLabel = (() => {
          const english = docData.status.toUpperCase().replace(/_/g, ' ');
          const arabic =
            DOCUMENT_STATUS_LABELS_AR[docData.status.toUpperCase()];
          return localizedLabel(english, arabic ?? english, language);
        })();
        const taxLabel = (tax: { rate: number; label: string }) => {
          const english = formatTaxLineLabel(tax);
          return digits(
            localizedLabel(english, arabicTaxLabel(english), language),
          );
        };

        const docTitle = getLocalizedDocumentTitle(
          docData.type,
          config.header.customLabels,
          language,
          !!docData.organization.taxId,
          config.header.layout === 'banner' ? ' / ' : '\n',
        );

        let y = margins.top;

        // --- 1. HEADER SECTION ---
        if (config.header.layout === 'banner') {
          // Banner layout: colored bar across top
          const bannerHeight = 56;
          doc.rect(0, 0, pageWidth, bannerHeight).fill(primaryColor);

          // In banner: Company Name / Logo on left, Document Title on right
          let logoDrawn = false;
          let bannerTextX = margins.left;
          if (config.header.showLogo) {
            const logoBoxSize = 38;
            if (logoBuffer) {
              try {
                doc.image(logoBuffer, margins.left, 9, {
                  fit: [logoBoxSize, logoBoxSize],
                });
                logoDrawn = true;
              } catch {
                logoDrawn = false;
              }
            }
            if (!logoDrawn) {
              doc
                .roundedRect(margins.left, 9, logoBoxSize, logoBoxSize, 6)
                .fill('#ffffff22');
              const initials =
                (docData.organization.name || 'ORG')
                  .replace(/[^a-zA-Z0-9]/g, '')
                  .slice(0, 3)
                  .toUpperCase() || 'CRM';
              doc
                .font(boldFont)
                .fontSize(11)
                .fillColor('#ffffff')
                .text(initials, margins.left, 21, {
                  width: logoBoxSize,
                  align: 'center',
                });
              logoDrawn = true;
            }
            bannerTextX = margins.left + logoBoxSize + 10;
          }

          doc
            .font(boldFont)
            .fontSize(15)
            .fillColor('#ffffff')
            .text(orgName, bannerTextX, 19, {
              width: contentWidth / 2 - (bannerTextX - margins.left),
            });

          doc
            .font(boldFont)
            .fontSize(16)
            .fillColor('#ffffff')
            .text(docTitle, margins.left + contentWidth / 2, 19, {
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
          if (config.header.showCompanyAddress && orgAddress) {
            doc.text(orgAddress, margins.left, doc.y, {
              width: leftW,
            });
          }
          if (config.header.showCompanyPhone && docData.organization.phone) {
            doc.text(
              labelled('phone', docData.organization.phone),
              margins.left,
              doc.y,
              { width: leftW },
            );
          }
          if (config.header.showCompanyEmail && docData.organization.email) {
            doc.text(
              labelled('email', docData.organization.email),
              margins.left,
              doc.y,
              { width: leftW },
            );
          }
          if (config.header.showCompanyTaxId && docData.organization.taxId) {
            doc.text(
              labelled(taxIdKey, docData.organization.taxId),
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
          doc.text(labelled('issued', date(docData.issuedAt)), rightX, rY, {
            width: rightW,
            align: 'right',
          });
          rY = doc.y + 2;

          if (docData.dueDate) {
            doc.text(labelled('due', date(docData.dueDate)), rightX, rY, {
              width: rightW,
              align: 'right',
            });
            rY = doc.y + 2;
          }
          if (docData.validUntil) {
            doc.text(
              labelled('validUntil', date(docData.validUntil)),
              rightX,
              rY,
              { width: rightW, align: 'right' },
            );
            rY = doc.y + 2;
          }

          // Status Badge
          const statusText = statusLabel;
          doc.font(boldFont).fontSize(7.5);
          const badgeWidth = Math.max(54, doc.widthOfString(statusText) + 14);
          const badgeHeight = 15;
          const badgeX = margins.left + contentWidth - badgeWidth;
          const statusSt = getStatusStyle(docData.status);
          doc
            .roundedRect(badgeX, rY + 3, badgeWidth, badgeHeight, 3)
            .fillAndStroke(statusSt.bg, statusSt.border);
          doc
            .font(boldFont)
            .fontSize(7.5)
            .fillColor(statusSt.text)
            .text(statusText, badgeX, rY + 6.5, {
              width: badgeWidth,
              align: 'center',
            });

          y = Math.max(leftEndY, rY + badgeHeight + 10) + 10;
          doc
            .moveTo(margins.left, y)
            .lineTo(margins.left + contentWidth, y)
            .strokeColor('#e2e8f0')
            .lineWidth(0.75)
            .stroke();
          y += 12;
        } else if (config.header.layout === 'centered') {
          // Centered layout
          let logoDrawn = false;
          if (config.header.showLogo) {
            if (logoBuffer) {
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
              const badgeSize = 42;
              const badgeX = margins.left + (contentWidth - badgeSize) / 2;
              doc
                .roundedRect(badgeX, y, badgeSize, badgeSize, 8)
                .fill(primaryColor);
              const initials =
                (docData.organization.name || 'ORG')
                  .replace(/[^a-zA-Z0-9]/g, '')
                  .slice(0, 3)
                  .toUpperCase() || 'CRM';
              doc
                .font(boldFont)
                .fontSize(12)
                .fillColor('#ffffff')
                .text(initials, badgeX, y + 14, {
                  width: badgeSize,
                  align: 'center',
                });
              y += 48;
              logoDrawn = true;
            }
          }

          doc
            .font(boldFont)
            .fontSize(16)
            .fillColor('#0f172a')
            .text(orgName, margins.left, y, {
              width: contentWidth,
              align: 'center',
            });
          y = doc.y + 3;

          doc.font(regularFont).fontSize(8.5).fillColor('#475569');
          const compLines: string[] = [];
          if (config.header.showCompanyAddress && orgAddress)
            compLines.push(orgAddress);
          const contactParts: string[] = [];
          if (config.header.showCompanyPhone && docData.organization.phone)
            contactParts.push(labelled('phone', docData.organization.phone));
          if (config.header.showCompanyEmail && docData.organization.email)
            contactParts.push(labelled('email', docData.organization.email));
          if (contactParts.length) compLines.push(contactParts.join(' | '));
          if (config.header.showCompanyTaxId && docData.organization.taxId)
            compLines.push(labelled(taxIdKey, docData.organization.taxId));

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
            .lineWidth(0.75)
            .stroke();
          y += 10;

          // Title & Doc number centered
          doc
            .font(boldFont)
            .fontSize(17)
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
            labelled('issued', date(docData.issuedAt)),
          ];
          if (docData.dueDate)
            dateParts.push(labelled('due', date(docData.dueDate)));
          if (docData.validUntil)
            dateParts.push(labelled('validUntil', date(docData.validUntil)));
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
          const statusText = statusLabel;
          doc.font(boldFont).fontSize(7.5);
          const badgeWidth = Math.max(54, doc.widthOfString(statusText) + 14);
          const badgeHeight = 15;
          const badgeX = margins.left + (contentWidth - badgeWidth) / 2;
          const statusSt = getStatusStyle(docData.status);
          doc
            .roundedRect(badgeX, y, badgeWidth, badgeHeight, 3)
            .fillAndStroke(statusSt.bg, statusSt.border);
          doc
            .font(boldFont)
            .fontSize(7.5)
            .fillColor(statusSt.text)
            .text(statusText, badgeX, y + 3.5, {
              width: badgeWidth,
              align: 'center',
            });
          y += badgeHeight + 10;

          doc
            .moveTo(margins.left, y)
            .lineTo(margins.left + contentWidth, y)
            .strokeColor('#e2e8f0')
            .lineWidth(0.75)
            .stroke();
          y += 12;
        } else {
          // Default: 'split' layout
          const leftW = contentWidth * 0.55;
          const rightX = margins.left + leftW + 10;
          const rightW = contentWidth - leftW - 10;

          const startY = y;
          let logoDrawn = false;
          const logoBoxSize = 40;
          let textStartX = margins.left;

          if (config.header.showLogo) {
            if (logoBuffer) {
              try {
                doc.image(logoBuffer, margins.left, y, {
                  fit: [logoBoxSize, logoBoxSize],
                });
                logoDrawn = true;
              } catch {
                logoDrawn = false;
              }
            }

            if (!logoDrawn) {
              doc
                .roundedRect(margins.left, y, logoBoxSize, logoBoxSize, 6)
                .fill(primaryColor);
              const initials =
                (docData.organization.name || 'ORG')
                  .replace(/[^a-zA-Z0-9]/g, '')
                  .slice(0, 3)
                  .toUpperCase() || 'CRM';
              doc
                .font(boldFont)
                .fontSize(11)
                .fillColor('#ffffff')
                .text(initials, margins.left, y + 13, {
                  width: logoBoxSize,
                  align: 'center',
                });
              logoDrawn = true;
            }

            textStartX = margins.left + logoBoxSize + 10;
          }

          const orgTextW = margins.left + leftW - textStartX;
          let lY = startY;

          doc
            .font(boldFont)
            .fontSize(15)
            .fillColor('#0f172a')
            .text(orgName, textStartX, lY, {
              width: orgTextW,
            });
          lY = doc.y + 2;

          doc.font(regularFont).fontSize(8.5).fillColor('#475569');
          if (config.header.showCompanyAddress && orgAddress) {
            doc.text(orgAddress, textStartX, lY, {
              width: orgTextW,
            });
            lY = doc.y + 2;
          }
          if (config.header.showCompanyPhone && docData.organization.phone) {
            doc.text(
              labelled('phone', docData.organization.phone),
              textStartX,
              lY,
              {
                width: orgTextW,
              },
            );
            lY = doc.y + 2;
          }
          if (config.header.showCompanyEmail && docData.organization.email) {
            doc.text(
              labelled('email', docData.organization.email),
              textStartX,
              lY,
              {
                width: orgTextW,
              },
            );
            lY = doc.y + 2;
          }
          if (config.header.showCompanyTaxId && docData.organization.taxId) {
            doc.text(
              labelled(taxIdKey, docData.organization.taxId),
              textStartX,
              lY,
              {
                width: orgTextW,
              },
            );
            lY = doc.y + 2;
          }
          const leftEndY = Math.max(
            lY,
            startY + (config.header.showLogo ? logoBoxSize + 4 : 0),
          );

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
          doc.text(labelled('issued', date(docData.issuedAt)), rightX, rY, {
            width: rightW,
            align: 'right',
          });
          rY = doc.y + 2;

          if (docData.dueDate) {
            doc.text(labelled('due', date(docData.dueDate)), rightX, rY, {
              width: rightW,
              align: 'right',
            });
            rY = doc.y + 2;
          }
          if (docData.validUntil) {
            doc.text(
              labelled('validUntil', date(docData.validUntil)),
              rightX,
              rY,
              { width: rightW, align: 'right' },
            );
            rY = doc.y + 2;
          }

          // Status Badge
          const statusText = statusLabel;
          doc.font(boldFont).fontSize(7.5);
          const badgeWidth = Math.max(54, doc.widthOfString(statusText) + 14);
          const badgeHeight = 15;
          const badgeX = margins.left + contentWidth - badgeWidth;
          const statusSt = getStatusStyle(docData.status);
          doc
            .roundedRect(badgeX, rY + 3, badgeWidth, badgeHeight, 3)
            .fillAndStroke(statusSt.bg, statusSt.border);
          doc
            .font(boldFont)
            .fontSize(7.5)
            .fillColor(statusSt.text)
            .text(statusText, badgeX, rY + 6.5, {
              width: badgeWidth,
              align: 'center',
            });

          y = Math.max(leftEndY, rY + badgeHeight + 10) + 10;

          // Header bottom divider line
          doc
            .moveTo(margins.left, y)
            .lineTo(margins.left + contentWidth, y)
            .strokeColor('#e2e8f0')
            .lineWidth(0.75)
            .stroke();
          y += 12;
        }

        // --- 2. PARTIES SECTION ---
        const partiesY = y;
        const colW = (contentWidth - 20) / 2;

        let partyLabel = config.parties.billToLabel;
        let partyLabelAr: string = DOCUMENT_LABELS.billTo.ar;
        if (docData.type === 'PURCHASE_ORDER') {
          partyLabel = config.parties.supplierLabel;
          partyLabelAr = DOCUMENT_LABELS.vendor.ar;
        } else if (docData.type === 'DELIVERY_NOTE') {
          partyLabel = config.parties.shipToLabel;
          partyLabelAr = DOCUMENT_LABELS.shipTo.ar;
        }
        partyLabel = localizedLabel(partyLabel, partyLabelAr, language);

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
          .text(partyName, margins.left, pY, { width: colW });
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
        if (config.parties.showAddress && partyAddress) {
          doc
            .font(regularFont)
            .fontSize(8.5)
            .fillColor('#475569')
            .text(partyAddress, margins.left, pY, { width: colW });
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
            .text(labelled(taxIdKey, docData.party.taxId), margins.left, pY, {
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
              localizedLabel(
                docData.secondaryParty.label || config.parties.shipToLabel,
                DOCUMENT_LABELS.shipTo.ar,
                language,
              ).toUpperCase(),
              secX,
              partiesY,
            );
          let sY = partiesY + 12;

          doc
            .font(boldFont)
            .fontSize(9.5)
            .fillColor('#0f172a')
            .text(secName, secX, sY, { width: colW });
          sY = doc.y + 2;

          if (secAddress) {
            doc
              .font(regularFont)
              .fontSize(8.5)
              .fillColor('#475569')
              .text(secAddress, secX, sY, { width: colW });
            sY = doc.y + 2;
          }
          if (docData.secondaryParty.carrier) {
            doc
              .font(regularFont)
              .fontSize(8.5)
              .fillColor('#475569')
              .text(
                labelled('carrier', docData.secondaryParty.carrier),
                secX,
                sY,
                {
                  width: colW,
                },
              );
            sY = doc.y + 2;
          }
          if (docData.secondaryParty.trackingReference) {
            doc
              .font(regularFont)
              .fontSize(8.5)
              .fillColor('#475569')
              .text(
                labelled('tracking', docData.secondaryParty.trackingReference),
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

        // A column of dashes says nothing, so it shows only when a line has a code.
        const showItemCode =
          t.showItemCode && docData.items.some((item) => !!item.code);
        const codeWidth = showItemCode ? 65 : 0;
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

        if (showItemCode) {
          columns.push({
            id: 'code',
            label: L('itemCode', '\n'),
            width: codeWidth,
            align: 'left',
            x: 0,
          });
        }
        if (t.showDescription) {
          columns.push({
            id: 'description',
            label: L('description', '\n'),
            width: descWidth,
            align: 'left',
            x: 0,
          });
        }
        if (t.showQuantity) {
          columns.push({
            id: 'quantity',
            label: L('quantity', '\n'),
            width: qtyWidth,
            align: 'right',
            x: 0,
          });
        }
        if (t.showUnitPrice) {
          columns.push({
            id: 'unitPrice',
            label: L('unitPrice', '\n'),
            width: priceWidth,
            align: 'right',
            x: 0,
          });
        }
        if (t.showDiscount) {
          columns.push({
            id: 'discount',
            label: L('discountPercent', '\n'),
            width: discountWidth,
            align: 'right',
            x: 0,
          });
        }
        if (t.showTaxRate) {
          columns.push({
            id: 'taxRate',
            label: L('taxPercent', '\n'),
            width: taxWidth,
            align: 'right',
            x: 0,
          });
        }
        if (t.showLineTotal) {
          columns.push({
            id: 'lineTotal',
            label: L('lineTotal', '\n'),
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
          const headerHeight = language === 'bilingual' ? 32 : 22;
          const headerBg =
            config.itemsTable.headerBackgroundColor || primaryColor;
          const headerTextColor =
            config.itemsTable.headerTextColor || '#ffffff';

          doc
            .rect(margins.left, headerY, contentWidth, headerHeight)
            .fill(headerBg);

          doc.font(boldFont).fontSize(8).fillColor(headerTextColor);

          for (const col of columns) {
            const pad = 4;
            const x = col.align === 'right' ? col.x : col.x + pad;
            const w = col.width - 8;
            doc.text(col.label.toUpperCase(), x, headerY + 6.5, {
              width: w,
              align: col.align,
            });
          }

          const afterHeaderY = headerY + headerHeight;
          doc
            .moveTo(margins.left, afterHeaderY)
            .lineTo(margins.left + contentWidth, afterHeaderY)
            .strokeColor('#cbd5e1')
            .lineWidth(0.5)
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
              itemDescHeight = doc.heightOfString(itemDescription(item), {
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
                  cellText = itemDescription(item);
                  break;
                case 'quantity':
                  cellText =
                    item.quantity != null ? digits(String(item.quantity)) : '—';
                  break;
                case 'unitPrice':
                  cellText =
                    item.unitPrice != null
                      ? money(item.unitPrice, docData.currency)
                      : '—';
                  break;
                case 'discount':
                  cellText =
                    item.discount != null ? digits(`${item.discount}%`) : '—';
                  break;
                case 'taxRate':
                  cellText =
                    item.taxRate != null ? digits(`${item.taxRate}%`) : '—';
                  break;
                case 'lineTotal':
                  cellText =
                    item.amount != null
                      ? money(item.amount, docData.currency)
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
            .text(L('noItems'), margins.left + 6, y + 6);
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
            .text(L('accountSummary'), margins.left, y);
          y += 13;

          const summaryBoxW = contentWidth / 3;
          doc.rect(margins.left, y, contentWidth, 34).fill('#f8fafc');
          doc
            .rect(margins.left, y, contentWidth, 34)
            .strokeColor('#e2e8f0')
            .stroke();

          doc.font(boldFont).fontSize(7.5).fillColor(secondaryColor);
          doc.text(L('statementPeriod'), margins.left + 8, y + 5);
          doc.text(L('openingBalance'), margins.left + summaryBoxW + 8, y + 5);
          doc.text(
            L('closingBalance'),
            margins.left + summaryBoxW * 2 + 8,
            y + 5,
          );

          doc.font(regularFont).fontSize(8.5).fillColor('#0f172a');
          doc.text(
            `${date(summary.periodFrom)} - ${date(summary.periodTo)}`,
            margins.left + 8,
            y + 17,
          );
          doc.text(
            money(summary.openingBalance, docData.currency),
            margins.left + summaryBoxW + 8,
            y + 17,
          );
          doc
            .font(boldFont)
            .text(
              money(summary.closingBalance, docData.currency),
              margins.left + summaryBoxW * 2 + 8,
              y + 17,
            );

          y += 42;

          doc
            .font(boldFont)
            .fontSize(9)
            .fillColor(primaryColor)
            .text(L('agingBreakdown'), margins.left, y);
          y += 13;

          const agingCols = [
            { label: L('agingCurrent'), value: summary.aging.current },
            { label: L('aging30'), value: summary.aging.days30 },
            { label: L('aging60'), value: summary.aging.days60 },
            { label: L('aging90'), value: (summary.aging as any).days90 ?? 0 },
            { label: L('aging90Plus'), value: summary.aging.days90Plus },
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
              .text(money(ac.value, docData.currency), ax, y + 17, {
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
          // Bilingual labels ("Balance Due / الرصيد المستحق") need the room.
          const totalsWidth = language === 'bilingual' ? 300 : 230;
          const totalsX = margins.left + contentWidth - totalsWidth;
          const labelWidth = totalsWidth - 115;
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
              `${L('subtotal')}${colon}`,
              money(docData.totals.subtotal, docData.currency),
            );
          }
          if (
            config.totals.showDiscountTotal &&
            docData.totals.discounts != null &&
            docData.totals.discounts > 0
          ) {
            renderTotalLine(
              `${L('discount')}${colon}`,
              ltr(`-${money(docData.totals.discounts, docData.currency)}`),
            );
          }
          if (
            config.totals.showTaxSummary &&
            docData.totals.taxes &&
            docData.totals.taxes.length > 0
          ) {
            for (const tax of docData.totals.taxes) {
              renderTotalLine(
                `${taxLabel(tax)}${colon}`,
                money(tax.amount, docData.currency),
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
            doc
              .roundedRect(totalsX - 6, y - 3, totalsWidth + 12, 22, 4)
              .fill('#f1f5f9');
            doc
              .font(boldFont)
              .fontSize(10)
              .fillColor(primaryColor)
              .text(`${L('total')}${colon}`, totalsX, y + 3, {
                width: labelWidth,
                align: 'left',
              })
              .text(
                money(docData.totals.total, docData.currency),
                totalsX + labelWidth,
                y + 3,
                {
                  width: valueWidth,
                  align: 'right',
                },
              );
            y += 25;
          } else {
            renderTotalLine(
              `${L('total')}${colon}`,
              money(docData.totals.total, docData.currency),
              false,
            );
          }

          if (
            config.totals.showAmountPaid &&
            docData.totals.amountPaid != null
          ) {
            renderTotalLine(
              `${L('amountPaid')}${colon}`,
              money(docData.totals.amountPaid, docData.currency),
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
              `${L('balanceDue')}${colon}`,
              money(docData.totals.balanceDue, docData.currency),
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

        const terms = docData.paymentTerms
          ? formatPaymentTerms(docData.paymentTerms)
          : config.footer.paymentTerms;
        // pdfkit's `continued` runs cannot be reordered right to left, so
        // Arabic and bilingual documents put the label on its own line.
        const writeLabelledParagraph = (
          key: DocumentLabelKey,
          text: string,
        ) => {
          doc.font(boldFont).fontSize(8.5).fillColor('#1e293b');
          if (language === 'en') {
            doc.text(`${L(key)}: `, margins.left, y, { continued: true });
            doc.font(regularFont).fillColor('#475569').text(text);
          } else {
            doc.text(`${L(key)}${colon}`, margins.left, y, {
              width: contentWidth,
            });
            doc
              .font(regularFont)
              .fillColor('#475569')
              .text(text, margins.left, doc.y, { width: contentWidth });
          }
          y = doc.y + 4;
        };
        if (terms) {
          writeLabelledParagraph('paymentTerms', terms);
        }

        const notes = docData.notes || config.footer.notes;
        if (notes) {
          writeLabelledParagraph('notes', notes);
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
            .text(L('bankDetails'), margins.left, y);
          y += 11;
          doc.font(regularFont).fontSize(8).fillColor('#475569');
          if (bank.bankName) {
            doc.text(labelled('bank', bank.bankName), margins.left, y);
            y += 10;
          }
          if (bank.accountName) {
            doc.text(
              labelled('accountName', bank.accountName),
              margins.left,
              y,
            );
            y += 10;
          }
          if (bank.accountNumber) {
            doc.text(
              labelled('accountNumber', bank.accountNumber),
              margins.left,
              y,
            );
            y += 10;
          }
          if (bank.routingOrIban) {
            doc.text(labelled('iban', bank.routingOrIban), margins.left, y);
            y += 10;
          }
          if (bank.swiftBic) {
            doc.text(labelled('swift', bank.swiftBic), margins.left, y);
            y += 10;
          }
        }

        if (config.footer.showSignatureBlock) {
          if (y + 60 > pageHeight - margins.bottom - 40) {
            doc.addPage({ size: 'A4', margins });
            y = margins.top;
          }
          y += 16;
          if (docData.type === 'QUOTE' && docData.party?.name) {
            const sigColW = (contentWidth - 40) / 2;
            const rightSigX = margins.left + sigColW + 40;

            doc.font(boldFont).fontSize(8).fillColor('#334155');
            doc.text(
              `${L('for')} ${orgName.replace(/\n/g, ' / ')}:`,
              margins.left,
              y,
            );
            doc.text(
              `${L('acceptedBy')} ${partyName.replace(/\n/g, ' / ')}:`,
              rightSigX,
              y,
            );
            y += 24;

            doc
              .moveTo(margins.left, y)
              .lineTo(margins.left + sigColW, y)
              .moveTo(rightSigX, y)
              .lineTo(rightSigX + sigColW, y)
              .strokeColor('#94a3b8')
              .lineWidth(0.75)
              .stroke();

            doc.font(regularFont).fontSize(7.5).fillColor('#64748b');
            doc.text(L('authorizedSignatureDate'), margins.left, y + 4, {
              width: sigColW,
            });
            doc.text(L('clientSignature'), rightSigX, y + 4, {
              width: sigColW,
            });
            y += 20;
          } else {
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
                localizedLabel(
                  config.footer.signatureLabel || 'Authorized Signature',
                  DOCUMENT_LABELS.authorizedSignature.ar,
                  language,
                ),
                sigX,
                y + 26,
                {
                  width: sigW,
                  align: 'center',
                },
              );
            y += 40;
          }
        }

        // --- 7. TWO-PASS PAGE NUMBERING ---
        if (config.footer.showPageNumbers) {
          const pageRange = doc.bufferedPageRange();
          const totalPages = pageRange.count;
          for (let i = pageRange.start; i < pageRange.start + totalPages; i++) {
            doc.switchToPage(i);
            const pageNum = i - pageRange.start + 1;
            const savedBottom = doc.page.margins.bottom;
            doc.page.margins.bottom = 0;
            doc
              .font(regularFont)
              .fontSize(7.5)
              .fillColor(secondaryColor)
              .text(
                digits(
                  localizedLabel(
                    `Page ${pageNum} of ${totalPages}`,
                    `${DOCUMENT_LABELS.page.ar} ${pageNum} ${DOCUMENT_LABELS.of.ar} ${totalPages}`,
                    language,
                  ),
                ),
                margins.left,
                pageHeight - margins.bottom + 8,
                {
                  width: contentWidth,
                  align: 'center',
                  lineBreak: false,
                },
              );
            doc.page.margins.bottom = savedBottom;
          }
        }

        doc.end();
      } catch (err) {
        reject(err);
      }
    });
  }
}
