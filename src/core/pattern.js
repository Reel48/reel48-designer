// v1.14.0: how a tiled background pattern is laid on a die.
//
// A pattern is one seamless tile, repeated. Two things make it read right on
// the finished product rather than only on the flat:
//
// - It starts at the first upright zone's top-left corner (a can cooler's front
//   panel), so a plaid's lines or a flag sit square on the front instead of
//   wherever the stage frame's (0, 0) happens to land.
// - Every `flipped` zone (a can cooler's back panel, which folds under and is
//   sewn upside down) draws the pattern a second time, turned 180 degrees
//   about that zone and anchored at its far corner. On the sewn sleeve the
//   back then reads upright, laid out exactly like the front: stars point up,
//   paisleys and waves face the same way on both sides.
//
// A flipped zone's copy is clipped to the zone's whole rect. The base is only
// the band between the two fold lines (the chords where the disc meets each
// panel, as the 3D model's UVs map it), and it keeps the front's orientation;
// the disc's caps that reach past a fold into a panel's rect are that panel's
// wall, so they turn with it (cutting them out left a dome of unturned pattern
// at the back panel's bottom edge).

/**
 * Where the pattern is drawn, in native stage px: a list of placements, the
 * first covering the whole die, each later one clipped to a flipped zone.
 *
 *   { x, y, rotation, clip }
 *
 * `x, y` is where the tile's origin lands and `rotation` is in degrees (0 or
 * 180), as Konva's `fillPatternX/Y/Rotation` take them (times the display
 * scale). `clip` is null for the first placement, otherwise the flipped
 * zone's rect `{ kind: "rect", x0, y0, x1, y1 }`.
 *
 * A die with no zones (or no upright zone) starts the tile at (0, 0), which is
 * what every version before v1.14.0 did.
 */
export function patternPlacements(geom) {
  const zones = geom?.zones ?? [];
  const upright = zones.find((z) => !z.flipped && z.bounds);
  const placements = [
    { x: upright ? upright.bounds.x0 : 0, y: upright ? upright.bounds.y0 : 0, rotation: 0, clip: null },
  ];
  for (const z of zones) {
    if (!z.flipped || !z.bounds) continue;
    const { x0, y0, x1, y1 } = z.bounds;
    placements.push({
      // Turned 180 degrees, the tile's origin is the zone's far corner: its
      // top-left once the panel is folded under and the sleeve stood upright.
      x: x1,
      y: y1,
      rotation: 180,
      clip: { kind: "rect", x0, y0, x1, y1 },
    });
  }
  return placements;
}

/**
 * Add a placement's clip to `ctx`'s path, times `scale`: the rect, with an
 * `exclude` disc (if a clip carries one) wound the other way so the default
 * (nonzero) rule cuts it out.
 */
export function tracePatternClip(ctx, clip, scale = 1) {
  const s = (v) => v * scale;
  ctx.rect(s(clip.x0), s(clip.y0), s(clip.x1 - clip.x0), s(clip.y1 - clip.y0));
  if (clip.exclude) {
    const { cx, cy, r } = clip.exclude;
    ctx.moveTo(s(cx + r), s(cy));
    // Anticlockwise, against the rect's clockwise winding: a hole.
    ctx.arc(s(cx), s(cy), s(r), 0, 2 * Math.PI, true);
    ctx.closePath();
  }
}

/**
 * The scale Konva's `fillPatternScale` takes for a tile drawn `pixelRatio`
 * image px per native stage px, at `displayScale` display px per native px.
 * A tile supplied at 3x (for a sharp screen and a sharp export) is drawn at a
 * third of its pixel size, so it lands at its true physical size.
 */
export function patternFillScale(displayScale, pixelRatio = 1) {
  const ratio = Number.isFinite(pixelRatio) && pixelRatio > 0 ? pixelRatio : 1;
  return displayScale / ratio;
}
