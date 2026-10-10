// The magnet: where a "with magnet" koozie's magnet strip sits on the die.
//
// Added in v1.6.0 so a host can show the magnet on its mockup. It is a
// physical part sewn onto the back panel, NOT print: the stage draws it only on
// screen and never into a proof (see DesignStage's `magnet` prop). This file is
// the geometry alone, so it can be pinned by a golden file with no canvas.
//
// MEASURED, NOT CHOSEN. From Reel48's own product photo of a magnet koozie
// (2026-10-09): a strip about 1.15" wide and 3.35" tall, three near-square pads
// stacked one above the other inside a stitched border, centred on the back
// panel. It is expressed in INCHES and converted with the die's pxPerInch, so
// it is the same part on every die: about 27% x 82% of the standard back
// panel, a shorter share of the taller slim one. A die with no back zone (a hat,
// say) has no magnet: `magnetRect` returns null.

/** The strip, in inches, as measured. */
export const MAGNET_INCHES = Object.freeze({
  width: 1.15,
  height: 3.35,
  // The stitched border around the pads, each side.
  border: 0.06,
  // The seam between two pads.
  seam: 0.04,
  pads: 3,
});

/**
 * The magnet strip on `geom`'s back panel, in NATIVE stage px:
 * `{ x0, y0, x1, y1, pads: [{ x0, y0, x1, y1 }, ...] }`, or null when the die
 * has no back zone.
 *
 * Centred on the back zone both ways. The back panel is turned 180 degrees on
 * the finished koozie, but the strip is symmetric, so centring it is the same
 * answer either way up.
 */
export function magnetRect(geom) {
  const back = geom?.zones?.find((z) => z.id === "back");
  if (!back || !(geom.pxPerInch > 0)) return null;
  const k = geom.pxPerInch;
  const { x0: bx0, x1: bx1, y0: by0, y1: by1 } = back.bounds;
  const cx = (bx0 + bx1) / 2;
  const cy = (by0 + by1) / 2;
  const w = MAGNET_INCHES.width * k;
  const h = MAGNET_INCHES.height * k;
  const rect = { x0: cx - w / 2, y0: cy - h / 2, x1: cx + w / 2, y1: cy + h / 2 };

  const border = MAGNET_INCHES.border * k;
  const seam = MAGNET_INCHES.seam * k;
  const n = MAGNET_INCHES.pads;
  const innerTop = rect.y0 + border;
  const padH = (h - 2 * border - (n - 1) * seam) / n;
  const pads = Array.from({ length: n }, (_, i) => {
    const y0 = innerTop + i * (padH + seam);
    return { x0: rect.x0 + border, y0, x1: rect.x1 - border, y1: y0 + padH };
  });
  return { ...rect, pads };
}
