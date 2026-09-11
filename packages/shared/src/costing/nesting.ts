/**
 * Sheet nesting: how many blanks fit on one purchased sheet.
 *
 * This is the single most important function in the costing engine, because
 * it is why material cost is a *step* function of quantity rather than a
 * linear one. You do not buy 0.31 m² of greyboard — you buy a whole sheet,
 * and a blank that is 1mm too wide to fit 4-up costs you 33% more board.
 *
 * The model is a guillotine grid: blanks laid out in rows and columns, all in
 * the same orientation. That is how a die-cutter is actually laid out, and it
 * deliberately under-estimates versus true 2D bin packing — under-estimating
 * yield quotes slightly high, which is the safe direction to be wrong in.
 */

export type GrainDirection = 'NONE' | 'LENGTH' | 'WIDTH';

export interface NestOptions {
  /** Unusable edge on all four sides (gripper margin, trim). Default 10mm. */
  marginMm?: number;
  /** Spacing between adjacent blanks (knife clearance, bleed). Default 0mm. */
  gutterMm?: number;
  /**
   * When the material has a grain or print direction, the blank cannot be
   * rotated 90°. Board wrapped against the grain cracks on the fold.
   */
  allowRotation?: boolean;
}

export interface NestResult {
  /** Blanks per sheet. `0` means the blank does not fit at all. */
  perSheet: number;
  orientation: 'AS_IS' | 'ROTATED';
  across: number;
  down: number;
  /** Fraction of the sheet that ends up as product, 0-1. Useful for waste reporting. */
  utilisation: number;
}

const EMPTY: NestResult = {
  perSheet: 0,
  orientation: 'AS_IS',
  across: 0,
  down: 0,
  utilisation: 0,
};

/** How many blanks of `blankW × blankH` fit across a usable area, in one fixed orientation. */
function gridFit(
  blankW: number,
  blankH: number,
  usableW: number,
  usableH: number,
  gutterMm: number,
): { across: number; down: number; perSheet: number } {
  // With gutters between blanks (not outside them), n blanks span
  // n*blank + (n-1)*gutter, so n = floor((usable + gutter) / (blank + gutter)).
  const across = Math.floor((usableW + gutterMm) / (blankW + gutterMm));
  const down = Math.floor((usableH + gutterMm) / (blankH + gutterMm));
  if (across < 1 || down < 1) return { across: 0, down: 0, perSheet: 0 };
  return { across, down, perSheet: across * down };
}

export function nestBlankOnSheet(
  blankWidthMm: number,
  blankHeightMm: number,
  sheetWidthMm: number,
  sheetHeightMm: number,
  options: NestOptions = {},
): NestResult {
  const marginMm = options.marginMm ?? 10;
  const gutterMm = options.gutterMm ?? 0;
  const allowRotation = options.allowRotation ?? true;

  if (
    !(blankWidthMm > 0) ||
    !(blankHeightMm > 0) ||
    !(sheetWidthMm > 0) ||
    !(sheetHeightMm > 0)
  ) {
    return EMPTY;
  }

  const usableW = sheetWidthMm - 2 * marginMm;
  const usableH = sheetHeightMm - 2 * marginMm;
  if (usableW <= 0 || usableH <= 0) return EMPTY;

  const asIs = gridFit(blankWidthMm, blankHeightMm, usableW, usableH, gutterMm);
  const rotated = allowRotation
    ? gridFit(blankHeightMm, blankWidthMm, usableW, usableH, gutterMm)
    : { across: 0, down: 0, perSheet: 0 };

  const useRotated = rotated.perSheet > asIs.perSheet;
  const winner = useRotated ? rotated : asIs;
  if (winner.perSheet < 1) return EMPTY;

  const sheetArea = sheetWidthMm * sheetHeightMm;
  const blankArea = blankWidthMm * blankHeightMm;

  return {
    perSheet: winner.perSheet,
    orientation: useRotated ? 'ROTATED' : 'AS_IS',
    across: winner.across,
    down: winner.down,
    utilisation: (winner.perSheet * blankArea) / sheetArea,
  };
}

/** `allowRotation` for a material, given its grain lock. */
export function rotationAllowedFor(grain: GrainDirection | undefined): boolean {
  return grain === undefined || grain === 'NONE';
}
