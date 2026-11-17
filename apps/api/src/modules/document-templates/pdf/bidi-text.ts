/// <reference path="../../../types/bidi-js.d.ts" />
import { join } from 'path';
import bidiFactory from 'bidi-js';

const bidi = bidiFactory();

/** Letters, digits and marks from the Arabic blocks: printed in the Arabic font. */
const ARABIC_CHAR =
  /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
const RTL_CHAR = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/;
const LATIN_LETTER = /[A-Za-z\u00C0-\u024F]/;
/** Embedding, override, isolate and mark controls: steer the bidi pass, never printed. */
const BIDI_CONTROLS = /[\u200E\u200F\u061C\u202A-\u202E\u2066-\u2069]/g;

export const ARABIC_FONT_REGULAR = 'KerfArabic';
export const ARABIC_FONT_BOLD = 'KerfArabic-Bold';

/**
 * IBM Plex Sans Arabic (SIL Open Font License, see assets/fonts/OFL.txt).
 * Resolved from the package root so it works from `src` (tests) and `dist`.
 */
export const ARABIC_FONT_FILES = {
  regular: join(
    __dirname,
    '../../../../assets/fonts/IBMPlexSansArabic-Regular.ttf',
  ),
  bold: join(__dirname, '../../../../assets/fonts/IBMPlexSansArabic-Bold.ttf'),
};

/** Wraps a value that reads left to right (a phone, a TRN, an amount) so Arabic around it cannot reorder it. */
export function isolateLtr(value: string): string {
  return `\u2066${value}\u2069`;
}

export function hasRtl(text: string): boolean {
  return RTL_CHAR.test(text);
}

export function stripBidiControls(text: string): string {
  return text.replace(BIDI_CONTROLS, '');
}

export interface VisualRun {
  /** What to hand to pdfkit, so the glyphs land in visual order after fontkit's own pass. */
  text: string;
  arabicFont: boolean;
}

/**
 * fontkit shapes a string and, when its first strong letter is Arabic, lays it
 * out right to left (mirroring brackets). It cannot be told otherwise through
 * pdfkit, so this predicts it and the caller compensates.
 */
function fontkitReverses(text: string): boolean {
  for (const ch of text) {
    if (ARABIC_CHAR.test(ch)) return true;
    if (LATIN_LETTER.test(ch)) return false;
  }
  return false;
}

function reverse(text: string, mirror: boolean): string {
  return [...text]
    .reverse()
    .map((ch) => (mirror ? (bidi.getMirroredCharacter(ch) ?? ch) : ch))
    .join('');
}

function mirrorAll(text: string): string {
  return [...text].map((ch) => bidi.getMirroredCharacter(ch) ?? ch).join('');
}

const DIGIT = /[0-9\u0660-\u0669\u06F0-\u06F9]/;
const TERMINATOR = /[%\u066A\u2030#$+\u00B0]/;

/**
 * Rule W5: a percent or similar sign next to a number belongs to the number,
 * so "(5%)" inside Arabic does not print as "(%5)". bidi-js leaves the sign at
 * the surrounding level.
 */
function attachTerminatorsToNumbers(line: string, levels: Uint8Array): void {
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < line.length; i++) {
      if (!TERMINATOR.test(line[i])) continue;
      for (const j of [i - 1, i + 1]) {
        const ch = line[j];
        if (
          ch &&
          (DIGIT.test(ch) || TERMINATOR.test(ch)) &&
          levels[j] > levels[i]
        ) {
          levels[i] = levels[j];
        }
      }
    }
  }
}

/**
 * One line of text as runs in left-to-right drawing order (Unicode bidi
 * algorithm, rules L1-L2, auto paragraph direction). Arabic runs keep their
 * logical order so fontkit can join the letters before it reverses them.
 */
export function visualRuns(line: string): { runs: VisualRun[]; rtl: boolean } {
  if (!line) return { runs: [], rtl: false };
  const embedding = bidi.getEmbeddingLevels(line);
  const levels = embedding.levels;
  attachTerminatorsToNumbers(line, levels);
  const rtl = (embedding.paragraphs[0]?.level ?? 0) % 2 === 1;

  type LogicalRun = { start: number; end: number; level: number };
  const logical: LogicalRun[] = [];
  for (let i = 0; i < line.length; i++) {
    const last = logical[logical.length - 1];
    if (last && last.level === levels[i] && last.end === i) last.end = i + 1;
    else logical.push({ start: i, end: i + 1, level: levels[i] });
  }

  // L2: from the highest level down to the lowest odd one, reverse every
  // contiguous sequence of runs at that level or above.
  const order = logical.slice();
  const maxLevel = Math.max(...order.map((r) => r.level));
  const minOdd = Math.min(
    ...order.map((r) => (r.level % 2 ? r.level : r.level + 1)),
  );
  for (let level = maxLevel; level >= minOdd; level--) {
    for (let i = 0; i < order.length; i++) {
      if (order[i].level < level) continue;
      let j = i;
      while (j + 1 < order.length && order[j + 1].level >= level) j++;
      const reversed = order.slice(i, j + 1).reverse();
      order.splice(i, j - i + 1, ...reversed);
      i = j;
    }
  }

  const runs: VisualRun[] = [];
  for (const run of order) {
    const text = stripBidiControls(line.slice(run.start, run.end));
    if (!text) continue;
    const odd = run.level % 2 === 1;
    const arabicFont = odd || ARABIC_CHAR.test(text);
    const reversedByFontkit = arabicFont && fontkitReverses(text);
    // fontkit reverses but never mirrors, so brackets in a run it reverses are
    // swapped up front.
    let drawn = text;
    if (odd && !reversedByFontkit) drawn = reverse(text, true);
    if (odd && reversedByFontkit) drawn = mirrorAll(text);
    if (!odd && reversedByFontkit) drawn = reverse(text, false);
    runs.push({ text: drawn, arabicFont });
  }
  return { runs, rtl };
}
