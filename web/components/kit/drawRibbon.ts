/** Fixed point budget per canvas (KTD12). Density scales down; never a scrollbar. */
export const RIBBON_POINT_BUDGET = 240;
export const RIBBON_MIN_GAP_PX = 6;

export type RibbonSegment = {
  fraction: number;
  color: string;
  rows?: number;
  inert?: boolean;
  divider?: boolean;
};

export type RibbonMarker = {
  fraction: number;
  color: string;
};

const INK = "#0A0A0A";

function canvasGap(cssWidth: number, rows: number) {
  const maxCols = Math.max(1, Math.floor(RIBBON_POINT_BUDGET / Math.max(1, rows)));
  return Math.max(RIBBON_MIN_GAP_PX, cssWidth / maxCols);
}

export function drawDotRibbon(
  ctx: CanvasRenderingContext2D,
  cssWidth: number,
  cssHeight: number,
  segments: readonly RibbonSegment[],
  marker: RibbonMarker | null,
) {
  ctx.clearRect(0, 0, cssWidth, cssHeight);
  const midY = cssHeight / 2;
  const rows = Math.max(1, ...segments.map((segment) => segment.rows ?? 3));
  const gap = canvasGap(cssWidth, rows);
  let x = 0;
  let dots = 0;
  for (const segment of segments) {
    const width = cssWidth * Math.max(0, segment.fraction);
    const size = Math.max(3, Math.min(5, cssHeight / (rows + 1)));
    const cols = width <= 0 ? 0 : Math.floor(width / gap);
    const start = x + 3;
    for (let col = 0; col < cols; col += 1) {
      const xx = start + col * gap;
      if (xx >= x + width - 3) break;
      for (let row = 0; row < rows; row += 1) {
        const yy = midY + (row - (rows - 1) / 2) * Math.min(14, cssHeight / rows);
        ctx.fillStyle = segment.color;
        ctx.fillRect(xx, yy - size / 2, size, size);
        dots += 1;
      }
    }
    if (segment.divider) {
      ctx.fillStyle = INK;
      ctx.fillRect(x, 8, 2.5, cssHeight - 16);
    }
    x += width;
  }
  if (marker) {
    const mx = cssWidth * Math.min(1, Math.max(0, marker.fraction));
    ctx.fillStyle = marker.color;
    ctx.fillRect(mx - 4, midY - 10, 8, 20);
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2;
    ctx.strokeRect(mx - 4, midY - 10, 8, 20);
  }
  return dots;
}

export const RIBBON_INK = INK;
export const RIBBON_FUTURE = "#C6C6C2";
export const RIBBON_GOLD = "#E8930C";
