import type { ScanReceiptPayload } from '@saas/shared';

/** What the scanner is sent: the picked file itself, or text or a link. */
export type ReceiptScanInput = ScanReceiptPayload | { file: File };

export const isFileInput = (input: ReceiptScanInput): input is { file: File } => 'file' in input;

const ENTITIES: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" };

/** The words in an SVG, line by line — an SVG receipt is text a model can read, not an image it can. */
export function svgText(svg: string): string {
  const lines = [...svg.matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/g)]
    .map((m) => m[1].replace(/<[^>]+>/g, '').trim())
    .filter(Boolean);
  const text = lines.length > 0 ? lines.join('\n') : svg.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return text.replace(/&(amp|lt|gt|quot|#39);/g, (e) => ENTITIES[e] ?? e);
}

/**
 * A data URL as a file, so a receipt that only exists in the page (the
 * sample) is stored the same way as one that was picked. Null when the URL
 * cannot be read.
 */
export function fileFromDataUrl(dataUrl: string, name: string): File | null {
  const m = /^data:([^;,]+)((?:;[^;,]+)*),([\s\S]*)$/.exec(dataUrl);
  if (!m) return null;
  const [, type, params, body] = m;
  try {
    if (/;base64/i.test(params)) {
      const binary = atob(body);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return new File([bytes], name, { type });
    }
    return new File([decodeURIComponent(body)], name, { type });
  } catch {
    return null;
  }
}

/**
 * The receipt on screen, as the scanner should receive it.
 *
 * A picked file goes up as a file, PDF or photo alike: as base64 in JSON it
 * would hit the API's body limit. A saved receipt is a link; the sample is an
 * SVG, which is sent as its text.
 */
export function receiptScanInput(receiptUrl: string, file: File | null): ReceiptScanInput {
  if (file) return { file };

  const svg = /^data:image\/svg\+xml((?:;[^;,]+)*),([\s\S]*)$/.exec(receiptUrl);
  if (svg && !/;base64/i.test(svg[1])) {
    let markup = svg[2];
    try {
      markup = decodeURIComponent(markup);
    } catch {
      // Not percent-encoded after all; read it as it is.
    }
    return { rawText: svgText(markup) };
  }

  const data = /^data:([^;,]+)(?:;[^;,]+)*;base64,([\s\S]*)$/.exec(receiptUrl);
  if (data) return { base64: data[2], mimeType: data[1] };

  return { imageUrl: receiptUrl };
}
