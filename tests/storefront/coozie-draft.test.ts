// Ported to @reel48/designer v1.15.0 from Reel48-Storefront tests/coozie-draft.test.ts (origin/main d78d90ee); imports point into this package.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  COOZIE_DRAFT_KEY,
  DRAFT_MAX_AGE_MS,
  DRAFT_VERSION,
  createDraftStore,
  designFingerprint,
  parseDraft,
  serializeDraft,
} from "../../src/core/coozie-draft.js";

/**
 * The on-device draft of a design in progress. Pure logic plus a store that
 * must never throw at the designer: these tests drive it with an in-memory
 * backend, and with ones that fail the way real storage does (blocked, full).
 */

const NOW = Date.UTC(2026, 9, 9, 12, 0, 0);

const blob = (text = "x", type = "image/png") => new Blob([text], { type });

function logoElement(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    type: "logo",
    fileName: `${id}.png`,
    mimeType: "image/png",
    naturalWidth: 400,
    naturalHeight: 300,
    x: 0.5,
    y: 0.5,
    scale: 0.4,
    rotation: 0,
    opacity: 1,
    assetRevision: `rev_${id}`,
    ...over,
  };
}

function textElement(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    type: "text",
    text: "Cheers",
    fontFamily: "Arial, sans-serif",
    fontStyle: "normal",
    fill: "#FFFFFF",
    align: "center",
    fontScale: 0.07,
    x: 0.5,
    y: 0.7,
    rotation: 0,
    opacity: 1,
    ...over,
  };
}

function input(over: Record<string, unknown> = {}) {
  return {
    design: {
      size: "standard",
      color: "#1C2E4A",
      patternId: null as string | null,
      elements: [logoElement("el_1"), textElement("el_2")] as Record<string, unknown>[],
    },
    step: "quantity",
    magnet: "no_magnet",
    quantity: 250,
    logos: [
      {
        elId: "el_1",
        blob: blob("logo-bytes"),
        fileName: "el_1.png",
        mimeType: "image/png",
        naturalWidth: 400,
        naturalHeight: 300,
      },
    ],
    fonts: [{ family: "Brand Sans", blob: blob("font-bytes", "font/ttf"), fileName: "brand.ttf" }],
    thumbnail: blob("thumb") as Blob | null,
    checkout: null as null | {
      designId: string;
      fingerprint: string;
      uploaded: { proofUrl: string; logoUrls: string[]; fontUrls: string[]; jsonUrl: string | null };
    },
    ...over,
  };
}

/** An in-memory backend that records every call. */
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

/** Whether a Blob sits anywhere inside `value`. */
function holdsBlob(value: unknown): boolean {
  if (value instanceof Blob) return true;
  if (value && typeof value === "object") return Object.values(value).some(holdsBlob);
  return false;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("serializeDraft", () => {
  it("builds a versioned, timestamped record of plain data and Blobs", () => {
    const record = serializeDraft(input(), NOW);
    expect(record.v).toBe(DRAFT_VERSION);
    expect(record.savedAt).toBe(NOW);
    expect(record.step).toBe("quantity");
    expect(record.magnet).toBe("no_magnet");
    expect(record.quantity).toBe(250);
    expect(record.logos[0].blob).toBeInstanceOf(Blob);
    expect(record.fonts[0].blob).toBeInstanceOf(Blob);
    expect(record.thumbnail).toBeInstanceOf(Blob);
    expect(record.checkout).toBeNull();
    // Plain data all the way down: structuredClone is what IndexedDB runs.
    expect(structuredClone(record).design).toEqual(record.design);
  });

  it("never carries the selection or other session-only design keys", () => {
    const withSelection = input({
      design: { ...input().design, selectedId: "el_1", schemaVersion: 3 },
    });
    expect(Object.keys(serializeDraft(withSelection, NOW).design).sort()).toEqual([
      "color",
      "elements",
      "patternId",
      "size",
    ]);
  });

  it("defaults the optional parts instead of storing undefined", () => {
    const record = serializeDraft(
      input({ logos: undefined, fonts: undefined, thumbnail: undefined, checkout: undefined }),
      NOW,
    );
    expect(record.logos).toEqual([]);
    expect(record.fonts).toEqual([]);
    expect(record.thumbnail).toBeNull();
    expect(record.checkout).toBeNull();
  });
});

describe("parseDraft", () => {
  it("round-trips what serializeDraft wrote", () => {
    const source = input();
    const parsed = parseDraft(serializeDraft(source, NOW), NOW + 1000);
    expect(parsed).not.toBeNull();
    expect(parsed!.savedAt).toBe(NOW);
    expect(parsed!.design).toEqual(source.design);
    expect(parsed!.step).toBe("quantity");
    expect(parsed!.magnet).toBe("no_magnet");
    expect(parsed!.quantity).toBe(250);
    expect(parsed!.logos).toEqual(source.logos);
    expect(parsed!.fonts).toEqual(source.fonts);
    expect(parsed!.thumbnail).toBe(source.thumbnail);
    expect(parsed!.checkout).toBeNull();
  });

  it("rejects what is not a record of this version", () => {
    const good = serializeDraft(input(), NOW);
    expect(parseDraft(null, NOW)).toBeNull();
    expect(parseDraft(undefined, NOW)).toBeNull();
    expect(parseDraft("draft", NOW)).toBeNull();
    expect(parseDraft([good], NOW)).toBeNull();
    expect(parseDraft({ ...good, v: DRAFT_VERSION + 1 }, NOW)).toBeNull();
    expect(parseDraft({ ...good, v: undefined }, NOW)).toBeNull();
  });

  it("rejects a missing or non-numeric timestamp", () => {
    const good = serializeDraft(input(), NOW);
    expect(parseDraft({ ...good, savedAt: undefined }, NOW)).toBeNull();
    expect(parseDraft({ ...good, savedAt: "2026-10-09" }, NOW)).toBeNull();
    expect(parseDraft({ ...good, savedAt: Number.NaN }, NOW)).toBeNull();
  });

  it("expires after DRAFT_MAX_AGE_MS", () => {
    const record = serializeDraft(input(), NOW);
    expect(parseDraft(record, NOW + DRAFT_MAX_AGE_MS)).not.toBeNull();
    expect(parseDraft(record, NOW + DRAFT_MAX_AGE_MS + 1)).toBeNull();
  });

  it("rejects a malformed design", () => {
    const good = serializeDraft(input(), NOW);
    const withDesign = (design: unknown) => ({ ...good, design });
    expect(parseDraft(withDesign(null), NOW)).toBeNull();
    expect(parseDraft(withDesign({ ...good.design, size: 3 }), NOW)).toBeNull();
    expect(parseDraft(withDesign({ ...good.design, color: undefined }), NOW)).toBeNull();
    expect(parseDraft(withDesign({ ...good.design, elements: "none" }), NOW)).toBeNull();
    expect(parseDraft(withDesign({ ...good.design, elements: [null] }), NOW)).toBeNull();
  });

  it("rejects a magnet that is not one of the two slugs, with no default", () => {
    const good = serializeDraft(input(), NOW);
    expect(parseDraft({ ...good, magnet: "with" }, NOW)).toBeNull();
    expect(parseDraft({ ...good, magnet: undefined }, NOW)).toBeNull();
    expect(parseDraft({ ...good, magnet: "with_magnet" }, NOW)!.magnet).toBe("with_magnet");
  });

  it("rejects a quantity that is not a positive integer", () => {
    const good = serializeDraft(input(), NOW);
    for (const quantity of [0, -100, 1.5, "100", null, undefined, Number.NaN]) {
      expect(parseDraft({ ...good, quantity }, NOW), String(quantity)).toBeNull();
    }
  });

  it("drops a logo element that has no Blob, and a Blob that has no element", () => {
    const source = input({
      design: {
        ...input().design,
        elements: [logoElement("el_1"), logoElement("el_3"), textElement("el_2")],
      },
      logos: [
        ...input().logos,
        // Blob for an element that is not in the design.
        {
          elId: "el_9",
          blob: blob("orphan"),
          fileName: "o.png",
          mimeType: "image/png",
          naturalWidth: 10,
          naturalHeight: 10,
        },
      ],
    });
    const parsed = parseDraft(serializeDraft(source, NOW), NOW)!;
    expect(parsed.design.elements.map((el) => el.id)).toEqual(["el_1", "el_2"]);
    expect(parsed.logos.map((l) => l.elId)).toEqual(["el_1"]);
  });

  it("drops a logo entry whose Blob did not survive storage", () => {
    const record = serializeDraft(input(), NOW);
    const damaged = { ...record, logos: [{ ...record.logos[0], blob: { size: 5 } }] };
    const parsed = parseDraft(damaged, NOW)!;
    expect(parsed.logos).toEqual([]);
    expect(parsed.design.elements.map((el) => el.id)).toEqual(["el_2"]);
  });

  it("keeps text elements whatever the logos look like", () => {
    const source = input({ logos: [], design: { ...input().design, elements: [textElement("t")] } });
    const parsed = parseDraft(serializeDraft(source, NOW), NOW)!;
    expect(parsed.design.elements).toHaveLength(1);
  });

  it("drops a font entry without a Blob and keeps the rest", () => {
    const record = serializeDraft(input(), NOW);
    const damaged = {
      ...record,
      fonts: [...record.fonts, { family: "Lost Serif", blob: null, fileName: "lost.ttf" }],
    };
    expect(parseDraft(damaged, NOW)!.fonts.map((f) => f.family)).toEqual(["Brand Sans"]);
  });

  it("turns a malformed checkout into null without losing the draft", () => {
    const record = serializeDraft(input(), NOW);
    const bad = [
      "uploaded",
      { designId: "d1" },
      { designId: "d1", fingerprint: "f", uploaded: null },
      { designId: "d1", fingerprint: "f", uploaded: { proofUrl: "p", logoUrls: "x", fontUrls: [], jsonUrl: null } },
      { designId: "d1", fingerprint: "f", uploaded: { proofUrl: "", logoUrls: [], fontUrls: [], jsonUrl: null } },
      { designId: "", fingerprint: "f", uploaded: { proofUrl: "p", logoUrls: [], fontUrls: [], jsonUrl: null } },
    ];
    for (const checkout of bad) {
      const parsed = parseDraft({ ...record, checkout }, NOW);
      expect(parsed, JSON.stringify(checkout)).not.toBeNull();
      expect(parsed!.checkout).toBeNull();
      expect(parsed!.design.elements).toHaveLength(2);
    }
  });

  it("keeps a valid checkout, with a missing jsonUrl as null", () => {
    const checkout = {
      designId: "d1",
      fingerprint: "f1-abc",
      uploaded: { proofUrl: "https://blob.example/p.png", logoUrls: ["https://blob.example/l.png"], fontUrls: [], jsonUrl: null },
    };
    const parsed = parseDraft(serializeDraft(input({ checkout }), NOW), NOW)!;
    // A record written before `replaces` (or `added`, 2026-10-17) existed
    // reads as nothing pending, and as a checkout's line, not one added.
    // And one written before `artworkFiles` (2026-10-18) as a design with
    // no AI, EPS or PDF logos.
    expect(parsed.checkout).toEqual({
      ...checkout,
      uploaded: { ...checkout.uploaded, artworkFiles: [] },
      replaces: [],
      added: false,
      unchanged: false,
    });
    const noJson = { ...checkout, uploaded: { ...checkout.uploaded, jsonUrl: undefined } };
    expect(parseDraft({ ...serializeDraft(input(), NOW), checkout: noJson }, NOW)!.checkout!.uploaded.jsonUrl).toBeNull();
  });

  it("keeps the designs a checkout still has to supersede, and drops junk in that list", () => {
    const checkout = {
      designId: "d3",
      fingerprint: "f1-abc",
      uploaded: { proofUrl: "https://blob.example/p.png", logoUrls: [], fontUrls: [], jsonUrl: null },
      replaces: ["d1", "d2"],
    };
    const parsed = parseDraft(serializeDraft(input({ checkout }), NOW), NOW)!;
    expect(parsed.checkout!.replaces).toEqual(["d1", "d2"]);
    const record = serializeDraft(input({ checkout }), NOW);
    expect(parseDraft({ ...record, checkout: { ...record.checkout, replaces: [1, "d1"] } }, NOW)!.checkout!.replaces).toEqual([]);
    expect(parseDraft({ ...record, checkout: { ...record.checkout, replaces: ["", "d1"] } }, NOW)!.checkout!.replaces).toEqual(["d1"]);
  });

  it("round-trips the speed choice, and reads anything else as standard", () => {
    const fast = serializeDraft({ ...input(), speed: { expressProduction: true } }, NOW);
    expect(parseDraft(fast, NOW)!.speed).toEqual({ expressProduction: true });
    expect(parseDraft(serializeDraft(input(), NOW), NOW)!.speed).toEqual({ expressProduction: false });
    expect(parseDraft({ ...fast, speed: { expressProduction: "yes" } }, NOW)!.speed).toEqual({
      expressProduction: false,
    });
  });

  it("drops express shipping from a draft saved before can coolers stopped offering it", () => {
    // Drafts from before 2026-10-09 may carry the key; it no longer exists on
    // the can cooler form, so it is not read back.
    const old = { ...serializeDraft(input(), NOW), speed: { expressShipping: true, expressProduction: true } };
    expect(parseDraft(old, NOW)!.speed).toEqual({ expressProduction: true });
  });

  it("only accepts a Blob as the thumbnail", () => {
    const record = serializeDraft(input(), NOW);
    expect(parseDraft({ ...record, thumbnail: "data:image/png;base64,AAAA" }, NOW)!.thumbnail).toBeNull();
    expect(parseDraft({ ...record, thumbnail: undefined }, NOW)!.thumbnail).toBeNull();
    expect(parseDraft(record, NOW)!.thumbnail).toBeInstanceOf(Blob);
  });

  it("turns a non-string step into null", () => {
    const record = serializeDraft(input(), NOW);
    expect(parseDraft({ ...record, step: 4 }, NOW)!.step).toBeNull();
  });
});

describe("createDraftStore", () => {
  it("round-trips through a backend", async () => {
    const backend = memoryBackend();
    const store = createDraftStore({ backend });
    const source = input();
    await store.save(serializeDraft(source, Date.now()));
    expect(backend.put).toHaveBeenCalledWith(COOZIE_DRAFT_KEY, expect.objectContaining({ v: DRAFT_VERSION }));
    const loaded = await store.load();
    expect(loaded!.design).toEqual(source.design);
    expect(loaded!.logos[0].blob).toBe(source.logos[0].blob);
    expect(loaded!.quantity).toBe(250);
  });

  it("loads null when nothing is saved", async () => {
    const backend = memoryBackend();
    expect(await createDraftStore({ backend }).load()).toBeNull();
    expect(backend.delete).not.toHaveBeenCalled();
  });

  it("clears a draft", async () => {
    const backend = memoryBackend();
    const store = createDraftStore({ backend });
    await store.save(serializeDraft(input(), Date.now()));
    await store.clear();
    expect(backend.data.size).toBe(0);
    expect(await store.load()).toBeNull();
  });

  it("keys drafts separately", async () => {
    const backend = memoryBackend();
    const store = createDraftStore({ backend });
    await store.save(serializeDraft(input({ quantity: 100 }), Date.now()), "other");
    expect(await store.load()).toBeNull();
    expect((await store.load("other"))!.quantity).toBe(100);
  });

  it("deletes a record of the wrong version and loads null", async () => {
    const backend = memoryBackend();
    backend.data.set(COOZIE_DRAFT_KEY, { ...serializeDraft(input(), Date.now()), v: DRAFT_VERSION + 1 });
    expect(await createDraftStore({ backend }).load()).toBeNull();
    expect(backend.delete).toHaveBeenCalledWith(COOZIE_DRAFT_KEY);
    expect(backend.data.has(COOZIE_DRAFT_KEY)).toBe(false);
  });

  it("deletes an expired record and loads null", async () => {
    const backend = memoryBackend();
    backend.data.set(COOZIE_DRAFT_KEY, serializeDraft(input(), Date.now() - DRAFT_MAX_AGE_MS - 60_000));
    expect(await createDraftStore({ backend }).load()).toBeNull();
    expect(backend.data.has(COOZIE_DRAFT_KEY)).toBe(false);
  });

  it("repairs a damaged logo on load and keeps the draft", async () => {
    const backend = memoryBackend();
    const record = serializeDraft(input(), Date.now());
    backend.data.set(COOZIE_DRAFT_KEY, { ...record, logos: [] });
    const loaded = await createDraftStore({ backend }).load();
    expect(loaded!.design.elements.map((el) => el.id)).toEqual(["el_2"]);
    expect(backend.delete).not.toHaveBeenCalled();
  });

  it("never rejects when the backend throws, and warns once", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const boom = () => Promise.reject(new Error("blocked"));
    const store = createDraftStore({ backend: { get: boom, put: boom, delete: boom } });
    await expect(store.load()).resolves.toBeNull();
    await expect(store.save(serializeDraft(input(), Date.now()))).resolves.toBeUndefined();
    await expect(store.clear()).resolves.toBeUndefined();
    await expect(store.load()).resolves.toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("never rejects when the backend throws synchronously", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const throws = () => {
      throw new Error("DataCloneError");
    };
    const store = createDraftStore({
      backend: { get: throws as never, put: throws as never, delete: throws as never },
    });
    await expect(store.save(serializeDraft(input(), Date.now()))).resolves.toBeUndefined();
    await expect(store.load()).resolves.toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("warns once per store instance, not once per process", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const boom = () => Promise.reject(new Error("quota"));
    const backend = { get: boom, put: boom, delete: boom };
    await createDraftStore({ backend }).clear();
    await createDraftStore({ backend }).clear();
    expect(warn).toHaveBeenCalledTimes(2);
  });

  // 2026-10-17: a save half a second after every change rewrote every logo and
  // font. Each file now has a key of its own, written once.
  it("keeps each file under its own key, written once, and the record as JSON and ids", async () => {
    const backend = memoryBackend();
    const store = createDraftStore({ backend });
    const logo = blob("logo-bytes");
    const source = input({
      design: { ...input().design, elements: [logoElement("el_1"), logoElement("el_3"), textElement("el_2")] },
      // Two elements, one artwork (Copy the front keeps the revision).
      logos: ["el_1", "el_3"].map((elId) => ({
        elId, assetId: "rev_1", blob: logo, fileName: "a.png", mimeType: "image/png", naturalWidth: 4, naturalHeight: 3,
      })),
    });
    await store.save(serializeDraft(source, Date.now()));
    const written = backend.put.mock.calls.map(([key]) => key);
    expect(written.filter((k) => k !== COOZIE_DRAFT_KEY).sort()).toEqual([
      `${COOZIE_DRAFT_KEY}:asset:rev_1`,
      `${COOZIE_DRAFT_KEY}:font:Brand Sans`,
      expect.stringMatching(new RegExp(`^${COOZIE_DRAFT_KEY}:thumbnail:`)),
    ]);
    expect(written.at(-1)).toBe(COOZIE_DRAFT_KEY);
    expect(holdsBlob(backend.data.get(COOZIE_DRAFT_KEY))).toBe(false);

    backend.put.mockClear();
    await store.save(serializeDraft({ ...source, quantity: 500 }, Date.now()));
    expect(backend.put.mock.calls.map(([key]) => key)).toEqual([COOZIE_DRAFT_KEY]);

    const loaded = await createDraftStore({ backend }).load();
    expect(loaded!.quantity).toBe(500);
    expect(loaded!.logos.map((l) => [l.elId, l.blob])).toEqual([["el_1", logo], ["el_3", logo]]);
    expect(loaded!.fonts[0].blob).toBe(source.fonts[0].blob);
    expect(loaded!.thumbnail).toBe(source.thumbnail);
  });

  it("keeps an AI, EPS or PDF original beside its stand-in box, and drops a box whose file is gone", async () => {
    const backend = memoryBackend();
    const store = createDraftStore({ backend });
    const original = blob("%PDF-1.7", "application/pdf");
    const checkout = {
      designId: "d1",
      fingerprint: "f1-abc",
      uploaded: {
        proofUrl: "https://blob.example/p.png",
        logoUrls: ["https://blob.example/l.png"],
        fontUrls: [],
        jsonUrl: null,
        artworkFiles: [{ elId: "el_1", url: "https://blob.example/artwork-1-acme.ai", fileName: "Acme.ai" }],
      },
    };
    const source = input({
      logos: [{ ...input().logos[0], fileName: "Acme.ai", artwork: { blob: original, fileName: "Acme.ai", mimeType: "application/pdf" } }],
      checkout,
    });
    await store.save(serializeDraft(source, Date.now()));
    expect(backend.data.get(`${COOZIE_DRAFT_KEY}:artwork:el_1`)).toBe(original);
    expect(holdsBlob(backend.data.get(COOZIE_DRAFT_KEY))).toBe(false);

    const loaded = await createDraftStore({ backend }).load();
    expect(loaded!.logos[0].artwork).toEqual({ blob: original, fileName: "Acme.ai", mimeType: "application/pdf" });
    expect(loaded!.checkout!.uploaded.artworkFiles).toEqual(checkout.uploaded.artworkFiles);

    // The box without its file is not ordered: the logo goes from the design.
    backend.data.delete(`${COOZIE_DRAFT_KEY}:artwork:el_1`);
    const repaired = await createDraftStore({ backend }).load();
    expect(repaired!.logos).toEqual([]);
    expect(repaired!.design.elements.map((el) => el.id)).toEqual(["el_2"]);
  });

  it("deletes a file once the draft stops naming it, and every file on clear", async () => {
    const backend = memoryBackend();
    const store = createDraftStore({ backend });
    await store.save(serializeDraft(input(), Date.now()));
    await store.save(serializeDraft(input({ logos: [], thumbnail: blob("newer") }), Date.now()));
    const keys = [...backend.data.keys()].sort();
    expect(keys.some((k) => k.includes(":asset:"))).toBe(false);
    expect(keys.filter((k) => k.includes(":thumbnail:"))).toHaveLength(1);
    await store.clear();
    expect(backend.data.size).toBe(0);
  });

  it("still restores a draft saved before the files moved out (version 1, files inline)", async () => {
    const backend = memoryBackend();
    const legacy = { ...serializeDraft(input(), Date.now()), v: 1 };
    backend.data.set(COOZIE_DRAFT_KEY, legacy);
    const store = createDraftStore({ backend });
    const loaded = await store.load();
    expect(loaded!.logos[0].blob).toBe(legacy.logos[0].blob);
    expect(loaded!.fonts[0].blob).toBe(legacy.fonts[0].blob);
    expect(loaded!.thumbnail).toBe(legacy.thumbnail);
    // Its next save moves the files out.
    await store.save(serializeDraft(input(), Date.now()));
    expect(backend.data.get(COOZIE_DRAFT_KEY)).toMatchObject({ v: DRAFT_VERSION });
    expect(holdsBlob(backend.data.get(COOZIE_DRAFT_KEY))).toBe(false);
  });

  it("sweeps files a save cut short left behind, and drops a logo whose file is gone", async () => {
    const backend = memoryBackend();
    await createDraftStore({ backend }).save(serializeDraft(input(), Date.now()));
    backend.data.set(`${COOZIE_DRAFT_KEY}:asset:orphan`, blob("orphan"));
    backend.data.delete(`${COOZIE_DRAFT_KEY}:asset:el_1`);
    const loaded = await createDraftStore({ backend }).load();
    expect(backend.data.has(`${COOZIE_DRAFT_KEY}:asset:orphan`)).toBe(false);
    expect(loaded!.design.elements.map((el) => el.id)).toEqual(["el_2"]);
    expect(loaded!.fonts).toHaveLength(1);
  });

  it("resolves null from the default backend when IndexedDB does not exist", async () => {
    vi.stubGlobal("indexedDB", undefined);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const store = createDraftStore();
    await expect(store.load()).resolves.toBeNull();
    await expect(store.save(serializeDraft(input(), Date.now()))).resolves.toBeUndefined();
    await expect(store.clear()).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("resolves null when opening IndexedDB throws (private mode)", async () => {
    vi.stubGlobal("indexedDB", {
      open: () => {
        throw new DOMException("denied", "SecurityError");
      },
    });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(createDraftStore().load()).resolves.toBeNull();
  });
});

describe("designFingerprint", () => {
  const base = () => ({ design: input().design, magnet: "no_magnet", quantity: 250 });

  it("is the same for equal inputs, whatever order the keys were built in", () => {
    const a = base();
    const reordered = {
      quantity: 250,
      magnet: "no_magnet",
      design: {
        elements: [
          {
            opacity: 1,
            rotation: 0,
            scale: 0.4,
            y: 0.5,
            x: 0.5,
            assetRevision: "rev_el_1",
            naturalHeight: 300,
            naturalWidth: 400,
            mimeType: "image/png",
            fileName: "el_1.png",
            type: "logo",
            id: "el_1",
          },
          { ...textElement("el_2") },
        ],
        patternId: null,
        color: "#1C2E4A",
        size: "standard",
      },
    };
    expect(designFingerprint(reordered)).toBe(designFingerprint(a));
    expect(designFingerprint(a)).toBe(designFingerprint(base()));
  });

  it("ignores selection and a missing versus null pattern", () => {
    const a = base();
    const noisy = {
      ...a,
      design: { ...a.design, selectedId: "el_2", schemaVersion: 3, patternId: undefined },
    };
    expect(designFingerprint(noisy)).toBe(designFingerprint(a));
  });

  it("is a short single-line string", () => {
    const fp = designFingerprint(base());
    expect(fp).toMatch(/^f1-[0-9a-f]{16}-[0-9a-z]+$/);
  });

  it("changes when an element is rotated, moved or scaled", () => {
    const a = base();
    const rotated = structuredClone(a);
    rotated.design.elements[0].rotation = 15;
    const moved = structuredClone(a);
    moved.design.elements[0].x = 0.51;
    const scaled = structuredClone(a);
    scaled.design.elements[0].scale = 0.41;
    const prints = [a, rotated, moved, scaled].map(designFingerprint);
    expect(new Set(prints).size).toBe(4);
  });

  it("changes when text, font or fill change", () => {
    const a = base();
    const variants = [
      { text: "Cheers!" },
      { fontFamily: "Brand Sans" },
      { fill: "#000000" },
      { fontStyle: "bold" },
      { fontScale: 0.08 },
    ].map((patch) => {
      const v = structuredClone(a);
      Object.assign(v.design.elements[1], patch);
      return designFingerprint(v);
    });
    expect(new Set([designFingerprint(a), ...variants]).size).toBe(variants.length + 1);
  });

  it("changes when the artwork behind a logo is swapped", () => {
    const a = base();
    const swapped = structuredClone(a);
    swapped.design.elements[0].assetRevision = "rev_other";
    expect(designFingerprint(swapped)).not.toBe(designFingerprint(a));
  });

  it("changes with layer order, size, colour, pattern, quantity and magnet", () => {
    const a = base();
    const flipped = structuredClone(a);
    flipped.design.elements.reverse();
    const slim = { ...a, design: { ...a.design, size: "slim" } };
    const recolored = { ...a, design: { ...a.design, color: "#FF0000" } };
    const patterned = { ...a, design: { ...a.design, patternId: "stripes" } };
    const more = { ...a, quantity: 251 };
    const magnet = { ...a, magnet: "with_magnet" };
    const fewer = { ...a, design: { ...a.design, elements: a.design.elements.slice(1) } };
    const prints = [a, flipped, slim, recolored, patterned, more, magnet, fewer].map(designFingerprint);
    expect(new Set(prints).size).toBe(prints.length);
  });
});

describe("a saved design that is still the one in the cart (2026-10-17)", () => {
  const checkout = {
    designId: "d1",
    fingerprint: "f1-abc",
    uploaded: { proofUrl: "https://blob.example/p.png", logoUrls: [], fontUrls: [], jsonUrl: null },
    added: true,
  };
  it("keeps whether the design was unchanged since it went in", () => {
    expect(parseDraft(serializeDraft(input({ checkout: { ...checkout, unchanged: true } }), NOW), NOW)!.checkout!.unchanged).toBe(true);
    expect(parseDraft(serializeDraft(input({ checkout: { ...checkout, unchanged: false } }), NOW), NOW)!.checkout!.unchanged).toBe(false);
  });
  it("reads a draft saved before the flag as changed, so leaving it is asked about", () => {
    expect(parseDraft(serializeDraft(input({ checkout }), NOW), NOW)!.checkout!.unchanged).toBe(false);
  });
});
