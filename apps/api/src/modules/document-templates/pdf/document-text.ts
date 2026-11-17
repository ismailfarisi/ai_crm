import {
  ARABIC_FONT_BOLD,
  ARABIC_FONT_FILES,
  ARABIC_FONT_REGULAR,
  hasRtl,
  stripBidiControls,
  visualRuns,
} from './bidi-text';

type TextOptions = PDFKit.Mixins.TextOptions & { baseline?: string | number };
type Doc = PDFKit.PDFDocument & {
  _font?: { name?: string };
  _fontSize?: number;
};

/** Line advance and baseline offset for lines that hold Arabic, as fractions of the font size. */
const ARABIC_LINE_ADVANCE = 1.4;
const ARABIC_BASELINE = 0.95;
/**
 * Any explicit feature list makes pdfkit lay a run out in one fontkit call.
 * Without it pdfkit shapes word by word, so fontkit's right-to-left pass
 * would reverse each word but leave the words in logical order.
 */
const WHOLE_RUN: PDFKit.Mixins.TextOptions['features'] = ['kern'];

export interface DocumentTextOptions {
  /** Makes printable whatever the built-in (WinAnsi) font cannot draw. */
  clean: (text: string) => string;
  /**
   * Mirror the page horizontally: every x coordinate the layout code passes is
   * flipped and left/right alignment swapped, so one layout serves both
   * directions. Text itself is never mirrored.
   */
  mirror: boolean;
}

/**
 * Routes every string pdfkit prints or measures through the bidi pass:
 * Latin-only text goes to the template font as before (cleaned to WinAnsi),
 * anything with Arabic is split into visual runs, Arabic runs drawn in the
 * bundled Arabic font (fontkit joins the letters) and the rest in the template
 * font, placed left to right by hand.
 */
export function installDocumentText(
  doc: PDFKit.PDFDocument,
  opts: DocumentTextOptions,
): void {
  const d = doc as Doc;
  d.registerFont(ARABIC_FONT_REGULAR, ARABIC_FONT_FILES.regular);
  d.registerFont(ARABIC_FONT_BOLD, ARABIC_FONT_FILES.bold);

  const text = d.text.bind(d) as (
    v: string,
    x?: number,
    y?: number,
    o?: TextOptions,
  ) => Doc;
  const widthOf = d.widthOfString.bind(d);
  const heightOf = d.heightOfString.bind(d);
  const pageWidth = () => d.page.width;
  const { clean, mirror } = opts;

  const baseFont = () => d._font?.name ?? 'Helvetica';
  const size = () => d._fontSize ?? 12;
  const arabicFontFor = (font: string) =>
    /bold/i.test(font) ? ARABIC_FONT_BOLD : ARABIC_FONT_REGULAR;

  const defaultWidth = (x: number) => d.page.width - x - d.page.margins.right;

  const lineWidth = (line: string, font: string, o?: TextOptions): number => {
    let width = 0;
    for (const run of visualRuns(line).runs) {
      if (run.arabicFont) {
        d.font(arabicFontFor(font));
        width += widthOf(run.text, { ...o, features: WHOLE_RUN });
      } else {
        d.font(font);
        width += widthOf(clean(run.text), o);
      }
    }
    d.font(font);
    return width;
  };

  const wrap = (
    value: string,
    width: number,
    font: string,
    o?: TextOptions,
  ): string[] => {
    const lines: string[] = [];
    for (const paragraph of value.split('\n')) {
      if (o?.lineBreak === false) {
        lines.push(paragraph);
        continue;
      }
      const words = paragraph.split(' ');
      let line = '';
      for (const word of words) {
        const candidate = line ? `${line} ${word}` : word;
        if (!line || lineWidth(candidate, font, o) <= width) line = candidate;
        else {
          lines.push(line);
          line = word;
        }
      }
      lines.push(line);
    }
    return lines;
  };

  const arabicAdvance = (o?: TextOptions) => {
    d.font(baseFont());
    return (
      Math.max(ARABIC_LINE_ADVANCE * size(), d.currentLineHeight(true)) +
      (o?.lineGap ?? 0)
    );
  };

  // pdfkit measures and draws through the patched methods too; while a run
  // is being placed they must go straight to pdfkit.
  let placing = false;

  const drawRtlAware = (
    value: string,
    x: number,
    y: number,
    o: TextOptions,
    width: number | undefined,
  ): Doc => {
    placing = true;
    try {
      return drawLines(value, x, y, o, width);
    } finally {
      placing = false;
    }
  };

  const drawLines = (
    value: string,
    x: number,
    y: number,
    o: TextOptions,
    width: number | undefined,
  ): Doc => {
    const font = baseFont();
    const advance = arabicAdvance(o);
    const boxWidth =
      width ?? Math.max(...value.split('\n').map((l) => lineWidth(l, font, o)));
    const lines = wrap(value, boxWidth, font, o);
    const maxLines = o.height
      ? Math.max(1, Math.floor(o.height / advance))
      : lines.length;
    let top = y;
    for (const line of lines.slice(0, maxLines)) {
      const { runs, rtl } = visualRuns(line);
      const w = lineWidth(line, font, o);
      const align =
        o.align === 'justify' ? (rtl ? 'right' : 'left') : (o.align ?? 'left');
      let cx =
        align === 'right'
          ? x + boxWidth - w
          : align === 'center'
            ? x + (boxWidth - w) / 2
            : x;
      const baseline = top + ARABIC_BASELINE * size();
      for (const run of runs) {
        const runFont = run.arabicFont ? arabicFontFor(font) : font;
        const printed = run.arabicFont ? run.text : clean(run.text);
        d.font(runFont);
        const features = run.arabicFont ? WHOLE_RUN : undefined;
        const runWidth = widthOf(printed, { ...o, features });
        text(printed, cx, baseline, {
          features,
          lineBreak: false,
          baseline: 'alphabetic',
          characterSpacing: o.characterSpacing,
          underline: o.underline,
          link: o.link,
        });
        cx += runWidth;
      }
      d.font(font);
      top += advance;
    }
    d.x = x;
    d.y = top;
    return d;
  };

  d.text = ((value: unknown, a?: unknown, b?: unknown, c?: unknown) => {
    if (placing)
      return text(value as string, a as number, b as number, c as TextOptions);
    let x = typeof a === 'number' ? a : undefined;
    let y = typeof b === 'number' ? b : undefined;
    const o: TextOptions = {
      ...((typeof a === 'object'
        ? a
        : typeof c === 'object'
          ? c
          : undefined) as TextOptions),
    };
    const str = value == null ? '' : String(value);
    x ??= d.x;
    y ??= d.y;

    let width = o.width;
    if (width === undefined && o.lineBreak !== false) width = defaultWidth(x);
    if (mirror) {
      const w = width ?? d.widthOfString(str, o);
      x = pageWidth() - x - w;
      width = w;
      o.align =
        o.align === 'right'
          ? 'left'
          : o.align === 'center'
            ? 'center'
            : 'right';
    }
    if (width !== undefined) o.width = width;

    if (!hasRtl(str)) {
      const result = text(clean(stripBidiControls(str)), x, y, o);
      if (mirror) result.x = pageWidth() - result.x - (width ?? 0);
      return result;
    }
    const result = drawRtlAware(str, x, y, o, width);
    if (mirror) result.x = pageWidth() - result.x - (width ?? 0);
    return result;
  }) as typeof d.text;

  d.widthOfString = ((value: string, o?: TextOptions) => {
    if (placing) return widthOf(value, o);
    if (!hasRtl(value)) return widthOf(clean(stripBidiControls(value)), o);
    const font = baseFont();
    return Math.max(
      ...value.split('\n').map((line) => lineWidth(line, font, o)),
    );
  }) as typeof d.widthOfString;

  d.heightOfString = ((value: string, o?: TextOptions) => {
    if (placing) return heightOf(value, o);
    if (!hasRtl(value)) return heightOf(clean(stripBidiControls(value)), o);
    const font = baseFont();
    const width = o?.width ?? defaultWidth(d.x);
    return wrap(value, width, font, o).length * arabicAdvance(o);
  }) as typeof d.heightOfString;

  if (mirror) mirrorGraphics(d);
}

function mirrorGraphics(d: Doc): void {
  const pw = () => d.page.width;
  // pdfkit builds rounded rectangles from moveTo/lineTo, which must not be
  // flipped a second time.
  let raw = false;
  const rect = d.rect.bind(d);
  const roundedRect = d.roundedRect.bind(d);
  const moveTo = d.moveTo.bind(d);
  const lineTo = d.lineTo.bind(d);
  const image = d.image.bind(d) as (
    src: unknown,
    x?: unknown,
    y?: unknown,
    o?: unknown,
  ) => Doc;
  d.rect = ((x: number, y: number, w: number, h: number) =>
    rect(pw() - x - w, y, w, h)) as typeof d.rect;
  d.roundedRect = ((x: number, y: number, w: number, h: number, r?: number) => {
    raw = true;
    try {
      return roundedRect(pw() - x - w, y, w, h, r);
    } finally {
      raw = false;
    }
  }) as typeof d.roundedRect;
  d.moveTo = ((x: number, y: number) =>
    moveTo(raw ? x : pw() - x, y)) as typeof d.moveTo;
  d.lineTo = ((x: number, y: number) =>
    lineTo(raw ? x : pw() - x, y)) as typeof d.lineTo;
  d.image = ((
    src: unknown,
    x?: unknown,
    y?: unknown,
    o?: { width?: number; fit?: [number, number] },
  ) => {
    if (typeof x !== 'number') return image(src, x, y, o);
    const w = o?.fit?.[0] ?? o?.width ?? 0;
    return image(src, pw() - x - w, y, o);
  }) as typeof d.image;
}
