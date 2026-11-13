// Ported to @reel48/designer v1.15.0 from Reel48-Storefront tests/hat-designer.test.ts (origin/main d78d90ee); imports point into this package.
// Dropped (storefront-only code and copy): "a piece stays on its spot" (hatHistoryReducer), "the hat's price on screen" (hat-pricing: priceHat, hatCheckoutTotals) and the whole "/design/hat is launched" suite (the page, HatDesignerFacts, hat-copy, md-mirror, sitemap/llms.txt, product-designers, designer-links).
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDraftStore } from "../../src/core/coozie-draft.js";
import { HAT_DRAFT_KEY, hatFingerprint, parseHatDraft, serializeHatDraft } from "../../src/core/hat-draft.js";
import { HAT_NO_7_DIE, HAT_NO_7_V1_DIE } from "../../src/core/hat-config.js";
import { nearestPms, pmsByHex, PMS_COLORS } from "../../src/core/pms-palette.js";
import { SWEATBANDS, sweatbandFor, withSweatband } from "../../src/core/sweatband.js";
import * as steps from "../../src/core/hat-step-machine.js";
import { zoneOfElement } from "../../src/core/hat-placements.js";

/**
 * The No. 7 hat designer's own logic (PR 4b): its saved draft, its steps, the
 * price it shows, and (PR 5) how it is launched: linked from the No. 7's
 * product page without taking its Add to cart away, indexed and mirrored. The
 * cart, the submit and the spots' rules are hat-order.test.ts and
 * hat-placements.test.ts; this is what the page adds on top.
 */

// The first No. 7 die: these designs are the ones made before round E1, which
// a draft or a link still holds (and which open on the current die).
const DIE = HAT_NO_7_V1_DIE;
// Two palette colours, whichever the palette file carries.
const PANEL = PMS_COLORS[0].hex;
const BILL = PMS_COLORS[PMS_COLORS.length - 1].hex;

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
  assetRevision: `${id}-r1`,
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
function hatDesign(over: Record<string, unknown> = {}) {
  return {
    schemaVersion: 4,
    kind: "hat",
    dieId: "hat-no-7",
    parts: withSweatband({ crown_FL: PANEL, crown_FR: PANEL, bill_top: BILL }),
    zones: {
      front: { method: "embroidery" },
      left: { method: "embroidery" },
      label_tall: { method: "woven_label", shape: "tall", ground: "#1F2A44" },
    },
    elements: [logo("a", "front"), text("b", "left"), logo("c", "label_tall", 0.1)],
    selectedId: "a",
    ...over,
  };
}

function memoryBackend() {
  const data = new Map<string, unknown>();
  return {
    data,
    get: vi.fn(async (key: string) => data.get(key)),
    put: vi.fn(async (key: string, value: unknown) => {
      data.set(key, value);
    }),
    delete: vi.fn(async (key: string) => {
      data.delete(key);
    }),
    keys: vi.fn(async () => [...data.keys()]),
  };
}

const png = (text = "x") => new Blob([text], { type: "image/png" });

type HatDraft = NonNullable<ReturnType<typeof parseHatDraft>>;
/** The shared store, typed for a hat's record (its JSDoc names the can cooler's). */
function hatStore(backend: ReturnType<typeof memoryBackend>) {
  return createDraftStore({ backend, parse: parseHatDraft as never }) as unknown as {
    save(record: ReturnType<typeof serializeHatDraft>, key: string): Promise<void>;
    load(key: string): Promise<HatDraft | null>;
  };
}

function draftInput() {
  return {
    design: hatDesign(),
    step: "label",
    quantity: 100,
    logos: [
      { elId: "a", assetId: "a-r1", blob: png("front"), fileName: "Acme.png", mimeType: "image/png", naturalWidth: 1200, naturalHeight: 600 },
      { elId: "c", assetId: "c-r1", blob: png("label"), fileName: "Acme.png", mimeType: "image/png", naturalWidth: 1200, naturalHeight: 600 },
    ],
    fonts: [],
    thumbnail: png("picture"),
    checkout: null,
    shipping: { express: true },
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("the hat draft", () => {
  it("comes back from the store whole: logos, picture, spots and colours", async () => {
    const backend = memoryBackend();
    await hatStore(backend).save(serializeHatDraft(draftInput()), HAT_DRAFT_KEY);
    // The files are kept apart from the record, under the hat's own key.
    const stored = backend.data.get(HAT_DRAFT_KEY) as { logos: Record<string, unknown>[] };
    expect(stored.logos.every((l) => !("blob" in l))).toBe(true);
    expect([...backend.data.keys()].filter((k) => k.startsWith(`${HAT_DRAFT_KEY}:asset:`))).toHaveLength(2);

    const draft = await hatStore(backend).load(HAT_DRAFT_KEY);
    expect(draft).not.toBeNull();
    expect(draft!.design.elements.map((el: { id: string }) => el.id)).toEqual(["a", "b", "c"]);
    expect(await draft!.logos[0].blob.text()).toBe("front");
    expect(await draft!.thumbnail!.text()).toBe("picture");
    expect(draft!.design.zones).toEqual(hatDesign().zones);
    expect(draft!.design.parts).toEqual(hatDesign().parts);
    expect(draft!.shipping).toEqual({ express: true });
    expect(draft!.step).toBe("label");
    // The load keeps the files it read.
    expect([...backend.data.keys()].filter((k) => k.startsWith(`${HAT_DRAFT_KEY}:`))).toHaveLength(3);
  });

  it("moves an old design onto the palette and its sweatband, and its square label onto the rectangle, when it opens again", () => {
    const old = {
      ...draftInput(),
      design: hatDesign({
        // The lab's placeholder colours, and a sweatband chosen by hand.
        parts: { crown_FL: "#1F2A44", crown_FR: "#1F2A44", bill_top: "#F1F0EB", sweatband: "#A42A2E" },
        zones: { front: { method: "embroidery" }, label_square: { method: "woven_label", shape: "square", ground: "#123456" } },
        elements: [logo("a", "front"), text("b", "left"), logo("c", "label_square", 0.05)],
      }),
    };
    const { parts, zones, elements } = parseHatDraft(serializeHatDraft(old))!.design;
    expect(parts.crown_FL).toBe(nearestPms("#1F2A44")!.hex);
    expect(parts.bill_top).toBe(nearestPms("#F1F0EB")!.hex);
    for (const [id, hex] of Object.entries(parts)) if (id !== "sweatband") expect(pmsByHex(hex)).not.toBeNull();
    expect(parts.sweatband).toBe(SWEATBANDS[sweatbandFor(parts.crown_FL)!].hex);
    expect(zones).toEqual({
      front: { method: "embroidery" },
      label_tall: { method: "woven_label", shape: "tall", ground: "#123456" },
    });
    // On the current die, which has the rectangle only.
    const label = elements.find((el: { id: string }) => el.id === "c");
    expect(zoneOfElement(label, HAT_NO_7_DIE)?.id).toBe("label_tall");

    // A design already on the palette comes back as it was.
    expect(parseHatDraft(serializeHatDraft(draftInput()))!.design.parts).toEqual(hatDesign().parts);
  });

  it("keeps the 3D picture's link through a reload", () => {
    const checkout = {
      designId: "2f6c1f2e-6b3a-4a5f-9d7e-0c1b2a3d4e5f",
      fingerprint: "h1:abc",
      uploaded: { proofUrl: "https://x/p.png", pictureUrl: "https://x/3d.png", logoUrls: [], fontUrls: [], jsonUrl: null, artworkFiles: [] },
    };
    const draft = parseHatDraft(serializeHatDraft({ ...draftInput(), checkout }))!;
    expect(draft.checkout?.uploaded).toMatchObject({ proofUrl: "https://x/p.png", pictureUrl: "https://x/3d.png" });
  });

  it("never keeps the selection, and drops a logo whose file is gone", () => {
    const record = serializeHatDraft({ ...draftInput(), logos: draftInput().logos.slice(1) });
    expect("selectedId" in record.design).toBe(false);
    const draft = parseHatDraft(record)!;
    expect(draft.design.elements.map((el: { id: string }) => el.id)).toEqual(["b", "c"]);
  });

  it("refuses a can cooler's record and one on a die this site doesn't have", () => {
    const record = serializeHatDraft(draftInput());
    expect(parseHatDraft({ ...record, kind: "can-cooler" })).toBeNull();
    expect(parseHatDraft({ ...record, design: { ...record.design, dieId: "hat-no-9" } })).toBeNull();
  });

  it("fingerprints the design and quantity, not the selection", () => {
    const a = hatFingerprint({ design: hatDesign(), quantity: 100 });
    expect(hatFingerprint({ design: hatDesign({ selectedId: null }), quantity: 100 })).toBe(a);
    expect(hatFingerprint({ design: hatDesign(), quantity: 150 })).not.toBe(a);
    expect(hatFingerprint({ design: hatDesign({ parts: { crown_FL: "#000000" } }), quantity: 100 })).not.toBe(a);
  });
});

describe("the hat's steps", () => {
  it("run colours, front, more spots, label, quantity, then share and checkout", () => {
    expect(steps.STEP_IDS).toEqual(["colors", "front", "spots", "label", "quantity", "share", "checkout"]);
    expect(steps.COUNTED_STEPS).toBe(5);
    expect(steps.nextStep("label")).toBe("quantity");
    expect(steps.prevStep("front")).toBe("colors");
  });

  it("round-trip through the URL and the history entry", () => {
    for (const id of steps.STEP_IDS) {
      expect(steps.parseStepHash(steps.formatStepHash(id))).toBe(id);
      expect(steps.readHistoryState(steps.historyStateFor(id, 1))?.step).toBe(id);
    }
    expect(steps.parseStepHash("#design/logo")).toBeNull();
  });

  it("show the rectangle label only, and find each spot's step", () => {
    expect(steps.zonesForStep("label")).toEqual(["label_tall"]);
    expect(steps.zonesForStep("spots")).toEqual(["left", "right", "back"]);
    expect(steps.stepForZone("back")).toBe("spots");
    expect(steps.stepForZone("label_square")).toBe("label");
    expect(steps.viewForStep("quantity", "front").focus).toBeNull();
  });
});
