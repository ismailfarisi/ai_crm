'use client';

interface BlankPreviewProps {
  lengthMm: number;
  widthMm: number;
  heightMm: number;
  boardThicknessMm?: number;
}

/**
 * The flat board blank, drawn to scale from the dimensions.
 *
 * Purely illustrative — the authoritative blank size is computed server-side
 * by the template's own formulas, and this redraws the common rigid-box net so
 * a transposed length and width is obvious at a glance instead of turning up
 * on the shop floor.
 */
export function BlankPreview({
  lengthMm,
  widthMm,
  heightMm,
  boardThicknessMm = 2,
}: BlankPreviewProps) {
  // Validate the inputs, not the derived blank — board thickness alone makes
  // the blank non-zero even when every box dimension is still blank.
  if (!(lengthMm > 0) || !(widthMm > 0) || !(heightMm > 0)) return null;

  const blankW = widthMm + 2 * heightMm + 4 * boardThicknessMm;
  const blankH = lengthMm + 2 * heightMm + 4 * boardThicknessMm;

  // Fit the net into a fixed viewport while keeping its aspect ratio.
  const viewport = 168;
  const scale = Math.min(viewport / blankW, viewport / blankH);
  const w = blankW * scale;
  const h = blankH * scale;
  const wallX = heightMm * scale;
  const wallY = heightMm * scale;
  const offsetX = (viewport - w) / 2;
  const offsetY = (viewport - h) / 2;

  return (
    <div className="rounded-xl border border-border/30 bg-surface-muted/20 p-3">
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-muted">
        Flat blank
      </p>

      <div className="flex items-center gap-4">
        <svg
          viewBox={`0 0 ${viewport} ${viewport}`}
          className="size-[120px] shrink-0"
          role="img"
          aria-label={`Flat blank ${Math.round(blankW)} by ${Math.round(blankH)} millimetres`}
        >
          {/* Outer cut line */}
          <rect
            x={offsetX}
            y={offsetY}
            width={w}
            height={h}
            rx={1}
            className="fill-[color-mix(in_oklab,var(--color-brand,#4f46e5)_8%,transparent)] stroke-[color-mix(in_oklab,var(--color-brand,#4f46e5)_55%,transparent)]"
            strokeWidth={1.25}
          />
          {/* Crease lines where the walls fold up */}
          <g
            className="stroke-[color-mix(in_oklab,var(--color-brand,#4f46e5)_45%,transparent)]"
            strokeWidth={0.75}
            strokeDasharray="3 2"
          >
            <line x1={offsetX + wallX} y1={offsetY} x2={offsetX + wallX} y2={offsetY + h} />
            <line
              x1={offsetX + w - wallX}
              y1={offsetY}
              x2={offsetX + w - wallX}
              y2={offsetY + h}
            />
            <line x1={offsetX} y1={offsetY + wallY} x2={offsetX + w} y2={offsetY + wallY} />
            <line
              x1={offsetX}
              y1={offsetY + h - wallY}
              x2={offsetX + w}
              y2={offsetY + h - wallY}
            />
          </g>
        </svg>

        <dl className="space-y-1 text-[11px]">
          <div className="flex gap-2">
            <dt className="text-ink-subtle">Blank</dt>
            <dd className="font-medium text-ink">
              {Math.round(blankW)} × {Math.round(blankH)} mm
            </dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-ink-subtle">Box</dt>
            <dd className="font-medium text-ink">
              {lengthMm} × {widthMm} × {heightMm} mm
            </dd>
          </div>
          <p className="pt-1 text-ink-subtle">Dashed lines are creases.</p>
        </dl>
      </div>
    </div>
  );
}
