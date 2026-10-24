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

- `exportArtCanvas({ color = true } = {}) → HTMLCanvasElement | null`: the
  artwork layer alone, colour, pattern, logos and text, clipped to the die and
  **transparent outside it**, at the die's native stage size (1000 × 2000 for
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

  **`{ color: false }`** (v1.9.0) leaves the ground colour out: the pattern,
  logos and text, still clipped to the die, with the colour's area
  transparent. Fill the colour under it yourself and the picture is the same;
  a colour change then needs only a new fill, not a new export, which is what
  lets a 3D view follow a colour drag frame by frame.
- `isTextEditing() → boolean`: `true` while the inline text editor is open.
  The text being edited is hidden on the stage, so it is missing from
  `exportArtCanvas()` too; a host skips (or retries) a paint while this is
  `true`. Read through a ref: asking never renders.

## v1.10.0: artwork that runs past its side, trimmed at the edge

A big logo often has to run past its side to fill it (a wide mark on a tall
panel). One optional field in the document and one opt-in prop pair. A
document without the field, on a stage without the props, draws, behaves and
serializes as v1.9.0, and every existing golden file is unchanged.

### `core`

- An element may carry `clip: "front" | "back" | "base"`: the side it is
  trimmed to. Whatever of it lies past that side's edge (`faceClipRegion`) is
  not printed. Absent when the element is whole; `UPDATE_ELEMENT` with
  `clip: null` removes the key; `toDesignDescription` writes it only when set.
  Pinned by `tests/design.test.js`. Schema version unchanged (an added
  optional field, like `source`).
- `insideRegion(region, center, { hx, hy })`: whether a box lies wholly inside
  a region, so nothing of it would be trimmed. Not `!confineCenter().moved`,
  which is also false for a box too big to fit, centred. Pinned by
  `tests/confine.test.js`.

### `DesignStage`

Every element is drawn inside a `Group` of its own, whose `clipFunc` traces its
`clip` side, so the trim is in **every** draw: the screen, `exportProof` and
`exportArtCanvas`. (Unlike `isolate`, a trim is print, not a way of looking.)
The group is there for every element, trimmed or not, so a trim coming or going
never remounts the element and never reloads a logo's bitmap. The part trimmed
off takes no tap; the transformer still shows the element's whole box.

| Prop | Default | |
| --- | --- | --- |
| `overflow` | `false` | With `confine`: an element's first release past its side is brought back, exactly as v1.7.0. After that (for this stage's life, or at once for an element already trimmed) it moves freely, no rubber band, with the side's outline showing while it is past the edge. Let go, it stays where it was put, its centre kept on the side, and ONE `UPDATE_ELEMENT` sets `clip` to the side, or removes it when the element ends up wholly inside. A trimmed element is confined to the side it is trimmed to. |
| `onClip({ id, face })` | none | After a release that newly trims an element. With `overflow`, `onConfine` also carries `canOverflow: true`, so the host can say the next drag out will stay. |

## v1.11.0: hats, starting with the No. 7

The first die that is not a koozie, and the document shape it needs. Every
addition is keyed to the die's kind: a koozie document on a stage without the
new prop draws, behaves and serializes exactly as v1.10.0, and every existing
golden file is unchanged.

### The `hat-no-7` die

One **atlas** per hat style: each print spot is a rect island on one sheet,
1560 x 1296 px at a fixed 200 px/in, with gutters of at least 0.4 in between.
One sheet keeps one document, one undo history, one art texture and one proof,
as the koozie has. The 3D model's print UVs are this frame (u = x/W,
v = 1 - y/H).

| Zone | Rect (in) | `methods` |
| --- | --- | --- |
| `front` | 4.5 x 2.25 | `embroidery`, `pvc_patch`, `silicon_patch`, `woven_patch` |
| `left`, `right` | 2.0 x 1.5 | `embroidery` |
| `back` | 2.5 x 0.875 | `embroidery` |
| `label_tall` | 1.75 x 1.0 | `woven_label` (`shape: "tall"`) |
| `label_square` | 1.0 x 1.0 | `woven_label` (`shape: "square"`) |

- `kind: "hat"`, `productHandle: "no-7"`, built by `hatOutline` (src/core/hats.js)
  from a transcription of the model build's `die_no7.json`.
  `tests/hat-no-7.golden.json` is a byte copy of that file, and
  `tests/hat.test.js` asserts the die equals it.
- **Each rect is its zone's maximum imprint** (`maxImprint`, inches), so
  keeping artwork in its zone is keeping it inside what can be made.
- `reserved` holds empty rects for the bill top and under the bill: not in
  `zones`, not in the cut, kept free so adding those spots later never moves the
  frame.
- `status` is "proposed: pending the physical fit test". **The frame is pinned
  like a koozie's once an order exists against it**; until then a new
  `die_no7.json` replaces `hats.js` and the golden together.

### `core`

- **Schema version 4** (`ZONED_SCHEMA_VERSION`) for any die that is not a
  koozie. `initialDesignState("hat-no-7")` is
  `{ schemaVersion: 4, kind: "hat", dieId: "hat-no-7", parts: {}, zones: {}, elements: [], selectedId: null }`,
  and `toDesignDescription` writes it without `selectedId`. The elements are
  v3's, positions as fractions of the die's frame. Koozies keep version 3 with
  `size`; `legacySizeId` is untouched. (Before this, a hat id fell through
  `legacySizeId` as `"standard"`: a hat read back as a can cooler.)
  - `parts`: `{ <partId>: <colour> }`.
  - `zones`: `{ <zoneId>: { method, threads?, shape?, ground? } }`: the
    method, the thread ids, a label's shape, and the spot's ground colour (a
    label's background).
  - A colour is a hex `#RRGGBB` or the host's palette id, and thread ids are
    ids. The package checks their shape; the host checks its palettes.
- **Reducer actions.** Each refused action returns the same state (no undo step).
  - `SET_PARTS { parts }`: a preset, every part at once, as one undo step.
  - `SET_PART_COLOR { part, color }`: one part; `color: null` takes it off.
  - `SET_ZONE { zone, method?, threads?, shape?, ground? }`: merges into the
    spot's decoration, and `null` takes a field off. `method: null` takes the
    whole spot off. A method the die zone does not list is refused; a zone
    that lists one method takes it without being told.
  - **The inside label is one spot in two shapes, one at a time.** Pass
    `shape`, or name the other label zone. The other shape's decoration goes,
    its settings carry over, and its artwork moves across (`moveToZone`).
    All of it is one undo step.
  - `MOVE_TO_ZONE { from, to }`: the same move on its own.
- **Refusals on the other kind.**
  - A version 4 document refuses `SET_COLOR`, `SET_PATTERN` and every
    `SET_SIZE`.
  - A koozie refuses the new actions, and a `SET_SIZE` to a die that is not a
    koozie.
  - `NUDGE_ELEMENT` converts by `dieId ?? size`.
- **Placement on add, version 4 only.**
  - `ADD_LOGO` / `ADD_TEXT` take a finite positive `scale` / `fontScale`.
  - `fitToZone` (a zone id, or `true` for the side at `x, y`) centres the new
    element in that zone at 80% of it, turned by `rotation`. Text is sized by
    the default text's Arial box (4.002 x 1 em).
  - Explicit `x`, `y`, `scale` or `fontScale` win, and an unknown zone is
    ignored.
  - A koozie add ignores all three, as v1.10.0 did. The storefront's can
    cooler designer already sends a `scale` on every add, so honouring it
    would change every can cooler's first placement.
- **Sides are zones.** On a die without the koozie's fold
  (`isKoozieGeometry(geom)` is false):
  - `faceRegions` / `faceClipRegion` are the zone rects, by zone id, each kept
    to its `maxImprint`.
  - `faceAt` is the zone a point is in, or the nearest one (`nearestZone`), so
    a gutter belongs to the island beside it.
  - So `confine`, `overflow`, `clip`, `isolate` and `view.focus` all work per
    zone with no stage change. `magnetRect` is null: only a koozie has a
    magnet, and the hat has a zone named `back` too.
- **Spot helpers.**
  - `zoneOfElement(geom, stage, el)`: the side an element counts for (its
    centre's, or its `clip`'s).
  - `elementFits(geom, stage, el, size?)`: whether its turned box lies inside
    that side's imprint. A logo is measured from `scale`. Text needs its
    measured `size` (native px) and is `null` without it; a trimmed element
    fits.
  - `moveToZone(state, from, to)`: one similarity about the two zones' centres,
    shrunk (never grown) to fit.
  - `designDie(state)`: the die a document is on. A version 4 document whose
    `dieId` is not a die of its `kind` in this build **throws**, and so does
    the stage drawing it, rather than opening on a koozie's frame. Check a
    stored document with `resolveDie(id, { kind })` before loading it.

### `DesignStage`

The die is `dieId ?? state.dieId ?? state.size`, so a version 4 document draws
on its own die with no prop. On a zoned die a dragged element snaps only to
the centre lines of the zone it is confined to, or is over: the atlas packs
spots side by side, and a neighbour's centre line is not a place on this spot.

| Prop | Default | |
| --- | --- | --- |
| `zoneFill` | none | `{ [zoneId]: colour }`: fills those zones' islands under the artwork, such as the part colour behind a spot or a label's ground. It is print: in `exportProof` as on screen. `exportArtCanvas({ color: false })` leaves it out with the ground colour, for a 3D host that colours the parts itself. A fill change during an export fails that export, as a design change does. |

## v1.12.0: whole-panel areas on the No. 7, and handles for editing on the 3D hat

For round E1 (Brayden, 2026-10-21): a logo may go "anywhere on the front two
panels", and a side embroidery gets "the entire panel". The `hat-no-7` die and
every document on it are unchanged; the koozie dies and their golden files are
too.

### The `hat-no-7-v2` die

- A new die id. The frame moved (3720 x 1808 at 200 px/in), and documents
  already made on `hat-no-7` keep opening on that one, which now says
  `supersededBy: "hat-no-7-v2"`. Both are "No. 7" with the same
  `productHandle`, so a host listing hat dies for new designs skips the ones
  with `supersededBy`.
- It is built by `hatOutline` from round E1's `e1/die_no7.json`, transcribed
  in `src/core/hat-no-7-v2.js`. `tests/hat-no-7-v2.golden.json` is a byte
  copy of that file. It names its die `"hat-no-7"` (the product's); the test
  checks every other field.
- Zones: `front`, `left`, `right`, `back` and `label_tall`. There is no square
  label.
- **Two limits per zone, kept apart:**
  - `area` (`{ outline, holes }`, die px) is where art may sit. The front is
    both front panels with the eyelets as holes, and each side is its whole
    panel. The back and the label are rects.
  - `maxImprint` (the CAP) is how big it may print, unchanged at 4.5 x 2.25
    front, 2 x 1.5 sides, 2.5 x 0.875 back, 1.75 x 1 label.
  - `rect` is only the island's bounding box, bleed included.
- The cut (`cmds`) traces each area's rings, holes wound against the outline,
  so the art mask, the die line, `isolate` and a trim all follow the area with
  its holes cut out.
- Snap lines run through each area's home. On the front that is the centre
  seam, to a fifth of a pixel.

### `core`

- **`region.js`, the hat placer's confine rule, verbatim** from the
  storefront's `hat-confine.js`, with its tests (`tests/region.test.ts`).
  Exported: `confinePose`, `bandPose`, `poseValid`, `overhang`, `areaHome`,
  `areaRings`, `areaBounds`, `areaRect`, `pointInArea`, `rotatedSize`, and its
  rubber band as `areaRubberBand`. `rubberBand` stays confine.js's koozie curve.
- **Area sides.** `faceRegions` gives a zone with an area
  `{ kind: "area", x0, y0, x1, y1, rings, area, cap }`: no cap-sized box
  centred in the rect. The same object every time.
  - `faceClipRegion`, `traceRegion`, `scaleRegion`, `confineCenter`,
    `insideRegion`, `fitScale` and `elementFits` take it.
  - `elementFits` is region.js's `poseValid`: in the area, clear of the holes,
    within the cap.
- **`fitToZone` on an area** places a new piece at `areaHome` at 80% of the
  cap. An explicit `x` / `y` / `scale` is kept, then confined, so the piece
  always lands valid.
- **`moveToZone` on an area** measures each side by its cap about its home,
  and confines what it moves (a logo by its box, text by its centre).
- **`artExportRect({ rect, scale })`**: one part of the die, at an output
  scale. Without them it is v1.8.0's answer.

### `DesignStage`

- **Live confine on an area side** uses region.js:
  - a drag travels from the last valid pose, stopping at an edge and sliding
    along it, and never jumps an eyelet, with region.js's rubber band past the
    edge;
  - an anchor resize or turn and a pinch keep the last valid pose current
    each frame too (a pinch that takes over a drag goes on from the drag's);
  - a release from a drag, the anchors or a pinch commits `confinePose` of
    where the finger had it, from that pose. Resizes and turns are shrunk to
    the cap; a drag keeps its size unless the piece fits nowhere at it;
  - the side's outline, holes included, shows while art is pressed past it.
- **`exportArtCanvas({ color, rect, only, exclude, scale })`**:
  - `rect` (native die px) takes one part of the die;
  - `scale` is output px per die px, 1 by default;
  - `only` (an element id) draws that element alone, and `exclude` (ids)
    leaves those out. The ones left out are held invisible for that one draw;
  - the ground still follows `color`, so pass `color: false` for a piece on
    transparent.
- **`measureElement(id)` → `{ cx, cy, w, h, rotation } | null`**: an element
  as the stage draws it, in native die px, its size unturned. It reads where a
  sway or a settle is going. Text's size needs its font, so re-read it after
  `fontVersion` changes.

## v1.13.0: the No. 6

A second hat style (Brayden signed its model off on 2026-10-24). The No. 7's
dies, every document on them, the koozie dies and their golden files are
unchanged.

### The `hat-no-6` die

- A structured 5-panel canvas cap with a plastic snapback: `label: "No. 6"`,
  `productHandle: "no-6"`, its own frame (3480 x 2336 at 200 px/in), no
  `supersededBy`.
- It is built by `hatOutline` from the No. 6 model build's `die_no6.json`,
  transcribed in `src/core/hat-no-6.js`. `tests/hat-no-6.golden.json` is a
  byte copy of that file, and the test rebuilds every field of it, under the
  file's own id.
- Zones: `front` (the flat front face below the top bend; the No. 6's front
  has no eyelets), `left` and `right` (each whole side panel, round its
  eyelet), `back` (above the snapback, round two eyelets) and `label_tall`.
  There is no square label. The caps are the No. 7's: 4.5 x 2.25 front,
  2 x 1.5 sides, 2.5 x 0.875 back, 1.75 x 1 label. `reserved` keeps the bill
  top and under the bill.
- **Levels.** Each zone of its die file has a `level`: the turn, in degrees
  as `rotation` is stored, at which art runs parallel to the bottom of the
  hat. The sides are -6 and +6, the rest 0.

### `core`

- **`hatOutline` carries a zone's `level`** when its layout has one (0
  included). The No. 7's dies have none, so their geometry is as v1.12.0 made
  it.
- `diesOfKind("hat")` is now `["hat-no-7", "hat-no-7-v2", "hat-no-6"]`, and the
  stage frames test pins all three hat frames.
