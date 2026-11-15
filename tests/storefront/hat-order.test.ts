// Ported to @reel48/designer v1.15.0 from Reel48-Storefront tests/hat-order.test.ts (origin/main d78d90ee); imports point into this package.

// Dropped (storefront-only server, email and hub code): the submit handler (handleHatSubmit, parseHatDesignDoc: "reading a posted hat design", "the colours and the label on a posted hat", "adding a hat design to the cart", the submit and parse tests inside the E1, first-die and No. 6 suites), the team email, the customer's confirmation, design-link.ts and "what the hub reads" (the admin orders route), with their db/cart/quote mocks and the form()/NO_7 helpers.
// Kept: every describeDesign / isHatSpec assertion (the production spec). Where a spec test built its document through parseHatDesignDoc (the No. 6's), the document is built directly, so the parse's stamped fields (pantone, extraSpots, jsonUrl) are given by hand; its team-email assertions went with the email.

/**
 * A designed hat from submission to the people who make it (2026-10-20): the
 * hat's own submit handler, its production spec, the team email, the
 * customer's confirmation, its design link, and what the hub reads.
 */


import { describe, expect, it } from "vitest";
import { HAT_NO_6_DIE, HAT_NO_7_DIE, HAT_NO_7_V1_DIE, NATURAL_LABEL_GROUND, spotHome } from "../../src/core/hat-config.js";
import { HAT_NO_7_ANCHORS } from "../../src/core/hat-migrate.js";
import { areaHome } from "../../src/core/region.js";
import { PMS_COLORS } from "../../src/core/pms-palette.js";
import { describeDesign } from "../../src/core/coozie-spec.js";
import { isHatSpec } from "../../src/core/hat-spec.js";

const STORE_ID = "abc123xyz";

const BLOB = `https://${STORE_ID}.public.blob.vercel-storage.com`;
const ID = "2f6c1f2e-6b3a-4a5f-9d7e-0c1b2a3d4e5f";
// The first No. 7 die: an order placed before round E1, and a tab opened
// before it that checks out after. Round E1's are below ("on the current die").
const DIE = HAT_NO_7_V1_DIE;
// Two palette colours, whichever the palette file carries.
const PANEL = PMS_COLORS[0];
const BILL = PMS_COLORS[PMS_COLORS.length - 1];

function at(zone: string) {
  const z = DIE.zones.find((zz) => zz.id === zone)!;
  return { x: (z.rect.x + z.rect.w / 2) / DIE.stage.width, y: (z.rect.y + z.rect.h / 2) / DIE.stage.height };
}
const logo = (id: string, zone: string, scale = 0.2) => ({
  id,
  type: "logo",
  ...at(zone),
  rotation: 0,
  opacity: 1,
  fileName: "Acme.png",
  mimeType: "image/png",
  naturalWidth: 1200,
  naturalHeight: 600,
  scale,
});
const text = (id: string, zone: string) => ({
  id,
  type: "text",
  ...at(zone),
  rotation: 0,
  opacity: 1,
  text: "EST 1999",
  fontFamily: "Arial, sans-serif",
  fontStyle: "normal",
  fill: "#FFFFFF",
  align: "center",
  fontScale: 0.02,
});

/** Front embroidery, a left side and a tall inside label: $18.49 a hat at 100. */
function hatDoc(over: Record<string, unknown> = {}) {
  return {
    schemaVersion: 4,
    kind: "hat",
    dieId: "hat-no-7",
    parts: { crown_FL: PANEL.hex, crown_FR: PANEL.hex, bill_top: BILL.hex },
    zones: {
      front: { method: "embroidery", threads: ["#FFFFFF", "#A42A2E"] },
      left: { method: "embroidery", threads: ["#FFFFFF"] },
      label_tall: { method: "woven_label", shape: "tall", ground: "#1F2A44" },
    },
    elements: [logo("a", "front"), text("b", "left"), logo("c", "label_tall", 0.1)],
    ...over,
  };
}


describe("a hat design on the current die (round E1)", () => {

  const V2 = HAT_NO_7_DIE;
  const home = (zone: keyof typeof HAT_NO_7_ANCHORS.zonesTo) => {
    const [x, y] = HAT_NO_7_ANCHORS.zonesTo[zone];
    return { x: x / V2.stage.width, y: y / V2.stage.height };
  };
  const v2Doc = (over: Record<string, unknown> = {}) =>
    hatDoc({
      dieId: V2.id,
      // 900 px is the front's 4.5 in cap, 300 px a side's 1.5 in
      elements: [
        { ...logo("a", "front", 720 / V2.stage.width), ...home("front") },
        { ...text("b", "left"), ...home("left") },
        { ...logo("c", "label_tall", 300 / V2.stage.width), ...home("label_tall") },
      ],
      ...over,
    });


  it("is specced on its own die's frame, spots and caps", () => {
    const spec = describeDesign({ ...v2Doc(), extraSpots: 2 });
    expect(isHatSpec(spec)).toBe(true);
    if (!isHatSpec(spec)) return;
    expect(spec.size).toEqual({ id: "hat-no-7-v2", label: "Hat No. 7" });
    expect(spec.dieId).toBe("hat-no-7-v2");
    expect(spec.frame).toEqual({ width: 3720, height: 1808, pxPerInch: 200 });
    expect(spec.zones.map((z) => [z.id, z.rect, z.maxImprint])).toEqual(
      ["front", "left", "label_tall"].map((id) => {
        const z = V2.zones.find((zz) => zz.id === id)!;
        return [id, z.rect, z.maxImprint];
      }),
    );
    const rows = Object.fromEntries(spec.elements[0].rows.map((r) => [r.label, r.value]));
    expect(rows).toMatchObject({ Spot: "Front", "Placed size": "3.60 in × 1.80 in" });
    expect(Object.keys(rows)).not.toContain("Check size");
    // Placed from the spot's middle (where a new logo lands, areaHome), a
    // point on the hat, never the island's bleed corner: the front's is on
    // the centre seam, and this logo sits on E1's centre point, 0.10 in under it.
    const [fx, fy] = areaHome(V2.zones[0].area!)!;
    expect(rows).toMatchObject({
      "Centre in spot": "0.00 in right of and 0.10 in below the spot's middle",
      "Spot's middle": `on the centre seam, ${Math.round(fx)}px, ${Math.round(fy)}px on the die`,
    });
    const moved = describeDesign({ ...v2Doc(), elements: [{ ...logo("a", "front", 720 / V2.stage.width), x: (fx - 60) / V2.stage.width, y: (fy - 90) / V2.stage.height }] });
    const movedRows = Object.fromEntries(moved!.elements[0].rows.map((r) => [r.label, r.value]));
    expect(movedRows["Centre in spot"]).toBe("0.30 in left of and 0.45 in above the spot's middle");
    // A side's middle is not on a seam.
    const side = Object.fromEntries(spec.elements[1].rows.map((r) => [r.label, r.value]));
    expect(side["Spot's middle"]).toMatch(/^\d+px, \d+px on the die$/);
  });

  it("reads a side's rotation from the bottom of the hat, with its turn on the die for the proof", () => {
    const spec = describeDesign(
      v2Doc({
        elements: [
          { ...logo("a", "front", 720 / V2.stage.width), ...home("front"), rotation: 5 },
          { ...text("b", "left"), ...home("left"), rotation: -7 },
          { ...text("c", "right"), ...home("right"), rotation: 20 },
          { ...text("d", "right"), ...home("right"), rotation: 5 },
        ],
      }),
    );
    if (!isHatSpec(spec)) throw new Error("not a hat spec");
    const rows = spec.elements.map((el) => Object.fromEntries(el.rows.map((r) => [r.label, r.value])));
    // the front's level is the die's own 0, so it reads as it always has
    expect(rows[0].Rotation).toBe("5°");
    expect(rows[0]).not.toHaveProperty("Rotation on die");
    expect(rows[1]).toMatchObject({ Rotation: "0°, parallel to the bottom of the hat", "Rotation on die": "-7°" });
    expect(rows[2]).toMatchObject({ Rotation: "12° clockwise from parallel to the bottom of the hat", "Rotation on die": "20°" });
    expect(rows[3]).toMatchObject({ Rotation: "3° counter-clockwise from parallel to the bottom of the hat", "Rotation on die": "5°" });
    expect(spec.zones.map((z) => [z.id, z.level ?? 0])).toEqual([["front", 0], ["left", -7], ["right", 8]]);
  });

});


const stamped = () => ({ ...hatDoc(), extraSpots: 2, jsonUrl: `${BLOB}/coozie/${ID}/design.json`, pictureUrl: `${BLOB}/coozie/${ID}/picture-3d.png` });

describe("the hat's production spec", () => {
  it("names its own die, never null, with its frame, spots and colours", () => {
    const spec = describeDesign(stamped());
    expect(isHatSpec(spec)).toBe(true);
    if (!isHatSpec(spec)) return;
    expect(spec.size).toEqual({ id: "hat-no-7", label: "Hat No. 7" });
    expect(spec.frame).toEqual({ width: 1560, height: 1296, pxPerInch: 200 });
    expect(spec.zones.map((z) => [z.id, z.method, z.primary])).toEqual([
      ["front", "embroidery", true],
      ["left", "embroidery", false],
      ["label_tall", "woven_label", false],
    ]);
    expect(spec.zones[2]).toMatchObject({ shape: "tall", ground: "#1F2A44" });
    expect(spec.parts).toContainEqual({ id: "crown_FL", label: "Front left panel", color: PANEL.hex, pms: PANEL.code });
    expect(spec.extraSpots).toBe(2);
    // The front logo: 0.2 of 1560px at 200 px/in is 1.56 in wide, centred in its spot.
    const rows = Object.fromEntries(spec.elements[0].rows.map((r) => [r.label, r.value]));
    expect(rows).toMatchObject({ Spot: "Front", "Placed size": "1.56 in × 0.78 in", "Centre in spot": "2.25 in across, 1.13 in down" });
  });

  it("prefers the codes stamped on the order, and still reads a colour from before the palette", () => {
    const spec = describeDesign({
      ...stamped(),
      parts: { crown_FL: PANEL.hex, bill_top: "#F1F0EB", sweatband: "#1C1C1E" },
      pantone: { crown_FL: "PMS 0000 C" },
    });
    if (!isHatSpec(spec)) throw new Error("not a hat spec");
    expect(spec.parts.find((p) => p.id === "crown_FL")?.pms).toBe("PMS 0000 C");
    expect(spec.parts.find((p) => p.id === "bill_top")).toEqual({ id: "bill_top", label: "Bill, top", color: "#F1F0EB" });
    expect(spec.parts.find((p) => p.id === "sweatband")).toEqual({ id: "sweatband", label: "Sweatband", color: "#1C1C1E", band: "black" });
    // An order from before the sweatband followed the hat: the customer chose it.
    const older = describeDesign({ ...stamped(), parts: { crown_FL: PANEL.hex, sweatband: "#1C1C1E" } });
    if (!isHatSpec(older)) throw new Error("not a hat spec");
    expect(older.parts.find((p) => p.id === "sweatband")).toEqual({ id: "sweatband", label: "Sweatband", color: "#1C1C1E" });
    // A square label from before the rectangle-only rule is still described,
    // on the ground the screen showed when none was chosen.
    const square = describeDesign({ ...stamped(), zones: {}, elements: [logo("a", "front"), logo("d", "label_square", 0.05)] });
    if (!isHatSpec(square)) throw new Error("not a hat spec");
    // no ground recorded: made before the server recorded one, when the screen showed Natural
    expect(square.zones.find((z) => z.id === "label_square")).toMatchObject({ shape: "square", ground: NATURAL_LABEL_GROUND });
  });

  it("flags artwork past its spot's max imprint rather than refusing it", () => {
    const spec = describeDesign({ ...stamped(), elements: [logo("a", "left", 0.4)] });
    const rows = spec!.elements[0].rows.map((r) => r.label);
    expect(rows).toContain("Check size");
  });

  it("leaves a can cooler's spec as it was", () => {
    expect(describeDesign({ size: "slim", elements: [] })?.size).toEqual({ id: "slim", label: expect.any(String) });
    expect(isHatSpec(describeDesign({ size: "slim", elements: [] }))).toBe(false);
  });
});


describe("a No. 6 design (S2, 2026-10-24)", () => {
  const D6 = HAT_NO_6_DIE;
  const at6 = (zone: string) => {
    const z = D6.zones.find((zz) => zz.id === zone)!;
    const [x, y] = spotHome(D6.id, zone) ?? areaHome(z.area as never)!;
    return { x: x / D6.stage.width, y: y / D6.stage.height };
  };
  const no6Doc = (over: Record<string, unknown> = {}) => ({
    schemaVersion: 4,
    kind: "hat",
    dieId: D6.id,
    parts: { crown_F: PANEL.hex, crown_LS: PANEL.hex, crown_RS: PANEL.hex, crown_LB: PANEL.hex, crown_RB: PANEL.hex, bill_top: BILL.hex },
    zones: { front: { method: "embroidery" }, left: { method: "embroidery" }, label_tall: { method: "woven_label", shape: "tall" } },
    elements: [
      { ...logo("a", "front", 720 / D6.stage.width), ...at6("front") },
      { ...logo("b", "left", 300 / D6.stage.width), ...at6("left") },
      { ...logo("c", "label_tall", 300 / D6.stage.width), ...at6("label_tall") },
    ],
    ...over,
  });
  it("is specced on its own frame", () => {
    const doc = { ...no6Doc(), extraSpots: 2, jsonUrl: `${BLOB}/coozie/${ID}/design.json` };
    const spec = describeDesign(doc);
    expect(isHatSpec(spec)).toBe(true);
    if (!isHatSpec(spec)) return;
    expect(spec.size).toEqual({ id: "hat-no-6", label: "Hat No. 6" });
    expect(spec.frame).toEqual({ width: 3480, height: 2336, pxPerInch: 200 });
    expect(spec.parts).toContainEqual({ id: "crown_F", label: "Front panel", color: PANEL.hex, pms: PANEL.code });
    expect(spec.zones.find((z) => z.id === "left")).toMatchObject({ level: -6 });
  });
});
