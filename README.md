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
