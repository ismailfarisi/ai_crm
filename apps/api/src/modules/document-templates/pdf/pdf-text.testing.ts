import { inflateSync } from 'zlib';

/**
 * Pulls the printed text out of a PDF pdfkit wrote, for tests. Embedded fonts
 * are decoded through their ToUnicode maps; a run whose glyphs are Arabic is
 * turned back into reading order (pdfkit draws it right to left).
 */
export function extractPdfText(pdf: Buffer): string {
  const raw = pdf.toString('latin1');
  const objects = new Map<string, { dict: string; stream: string | null }>();
  const objRe = /(\d+) 0 obj\s*([\s\S]*?)endobj/g;
  let m: RegExpExecArray | null;
  while ((m = objRe.exec(raw))) {
    const body = m[2];
    const streamAt = body.indexOf('stream');
    let stream: string | null = null;
    let dict = body;
    if (streamAt >= 0) {
      dict = body.slice(0, streamAt);
      const start = m.index + m[0].indexOf(body) + streamAt + 'stream'.length;
      const dataStart = raw[start] === '\r' ? start + 2 : start + 1;
      const end = raw.indexOf('endstream', dataStart);
      const bytes = pdf.subarray(dataStart, end);
      try {
        stream = /FlateDecode/.test(dict)
          ? inflateSync(bytes).toString('latin1')
          : bytes.toString('latin1');
      } catch {
        stream = null;
      }
    }
    objects.set(m[1], { dict, stream });
  }

  const cmapFor = (fontId: string): Map<number, string> | null => {
    const font = objects.get(fontId);
    const ref = font?.dict.match(/\/ToUnicode (\d+) 0 R/)?.[1];
    const cmap = ref ? objects.get(ref)?.stream : null;
    if (!cmap) return null;
    const map = new Map<number, string>();
    const hexToText = (hex: string) =>
      String.fromCharCode(
        ...(hex.match(/.{4}/g) ?? []).map((h) => parseInt(h, 16)),
      );
    for (const block of cmap.match(/beginbfrange([\s\S]*?)endbfrange/g) ?? []) {
      const rangeRe = /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*\[([^\]]*)\]/g;
      let r: RegExpExecArray | null;
      while ((r = rangeRe.exec(block))) {
        const first = parseInt(r[1], 16);
        (r[3].match(/<([0-9a-fA-F\s]*)>/g) ?? []).forEach((entry, i) => {
          map.set(first + i, hexToText(entry.replace(/[<>\s]/g, '')));
        });
      }
    }
    return map;
  };

  const fontObjects = new Map<string, string>();
  for (const { dict } of objects.values()) {
    for (const f of dict.matchAll(/\/(F\d+) (\d+) 0 R/g))
      fontObjects.set(f[1], f[2]);
  }

  const lines: string[] = [];
  for (const { stream } of objects.values()) {
    if (!stream || !stream.includes(' Tf')) continue;
    // pdfkit draws a run as several pieces wherever it kerns, so pieces are
    // collected per baseline and put back together left to right.
    const baselines = new Map<number, { x: number; units: string[] }[]>();
    let cmap: Map<number, string> | null = null;
    let x = 0;
    let y = 0;
    const opRe =
      /1 0 0 1 (-?[\d.]+) (-?[\d.]+) Tm|\/(F\d+) [\d.]+ Tf|\[((?:<[0-9a-fA-F]*>\s*-?[\d.]*\s*)*)\] TJ/g;
    let op: RegExpExecArray | null;
    while ((op = opRe.exec(stream))) {
      if (op[1]) {
        x = Number(op[1]);
        y = Math.round(Number(op[2]) * 2) / 2;
        continue;
      }
      if (op[3]) {
        const id = fontObjects.get(op[3]);
        cmap = id ? cmapFor(id) : null;
        continue;
      }
      const hex = (op[4].match(/<([0-9a-fA-F]*)>/g) ?? [])
        .map((h) => h.slice(1, -1))
        .join('');
      const units = cmap
        ? (hex.match(/.{4}/g) ?? []).map(
            (h) => cmap!.get(parseInt(h, 16)) ?? '',
          )
        : [...Buffer.from(hex, 'hex').toString('latin1')];
      const pieces = baselines.get(y) ?? [];
      pieces.push({ x, units });
      baselines.set(y, pieces);
    }
    const ys = [...baselines.keys()].sort((a, b) => b - a);
    for (const at of ys) {
      const units = baselines
        .get(at)!
        .sort((a, b) => a.x - b.x)
        .flatMap((piece) => piece.units)
        .map((u) => u.replace(/\u00a0/g, ' '));
      lines.push(readingOrder(units));
    }
  }
  return lines.join('\n');
}

const ARABIC_LETTER = /[\u0600-\u065F\u066A-\u06FF\uFB50-\uFEFF]/;
const LTR_TOKEN = /[A-Za-z0-9\u0660-\u0669][A-Za-z0-9\u0660-\u0669.,:@+\-/%]*/g;

/**
 * Glyphs in drawing order back to reading order, roughly as a PDF viewer's
 * copy does: a line with Arabic is read right to left, and each Latin word or
 * number in it left to right.
 */
function readingOrder(units: string[]): string {
  const visual = units.join('');
  if (!ARABIC_LETTER.test(visual)) return visual;
  const reversed = units.slice().reverse().join('');
  return reversed.replace(LTR_TOKEN, (token) => [...token].reverse().join(''));
}
