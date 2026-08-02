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

So the die geometry, the design reducer, the serializer and the production spec
live here. The panels, pickers and toolbars do not — the storefront's are
Tailwind, the portal's are Carbon, and that duplication is correct because none
of it can produce a wrong order.

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
"@reel48/designer": "github:Reel48/reel48-designer#v1.0.0"
```

## Layout

```
src/core/   zero dependencies — dies, design document, spec, sanitize, upload
src/stage/  (next) peers: react, react-dom, konva, react-konva
tests/      golden files and unit tests
```
