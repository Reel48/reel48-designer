import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  DIES,
  dieGeometry,
  resolveDie,
  traceDie,
  zoneAt,
} from "../src/core/dies.js";

// Captured from Reel48-Storefront/src/lib/coozie-config.js BEFORE this package
// existed, by running its own dieGeometry() and traceDie(). This file is the
// contract: it is what "the geometry did not move" means.
//
// If a change here is deliberate, it is not a test update — it is a decision
// that every design already stored against the affected die now renders in a
// different place, including designs on orders in production. Read the header
// of src/core/dies.js before touching it.
const GOLDEN = JSON.parse(
  readFileSync(fileURLToPath(new URL("./die-geometry.golden.json", import.meta.url)), "utf8"),
);

// The legacy ids the golden file was captured under.
const LEGACY_TO_NEW = { standard: "koozie-standard", slim: "koozie-slim" };

function tracedPath(geom) {
  const cmds = [];
  const ctx = {
    beginPath() {},
    moveTo(x, y) { cmds.push(["M", x, y]); },
    lineTo(x, y) { cmds.push(["L", x, y]); },
    arc(cx, cy, r, a0, a1, ccw) { cmds.push(["A", cx, cy, r, a0, a1, !!ccw]); },
    closePath() { cmds.push(["Z"]); },
  };
  traceDie(ctx, geom, 1);
  return cmds;
}

describe("die geometry is byte-identical to the storefront's", () => {
  for (const [legacyId, expected] of Object.entries(GOLDEN)) {
    const newId = LEGACY_TO_NEW[legacyId];

    it(`${legacyId}: every derived number is unchanged`, () => {
      const geom = dieGeometry(newId);
      for (const [key, value] of Object.entries(expected.geom)) {
        // Exact equality, not toBeCloseTo. A rounding difference here is a
        // real relocation of stored artwork, not noise.
        expect(geom[key], key).toBe(value);
      }
    });

    it(`${legacyId}: the traced outline is unchanged`, () => {
      // The outline moved from imperative ctx calls to declarative commands.
      // This asserts the change was a refactor and not a redraw.
      const drawn = tracedPath(dieGeometry(newId));
      const golden = expected.path.filter((c) => c[0] !== "begin");
      expect(drawn).toEqual(golden);
    });
  }
});

describe("resolveDie", () => {
  it("accepts the legacy `size` values stored in existing designs", () => {
    // Designs authored before dieId existed carry size: "standard" | "slim",
    // and some carry nothing at all.
    expect(resolveDie("standard").id).toBe("koozie-standard");
    expect(resolveDie("slim").id).toBe("koozie-slim");
    expect(resolveDie(undefined).id).toBe("koozie-standard");
    expect(resolveDie({ id: "koozie-slim" }).id).toBe("koozie-slim");
  });

  it("THROWS rather than falling back when a kind is named", () => {
    // The storefront's resolveSize() fell back to standard for anything
    // unrecognised, which was right while koozies were the only product. Once
    // hats exist, that same fallback renders a hat design on a can — a wrong
    // product made at full cost. A caller that knows what it is opening says so
    // and gets an error instead.
    expect(() => resolveDie("hat-trucker-5panel", { kind: "hat" })).toThrow();
    expect(() => resolveDie(undefined, { kind: "hat" })).toThrow();
    expect(() => resolveDie("koozie-standard", { kind: "hat" })).toThrow();
    // And still resolves when the kind matches.
    expect(resolveDie("standard", { kind: "koozie" }).id).toBe("koozie-standard");
  });
});

describe("stage frames are pinned", () => {
  it("has not changed either koozie frame", () => {
    // Every stored designJson holds positions as fractions of these numbers.
    expect(DIES["koozie-standard"].stage).toEqual({ width: 1000, height: 2000 });
    expect(DIES["koozie-slim"].stage).toEqual({ width: 875, height: 2600 });
  });

  it("keeps a slim stage pixel the same physical size as a standard one", () => {
    const a = dieGeometry("koozie-standard").pxPerInch;
    const b = dieGeometry("koozie-slim").pxPerInch;
    expect(Math.abs(a - b)).toBeLessThan(0.1);
  });
});

describe("zones replace bottomPanelStartY", () => {
  it("marks the fold-under panel as flipped", () => {
    const die = DIES["koozie-standard"];
    const geom = dieGeometry(die.id);

    // A point on the front panel.
    const front = zoneAt(geom, 0.5, 0.2, die.stage);
    expect(front?.id).toBe("front");
    expect(front?.flipped).toBe(false);

    // A point on the panel that folds under and prints upside down.
    const back = zoneAt(geom, 0.5, 0.8, die.stage);
    expect(back?.id).toBe("back");
    expect(back?.flipped).toBe(true);
  });

  it("agrees with the scalar it replaces", () => {
    // bottomPanelStartY is still emitted for existing consumers; the zone must
    // not disagree with it, or the warning fires in a different place than it
    // used to.
    const die = DIES["koozie-standard"];
    const geom = dieGeometry(die.id);
    const justBelow = zoneAt(geom, 0.5, geom.bottomPanelStartY + 0.01, die.stage);
    expect(justBelow?.flipped).toBe(true);
  });

  it("returns null off the die", () => {
    const die = DIES["koozie-standard"];
    const geom = dieGeometry(die.id);
    // The gap between the panels, where the disc is — not a printable zone.
    expect(zoneAt(geom, 0.02, 0.5, die.stage)).toBeNull();
  });
});
