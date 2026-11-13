// pricingFacts: the facts a design is priced from, and its refusals.
//
// The parity half runs every fixture (tests/fixtures/design-docs.json) and
// compares it with what the storefront's own code made of the same document
// (tests/pricing-parity.golden.json, written by running Reel48-Storefront
// origin/main's hat-submit.ts parseHatDesignDoc, then cart.ts hatLineSpots,
// and coozie-quote.ts's size and product rule, on each one). The other half
// pins the cases the hub prices: each method, extra spots, the label, both
// can sizes, and the refusals.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  HAT_DECORATIONS,
  InvalidDesignError,
  areaHome,
  hatDie,
  pmsById,
  pricingFacts,
  toDesignDescription,
  initialDesignState,
} from "../src/core/index.js";

const docs = JSON.parse(readFileSync(new URL("./fixtures/design-docs.json", import.meta.url), "utf8"));
const parity = JSON.parse(readFileSync(new URL("./pricing-parity.golden.json", import.meta.url), "utf8"));

/** pricingFacts, or the refusal it threw. */
function attempt(doc) {
  try {
    return { facts: pricingFacts(doc) };
  } catch (err) {
    if (!(err instanceof InvalidDesignError)) throw err;
    return { error: err };
  }
}

// Where pricingFacts is stricter than the storefront on purpose: a document
// whose schemaVersion or can size it does not know is refused, not read as a
// standard can (resolveSize) or taken whatever its version.
const STRICTER = {
  "no7-schema-3": "unknown_schema_version",
  "can-legacy-no-size": "unknown_schema_version",
  "can-unknown-size": "unknown_size",
};

describe("parity with the storefront's pricing inputs", () => {
  it("covers every fixture", () => {
    expect(Object.keys(parity).sort()).toEqual(Object.keys(docs).sort());
  });

  for (const [name, doc] of Object.entries(docs)) {
    const want = parity[name];
    it(name, () => {
      const got = attempt(doc);
      if (want.refused) {
        // Refused there, refused here, with the storefront's own sentence.
        expect(got.error?.message).toBe(want.refused);
        return;
      }
      if (STRICTER[name]) {
        expect(got.error?.reason).toBe(STRICTER[name]);
        return;
      }
      const f = got.facts;
      expect(f).toBeDefined();
      if (want.kind === "hat") {
        expect(f.product).toBe(`hat-${want.productHandle}`);
        expect(f.dieId).toBe(want.dieId);
        expect(f.size).toBeNull();
        // The ladder: the primary spot's method (cart.ts decorationType).
        expect(f.primaryMethod).toBe(want.decorationType);
        // The side-embroidery charges: every other spot, the label included.
        expect(f.extraSpots + (f.label ? 1 : 0)).toBe(want.sideSpots);
        expect(f.label).toBe(want.placements.some((p) => p.zone.startsWith("label_")));
      } else {
        expect(f).toEqual({
          product: "can-cooler",
          dieId: want.size === "slim" ? "koozie-slim" : "koozie-standard",
          size: want.size,
          primaryMethod: null,
          extraSpots: 0,
          label: false,
        });
        expect(want.productHandle).toBe(want.size === "slim" ? "custom-coozie-slim" : "custom-coozie");
      }
    });
  }
});

// ---- Builders for the cases the hub prices ----------------------------------

const NAVY = pmsById("pms-533-c").hex;
const PARTS = {
  "hat-no-7-v2": { crown_FL: NAVY, crown_FR: NAVY, bill_top: NAVY },
  "hat-no-6": { crown_F: NAVY, bill_top: NAVY },
};

function at(die, zone) {
  const z = die.zones.find((zz) => zz.id === zone);
  const [x, y] = areaHome(z.area ?? z.rect);
  return { x: x / die.stage.width, y: y / die.stage.height };
}
function logo(die, id, zone, inches) {
  return {
    id,
    type: "logo",
    ...at(die, zone),
    rotation: 0,
    opacity: 1,
    fileName: `${id}.png`,
    mimeType: "image/png",
    naturalWidth: 1000,
    naturalHeight: 500,
    scale: (inches * die.pxPerInch) / die.stage.width,
  };
}
const SIZE = { front: 3, left: 1.5, right: 1.5, back: 1.6, label_tall: 1 };
function hatDoc(dieId, { method, spots = [], zones = {} } = {}) {
  const die = hatDie(dieId);
  const all = ["front", ...spots];
  return {
    schemaVersion: 4,
    kind: "hat",
    dieId,
    parts: PARTS[dieId],
    zones: { ...(method ? { front: { method } } : {}), ...zones },
    elements: all.map((zone, i) => logo(die, `e${i}`, zone, SIZE[zone])),
  };
}

const HATS = [
  ["hat-no-7-v2", "hat-no-7"],
  ["hat-no-6", "hat-no-6"],
];

describe("hats", () => {
  for (const [dieId, product] of HATS) {
    describe(dieId, () => {
      for (const method of HAT_DECORATIONS) {
        it(`front only, ${method}`, () => {
          expect(pricingFacts(hatDoc(dieId, { method }))).toEqual({
            product,
            dieId,
            size: null,
            primaryMethod: method,
            extraSpots: 0,
            label: false,
          });
        });
      }

      it("a front with no method chosen is the front's first method: embroidery", () => {
        expect(pricingFacts(hatDoc(dieId)).primaryMethod).toBe("embroidery");
      });

      it("front + one extra spot", () => {
        expect(pricingFacts(hatDoc(dieId, { method: "pvc_patch", spots: ["left"] }))).toMatchObject({
          primaryMethod: "pvc_patch",
          extraSpots: 1,
          label: false,
        });
      });

      it("front + three extra spots, without the label", () => {
        expect(pricingFacts(hatDoc(dieId, { method: "woven_patch", spots: ["left", "right", "back"] }))).toMatchObject({
          primaryMethod: "woven_patch",
          extraSpots: 3,
          label: false,
        });
      });

      it("front + the label: the label is not an extra spot", () => {
        expect(pricingFacts(hatDoc(dieId, { method: "silicon_patch", spots: ["label_tall"] }))).toMatchObject({
          primaryMethod: "silicon_patch",
          extraSpots: 0,
          label: true,
        });
      });

      it("front + every spot + the label", () => {
        expect(pricingFacts(hatDoc(dieId, { method: "embroidery", spots: ["left", "right", "back", "label_tall"] }))).toMatchObject({
          extraSpots: 3,
          label: true,
        });
      });

      it("no front: the first used of left, right and back is primary", () => {
        const doc = hatDoc(dieId);
        const die = hatDie(dieId);
        doc.elements = [logo(die, "b", "back", 1.6), logo(die, "r", "right", 1.5)];
        expect(pricingFacts(doc)).toMatchObject({ primaryMethod: "embroidery", extraSpots: 1, label: false });
      });

      it("text counts as a spot only when it is more than spaces", () => {
        const doc = hatDoc(dieId, { method: "embroidery" });
        const die = hatDie(dieId);
        const blank = { id: "t", type: "text", ...at(die, "left"), rotation: 0, opacity: 1, text: "   ", fontScale: 0.01 };
        expect(pricingFacts({ ...doc, elements: [...doc.elements, blank] }).extraSpots).toBe(0);
        const real = { ...blank, text: "EST 1999" };
        expect(pricingFacts({ ...doc, elements: [...doc.elements, real] }).extraSpots).toBe(1);
      });

      it("a stamped spot count or placements in the document are ignored", () => {
        const doc = { ...hatDoc(dieId, { method: "embroidery" }), extraSpots: 0, placements: [] };
        const die = hatDie(dieId);
        doc.elements.push(logo(die, "x", "left", 1.5), logo(die, "y", "right", 1.5));
        expect(pricingFacts(doc).extraSpots).toBe(2);
      });
    });
  }

  it("takes a new document from the package's own reducer", () => {
    const doc = toDesignDescription(initialDesignState("hat-no-7-v2"));
    // Nothing on it yet: refused, as the storefront refuses an empty hat.
    expect(() => pricingFacts(doc)).toThrow(InvalidDesignError);
    const die = hatDie("hat-no-7-v2");
    const facts = pricingFacts({ ...doc, elements: [logo(die, "a", "front", 3)] });
    expect(facts).toMatchObject({ product: "hat-no-7", dieId: "hat-no-7-v2", primaryMethod: "embroidery" });
  });
});

describe("can coolers", () => {
  it.each([
    ["standard", "koozie-standard"],
    ["slim", "koozie-slim"],
  ])("%s", (size, dieId) => {
    const doc = toDesignDescription({ ...initialDesignState(dieId) });
    expect(doc.size).toBe(size);
    expect(pricingFacts(doc)).toEqual({ product: "can-cooler", dieId, size, primaryMethod: null, extraSpots: 0, label: false });
  });

  it("a blank can cooler is priced (the storefront asks the buyer, it does not refuse)", () => {
    expect(pricingFacts({ schemaVersion: 3, size: "slim", color: "#111111", patternId: null, elements: [] }).size).toBe("slim");
  });

  it("the magnet is not read from the document", () => {
    const facts = pricingFacts({ schemaVersion: 3, size: "standard", magnet: true, decorationType: "with_magnet", elements: [] });
    expect(facts).not.toHaveProperty("magnet");
  });
});

describe("refusals", () => {
  const refusal = (doc) => attempt(doc).error;

  it.each([
    ["null", null],
    ["a string", "{}"],
    ["an array", []],
  ])("not a document: %s", (_, doc) => {
    expect(refusal(doc)?.reason).toBe("not_an_object");
  });

  it("an unknown kind", () => {
    expect(refusal({ schemaVersion: 4, kind: "polo", dieId: "polo-1", elements: [] })?.reason).toBe("unknown_kind");
  });

  it("an unknown schemaVersion, on either kind", () => {
    expect(refusal({ ...hatDoc("hat-no-7-v2", { method: "embroidery" }), schemaVersion: 5 })?.reason).toBe("unknown_schema_version");
    expect(refusal({ size: "standard", elements: [] })?.reason).toBe("unknown_schema_version");
    expect(refusal({ schemaVersion: 2, size: "standard", elements: [] })?.reason).toBe("unknown_schema_version");
  });

  it("a hat document without kind: \"hat\"", () => {
    const { kind, ...doc } = hatDoc("hat-no-7-v2", { method: "embroidery" });
    expect(kind).toBe("hat");
    expect(refusal(doc)?.reason).toBe("unknown_kind");
  });

  it("an unknown die, or an inherited key", () => {
    expect(refusal({ ...hatDoc("hat-no-7-v2"), dieId: "hat-no-9" })?.message).toBe("This hat isn't one we can make from the designer yet.");
    expect(refusal({ ...hatDoc("hat-no-7-v2"), dieId: "constructor" })?.reason).toBe("unknown_die");
  });

  it("an unknown can size, or one inherited from Object", () => {
    expect(refusal({ schemaVersion: 3, size: "tallboy", elements: [] })?.reason).toBe("unknown_size");
    expect(refusal({ schemaVersion: 3, size: "constructor", elements: [] })?.reason).toBe("unknown_size");
  });

  it("an unknown zone", () => {
    expect(refusal(hatDoc("hat-no-7-v2", { zones: { visor: { method: "embroidery" } } }))?.reason).toBe("unknown_zone");
    // The first die's square label is not a zone of round E1's die.
    expect(refusal(hatDoc("hat-no-7-v2", { zones: { label_square: {} } }))?.reason).toBe("unknown_zone");
  });

  it("a method that is not offered on its spot", () => {
    expect(refusal(hatDoc("hat-no-7-v2", { method: "screen_print" }))?.message).toBe(
      "screen_print isn't offered on the front. Please choose another method.",
    );
    expect(refusal(hatDoc("hat-no-6", { method: "blank" }))?.reason).toBe("spots");
    const side = hatDoc("hat-no-7-v2", { method: "embroidery", spots: ["left"], zones: { left: { method: "woven_patch" } } });
    expect(refusal(side)?.message).toBe("Woven Patch isn't offered on the left side. Please choose another method.");
  });

  it("a method that is not a string", () => {
    expect(refusal(hatDoc("hat-no-7-v2", { zones: { front: { method: 3 } } }))?.reason).toBe("method");
  });

  it("nothing on the outside of the hat", () => {
    const doc = hatDoc("hat-no-7-v2");
    doc.elements = [];
    expect(refusal(doc)?.message).toBe("Add your logo to the front, a side or the back of the hat.");
  });

  it("an element the designer would not have made", () => {
    const doc = hatDoc("hat-no-7-v2", { method: "embroidery" });
    expect(refusal({ ...doc, elements: [{ ...doc.elements[0], mimeType: "application/pdf" }] })?.reason).toBe("element");
    expect(refusal({ ...doc, elements: [{ ...doc.elements[0], x: "0.5" }] })?.reason).toBe("element");
    expect(refusal({ ...doc, elements: [{ ...doc.elements[0], type: "shape" }] })?.reason).toBe("element");
    expect(refusal({ ...doc, elements: "a" })?.reason).toBe("elements");
  });

  it("more than five logos, or more than forty elements", () => {
    const die = hatDie("hat-no-7-v2");
    const six = Array.from({ length: 6 }, (_, i) => logo(die, `l${i}`, "front", 0.5));
    expect(refusal({ ...hatDoc("hat-no-7-v2"), elements: six })?.reason).toBe("too_many_logos");
    const text = (i) => ({ id: `t${i}`, type: "text", ...at(die, "front"), text: "A", fontScale: 0.01 });
    expect(refusal({ ...hatDoc("hat-no-7-v2"), elements: Array.from({ length: 41 }, (_, i) => text(i)) })?.reason).toBe("elements");
  });

  it("a part colour that is not on the Pantone palette, or a part the style does not have", () => {
    expect(refusal({ ...hatDoc("hat-no-7-v2"), parts: { crown_FL: "#123456" } })?.reason).toBe("not_pantone");
    expect(refusal({ ...hatDoc("hat-no-6"), parts: { crown_FL: NAVY } })?.reason).toBe("unknown_part");
  });

  it("a sweatband colour is never refused: it is worked out again", () => {
    expect(pricingFacts({ ...hatDoc("hat-no-7-v2", { method: "embroidery" }), parts: { crown_FL: NAVY, sweatband: "#00FF00" } }).primaryMethod).toBe(
      "embroidery",
    );
  });

  it("a thread or label ground that is not a #rrggbb colour", () => {
    expect(refusal(hatDoc("hat-no-7-v2", { zones: { front: { threads: ["red"] } } }))?.reason).toBe("thread");
    expect(refusal(hatDoc("hat-no-7-v2", { zones: { front: { threads: Array(16).fill("#FFFFFF") } } }))?.reason).toBe("thread");
    expect(refusal(hatDoc("hat-no-7-v2", { spots: ["label_tall"], zones: { label_tall: { ground: "white" } } }))?.reason).toBe(
      "label_ground",
    );
    expect(refusal(hatDoc("hat-no-7-v2", { zones: { front: { ground: "#FFFFFF" } } }))?.reason).toBe("label_ground");
    expect(refusal(hatDoc("hat-no-7-v2", { zones: { label_tall: { shape: "square" } } }))?.reason).toBe("label_shape");
  });

  it("a logo past its spot's cap or area, and artwork on no spot", () => {
    const die = hatDie("hat-no-7-v2");
    const big = { ...hatDoc("hat-no-7-v2"), elements: [logo(die, "a", "front", 4.8)] };
    expect(refusal(big)?.message).toMatch(/^Your logo on the front is bigger than the front can take\./);
    const stray = hatDoc("hat-no-7-v2", { method: "embroidery" });
    stray.elements.push({ ...logo(die, "s", "front", 0.4), x: 0.999, y: 0.999 });
    expect(refusal(stray)?.reason).toBe("spots");
  });

  it("a document over the storefront's 256 KB ceiling", () => {
    const doc = { ...hatDoc("hat-no-7-v2", { method: "embroidery" }), padding: "x".repeat(256 * 1024) };
    expect(refusal(doc)?.reason).toBe("too_large");
  });

  it("is an Error with a name, a sentence and a reason", () => {
    const err = refusal({ schemaVersion: 3, size: "tallboy", elements: [] });
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("InvalidDesignError");
    expect(err.message).toMatch(/\.$/);
  });
});
