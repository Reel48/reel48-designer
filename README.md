# @reel48/designer

The geometry, the design document, and the production spec for Reel48's product
designers. Consumed by **www.reel48.com** (Reel48-Storefront) and
**account.reel48.com**.

## Why this exists

`Reel48-Storefront/docs/REMOTE_ADMIN.md` says it plainly: re-deriving the die
geometry in a consumer means two copies, and **the one that drifts is the one
that gets an order made wrong.**

That was tolerable while one app drew koozies. It stops being tolerable now:
account.reel48.com renders the same designs, and hat, polo and cooler dies are
coming. Building each designer twice would mean building each *die* twice.

## The rule

> **If a file computes a number that ends up in `designJson`, it belongs in
> `core/`. If it computes a class name, it belongs to the host app.**

So the die geometry, the design reducer, the serializer and the canvas live
here — the canvas because it does nothing *but* convert between normalized
fractions and pixels in both directions, and getting either direction wrong
relocates artwork.

The panels, pickers and toolbars do not. The storefront's are Tailwind, the
portal's are `r48-*`, and that duplication is correct because none of it can
produce a wrong order.

## Stage frames are pinned

Every stored `designJson` holds element positions as **fractions of its die's
stage frame**. Changing a frame silently relocates artwork on orders already
placed, including orders already in production.

**Add a die. Never resize one.**

`tests/die-geometry.golden.json` was captured from the storefront's own
`dieGeometry()` and `traceDie()` before this package existed. It pins every
derived number and the full traced outline. A change of 0.001 to a measurement
fails it. If that failure is deliberate, it is not a test update — it is a
decision about designs that already exist.

## Adding a die

An entry in `DIES` plus an outline function. Nothing in the renderer or the
design document changes:

```js
"hat-trucker-5panel": {
  id: "hat-trucker-5panel",
  kind: "hat",
  label: "Trucker 5-panel front",
  productHandle: "trucker-mesh-back-5-panel",
  stage: { width: 1400, height: 900 },   // pinned from here on
  measurements: { imprintW: 4.5, imprintH: 2.25, crownH: 3.5 },
  outline: hatFrontOutline,
}
```

An outline returns its derived numbers, `cmds` (declarative path commands, so a
renderer can walk a shape it knows nothing about), and `zones`.

### Zones, not scalars

The koozie had one number, `bottomPanelStartY`, meaning "below this, artwork
prints upside down". A hat has no fold; a polo has a bounded imprint area; a
cooler wraps. Those are not different scalars, they are different zone
properties — so `zones` carries `flipped`, `snapLines` and `maxImprint`, and the
upside-down warning and snap guides generalise instead of being re-derived.

### `resolveDie` throws on purpose

The storefront's `resolveSize()` fell back to `standard` for anything
unrecognised. That was right while koozies were the only product — a design
stored before slim existed carries no size and has to land somewhere.

Once hats exist, the same fallback **renders a hat design on a can**. So a
caller that knows what it is opening passes `{ kind }` and gets a throw:

```js
resolveDie(id, { kind: "hat" })   // throws rather than returning a koozie
resolveDie(id)                    // legacy path, still falls back
```

## Consuming it

Pinned git dependency, so a push here cannot reach either production until
someone opens a PR in the consumer:

```jsonc
"@reel48/designer": "https://github.com/Reel48/reel48-designer/archive/refs/tags/v1.2.0.tar.gz"
```

Two entry points, split so they can be imported independently:

```js
import { dieGeometry, designReducer } from "@reel48/designer/core";   // zero deps
import { DesignStage } from "@reel48/designer/stage";                 // needs a DOM
```

**`core` must never drag Konva in behind it.** It gets imported by a server
action pricing a design, by a script building a supplier zip, and by tests —
none of which have a canvas.

`stage` ships `.jsx` and no build step, so a consumer transpiles it:
`transpilePackages: ["@reel48/designer"]` in `next.config`, or esbuild's `.jsx`
loader. `konva` and `react-konva` are optional peers, so a `core`-only consumer
installs neither.

### Styling the stage

`DesignStage` owns the styles it must **compute** — positions, sizes, the
typography a text element declares — and applies them through React's `style`
prop. It owns no class names: pass `classNames` (`root`, `textEditor`,
`rotationBadge`, `rotationBadgeAligned`) and `accent`.

That split is load-bearing for account.reel48.com, whose CSP is
`style-src 'self'` with no `unsafe-inline`. React sets the `style` prop via
`style.setProperty` (CSSOM), which `style-src` does not govern; a literal
`style="…"` attribute would be blocked.

## Layout

```
src/core/   zero dependencies — dies.js, design.js
src/stage/  optional peers: react, react-dom, konva, react-konva — DesignStage.jsx, useImage.js
tests/      golden files and unit tests
```

### Image readiness (v1.4.1)

`DesignStage` accepts an optional `onReadyChange(ready: boolean, error: string | null)` callback. It
reports `false` until the measured canvas and every current logo and pattern
image have committed, and `true` when artwork can be exported. A missing or
failed source is not ready. The callback runs after commits and reports changes;
its initial report is always delivered. Missing/failed images provide a customer-facing
error string; loading and ready states provide `null`, clearing errors on source
replacement. Image loads fail after 15 seconds so the host can surface stalled
requests without requiring an export attempt. Existing single-argument callbacks
remain compatible. Hosts should disable proof actions while
not ready and while their own artwork editor is open.

`await stageRef.current.exportProof()` waits up to 15 seconds for images, then
exports the committed artwork at native resolution. It rejects for image load
failure, timeout, unmount, concurrent export, or a design change during export.
PNG encoding also has a 15-second bound. A host should display the error and let
the customer retry. This protects the proof from being paired with a different
artwork revision when a logo is replaced, restored, or undone. Image replacement
never displays the previous source while the new source loads. The full UI layer
is excluded from proofs, and restored even when export fails.

The core document format, existing props, and successful `Promise<Blob>` export
contract are unchanged.

## v1.5.0: camera, gestures, phone hooks

Built for the storefront's full-screen phone designer: the canvas sits in a
fixed-height box on the top half of the screen, zooms into one face of the die
on the "logo" and "text" steps, and takes one-finger drags and two-finger
pinches. **Everything here is opt-in.** With none of the new props passed,
`DesignStage` renders, behaves and exports exactly as v1.4.1 (the layers are
never transformed, the proof is the same `toBlob` call), and every existing
golden file is unchanged.

### `core`

- `focusRects(geom)` → `{ front, back, base }` in native stage px: each zone's
  bounds under its id, plus `base`, the base disc's bounding box. A die with
  other zones and no disc gets just its zones.
- `cameraFor({ rect, native, displayW, viewport, rotate = 0, margin = 0.06, inset })` →
  Konva layer attrs `{ x, y, offsetX, offsetY, scaleX, scaleY, rotation }`.
  `rect: null` is the whole die fitted to the viewport; a rect (from
  `focusRects`) is centred and scaled to fit inside `margin` per side, turned by
  `rotate`. `inset` (`{ top, right, bottom, left }`, CSS px) is the part of the
  viewport the host covers with its own controls: the camera frames inside the
  rest and centres there. Pinned by `tests/camera.golden.json` (no inset) and
  `tests/camera.test.js` (inset).
- `containDisplayWidth(viewport, native)`, `cameraPoint(camera, point)`,
  `IDENTITY_CAMERA`: the fit, the forward transform, and the no-camera attrs.
- `ADD_LOGO` / `ADD_TEXT` take optional `x`, `y` (fractions, clamped to 0..1)
  and `rotation` (degrees). Non-numbers are ignored. Without them the element is
  byte-identical to before.

### `DesignStage` props

| Prop | Default | |
| --- | --- | --- |
| `fit` | `"width"` | `"contain"` fits the die inside the container. The host gives the container a definite height (e.g. a flex child at `height: 100%`). The Konva stage fills the box; the placeholder fills it too. |
| `view` | `{ focus: null }` | `{ focus: "front" \| "back" \| "base" \| null, rotate180?: boolean, inset?: { top, right, bottom, left } }`. Contain mode only. `rotate180` shows a focused face turned over, so artwork on the back panel (which prints upside down) reads upright. `inset` keeps the die clear of host overlays without resizing the stage (a resize re-fits instantly; a view or inset change glides). With `isolate` (v1.8.0, below), a focused view draws that side alone. |
| `animate` | `true` | Tween view changes (0.3s, StrongEaseOut). Pass `false` for `prefers-reduced-motion`. First layout and resizes are instant (resizes can glide from v1.6.0, see `animateResize`). |
| `interactive` | `true` | `false`: elements can't be selected, dragged or transformed, the transformer is hidden, and stage taps don't change selection. Selection itself is left alone. |
| `gestures` | `false` | Two-finger pinch (scale), twist (rotation, soft-snaps to 0/90/180/270 within 4°) and pan of the **selected** element, wherever the fingers land. One gesture is one undo step (`coalesceKey: "pinch-<ts>"`), including a drag or anchor transform it took over from. While on, a touch on bare stage clears selection on tap instead of touchdown, so the first finger of a pinch can land anywhere. |
| `touchAction` | `"pan-y"` | The container's `touch-action`. A full-screen host passes `"none"`. |
| `anchorSize` | `18` | Transformer anchor size. Passing it also makes anchors round. |
| `anchorPadding` | `0` | Transformer `padding`. |
| `anchorHitSize` | none | A finger-sized hit area for each anchor, larger than the anchor drawn (via the anchor's `hitStrokeWidth`), so a host can draw quiet small handles. |
| `inlineTextEdit` | `true` | `false`: double-tap doesn't open the canvas text editor (the host edits text in its own input). `beginTextEdit` still works. |
| `onManipulate(kind)` | none | Once at the start of each `"drag"`, `"transform"` or `"pinch"`. |
| `onSnap()` | none | When a drag snaps to a guide, or a twist snaps to a right angle. Fires on the transition into a snap, not when a manipulation starts already snapped. Meant for a small haptic. |

The rotation badge reads relative to the view, so an element turned 180° on
the back panel reads 0° in the back view. A selected logo whose bitmap loads
after it was selected (always, for a freshly added one) gets its handles the
moment its node registers; before v1.5.0 they appeared only on the next
unrelated re-render. The die-line and snap guides stay
hairlines under any zoom, and the snap distance stays constant on screen.

### Ref methods

- `hint(id, { reducedMotion = false } = {}) → Promise<void>`: sways the element
  6 screen px each way and back to exactly where it was. Never dispatches, so
  nothing reaches the document, undo or a proof. Resolves at once for
  `reducedMotion`, a missing node, or an element a finger is already moving.
  Any touch or click on the stage ends it first. One at a time; call it after
  the element has rendered.
- `exportProof()`: unchanged contract, and **camera-independent**. In contain
  mode it lands any camera tween, resets the layers to identity, exports the
  die's own rectangle at native resolution, and puts the camera back, all
  without a React render. The result is pixel-identical to a width-mode proof
  at the same display width, whatever the view.

## v1.6.0: the magnet, and a camera that glides on resize

Two more opt-in props for the storefront's phone designer. With neither passed,
`DesignStage` is v1.5.0 to the attr, and every existing golden file is
unchanged.

### `core`

- `magnetRect(geom)` → `{ x0, y0, x1, y1, pads: [{ x0, y0, x1, y1 } ×3] }` in
  native stage px: where a "with magnet" koozie's magnet strip sits, centred on
  the `back` zone. `null` for a die with no back zone. The part is measured, not
  chosen (Reel48's own product photo, 2026-10-09): `MAGNET_INCHES` is a strip
  1.15" × 3.35" with three near-square pads inside a stitched border, converted
  with the die's `pxPerInch`, so it is the same physical part on every die.
  Pinned by `tests/magnet.golden.json`.
- `cameraForResize(camera, fromDisplayW, toDisplayW)`: the camera that shows a
  die re-laid out at a new display width exactly where `camera` showed it at the
  old one (scale times old/new, offsets times new/old). `animateResize` starts
  its glide from it; `tests/camera.test.js` pins the invariant.

### `DesignStage` props

| Prop | Default | |
| --- | --- | --- |
| `magnet` | `null` | `"solid"` draws the magnet strip on the back panel; `"ghost"` draws it at 35% so artwork under it stays visible while it is being placed. Drawn in the die-line overlay layer: it follows the camera and never takes a tap. **Never in a proof**: `exportProof` hides it for its one synchronous draw, in both fits, so the screen never shows a frame without it. |
| `animateResize` | `false` | Contain only. When the container changes size under an unchanged view and die (a host panel growing or shrinking below the canvas), the camera tweens to the new fit instead of jumping. It starts from the camera that shows the re-laid-out die exactly where it was, so the die glides rather than jumping and then gliding. Still instant when `animate` is `false`, and on a die swap. |

## v1.7.0: sides that keep their artwork

One more opt-in prop pair for the storefront's phone designer, which shows one
side of the koozie at a time. With neither passed, `DesignStage` is v1.6.0 to
the attr.

### `core`

- `faceRegions(geom)` → `{ front, back, base }`: the panels as their zone rects
  (`{ kind: "rect", x0, y0, x1, y1 }`), the base as its disc
  (`{ kind: "circle", cx, cy, r }`), native px.
- `faceAt(geom, stage, { x, y })`: which side a point (stage fractions) is on,
  the disc first, then the side of `bottomPanelStartY`.
- `confineCenter(region, center, { hx, hy })` → `{ x, y, moved }`: the nearest
  centre at which a box of those half extents lies wholly inside (centred when
  it cannot fit). `fitScale(region, half)`: the shrink (≤ 1) that makes it fit.
- `rubberBand(over, limit)`: resistance past an edge that never reaches `limit`.
- `scaleRegion(region, k)`. All pinned by `tests/confine.test.js`.

### `DesignStage` props

| Prop | Default | |
| --- | --- | --- |
| `confine` | `false` | Each element stays wholly on the side its centre was on when a drag, anchor transform or pinch began, measured by its rotated bounding box. Dragged past the edge it gives way less and less (at most 24 screen px) and the side's dashed outline shows. Released outside, or made bigger than the side, ONE `UPDATE_ELEMENT` commits the nearest place it fits (shrunk if need be) and the node glides there from where it was let go: 250ms, `StrongEaseOut`, instant when `animate` is `false`. A proof always shows the committed position. |
| `onConfine({ id, face, toward })` | none | After a release had to be brought back. `toward` is the side the artwork's leading edge was being taken onto, or `null` past the can's outer edge, so a host can say "switch to the base to put it there". |

## v1.8.0: the artwork as a texture, and one side at a time

For the storefront, where a 3D can cooler is now the view everywhere: it wraps
the flat artwork round a model and repaints it on every design change, and the
flat stage appears only while artwork is being placed, framed on one side. Two
ref methods and one opt-in prop. With `isolate` unpassed, `DesignStage` draws
and behaves as v1.7.0, and every existing golden file is unchanged.

### `core`

- `artExportRect({ displayW, displayH, nativeW })` → `{ x: 0, y: 0, width,
  height, pixelRatio }`: the Konva export config that takes the die, and only
  the die, at native resolution from a stage laid out at that display size.
  Passed explicitly because a Konva layer's export otherwise defaults to the
  whole Konva stage, which in contain mode is the host's box. `null` while any
  size is missing, zero, negative or not finite. Not rounded: `width ×
  pixelRatio` can be 999.9999999999999 for a 1000px die, so the canvas can come
  out a pixel short. Pinned by `tests/camera.test.js`.
- `faceClipRegion(geom, face)` → `{ kind: "rect", x0, y0, x1, y1 }` (a panel's
  zone rect) or `{ kind: "circle", cx, cy, r }` (the base disc), native px:
  the side `isolate` draws. The same sides as `faceRegions`, without the
  `exclude` only confinement needs. `null` for no face, or one the die
  doesn't have.
- `traceRegion(ctx, region, scale = 1)`: adds a region's outline to any 2D
  context's current path as its own closed subpath, with no `beginPath`, so
  several make one path. Both pinned by `tests/confine.test.js`.

### `DesignStage` props

| Prop | Default | |
| --- | --- | --- |
| `isolate` | `false` | With `view.focus` naming a side, the stage draws that side alone: colour, pattern, artwork and the magnet are clipped to it (a panel's rect, or the base's disc) and nothing of its neighbours shows, so the host's own background shows round it. The die line becomes that side's own outline, in the die line's usual style, rather than fragments of the whole cut. The UI layer is not clipped: handles, guides and the side outline near the edge stay visible and grabbable, and artwork dragged past the edge is clipped until `confine` brings it back. When the focus changes under a glide, the side being left stays drawn until the camera lands; with no glide the new side is drawn at once. `focus: null` draws the whole die. **Never in an export**: the clip applies only to the stage's own canvases, so `exportProof` and `exportArtCanvas` take the whole die exactly as before. |

### Ref methods

- `exportArtCanvas() → HTMLCanvasElement | null`: the artwork layer alone,
  colour, pattern, logos and text, clipped to the die and **transparent
  outside it**, at the die's native stage size (1000 × 2000 for
  `koozie-standard`, 875 × 2600 for `koozie-slim`; give or take the pixel
  above, so draw it at the die's own size). No die line, no magnet, no guides,
  handles or side outline. Camera-independent like `exportProof`: the layer is
  taken at identity and put back in the same call, and a camera glide carries
  on. A sway or settle glide is drawn where the document has the element.
  `null` before the stage is measured (the placeholder is showing).

  **Synchronous, with no lock.** It touches no React state and nothing
  `exportProof` waits on, so it can be called on every change, never refuses
  while a proof is being made, and never aborts one. It does not wait for
  images either: a logo whose bitmap is still loading is not drawn yet, so a
  host paints again when `onReadyChange` reports `true`.
- `isTextEditing() → boolean`: `true` while the inline text editor is open.
  The text being edited is hidden on the stage, so it is missing from
  `exportArtCanvas()` too; a host skips (or retries) a paint while this is
  `true`. Read through a ref: asking never renders.
