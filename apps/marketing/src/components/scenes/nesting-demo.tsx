import { nestBlankOnSheet } from '@saas/shared';
import { NestingDemoView, type NestingCase } from './nesting-demo-view';

const SHEET = { w: 1000, h: 700 };
const MARGIN = 10;
const BLANK_H = 600;
const ORDER = 5000;
const WIDTHS = [245, 246];

/**
 * The "1mm" argument, computed by the same nesting function the costing engine
 * uses — so the numbers on the homepage are the numbers Kerf quotes. It runs
 * at build time: importing `@saas/shared` into a client component would ship
 * the whole package (zod, the permission catalog) to every visitor.
 */
export function NestingDemo() {
  const cases: NestingCase[] = WIDTHS.map((width) => {
    const r = nestBlankOnSheet(width, BLANK_H, SHEET.w, SHEET.h, { marginMm: MARGIN });
    const rotated = r.orientation === 'ROTATED';
    return {
      width,
      perSheet: r.perSheet,
      across: r.across,
      down: r.down,
      blankW: rotated ? BLANK_H : width,
      blankH: rotated ? width : BLANK_H,
      sheets: Math.ceil(ORDER / r.perSheet),
    };
  });
  return <NestingDemoView cases={cases} sheet={SHEET} margin={MARGIN} order={ORDER} />;
}
