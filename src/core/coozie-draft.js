// Ported to @reel48/designer v1.15.0 from Reel48-Storefront src/lib/coozie-draft.js (origin/main d78d90ee). Comments are the storefront's; imports point into this package.
//
// On-device draft of a can cooler design.
//
// The designer saves the design in progress here so a reload, an app
// switch or a closed tab does not lose it. Everything stays in the browser's
// IndexedDB: nothing in this file talks to the network, and a draft is not an
// order, a quote or a lead.
//
// WHY INDEXEDDB AND NOT WEB STORAGE: the draft carries the buyer's artwork
// and any custom font as Blobs. localStorage stores strings only (megabytes of
// base64 against a ~5 MB cap), while IndexedDB stores Blobs natively.
//
// THE FILES ARE KEPT APART FROM THE DRAFT. The designer saves half a second
// after every change, and a customer's artwork can be megabytes. So each file
// (a logo's artwork, a custom font, the start card's picture) is stored once,
// under a key of its own beside the draft (`can-cooler:asset:<revision>`,
// `can-cooler:font:<family>`, `can-cooler:thumbnail:<id>`, and an AI, EPS or
// PDF original as `can-cooler:artwork:<revision>`), when it first
// appears, and deleted once the draft no longer names it. The draft record
// itself is the design's JSON, the order choices, the checkout record and the
// ids of its files: a few kilobytes, however big the artwork. A file's key
// names its content (an artwork revision is never reused for other bytes), so
// a key once written is never written again.
//
// A DRAFT NEVER GETS IN THE WAY. Safari private modes, blocked site data,
// quota errors and a missing IndexedDB (SSR, node tests) are all normal. Every
// store method resolves and never rejects; a broken store behaves like an empty
// one, and says so once in the console.

import { ARTWORK_CONTENT_TYPES } from "./vector-artwork.js";

export const COOZIE_DRAFT_KEY = "can-cooler";
// 2 (2026-10-17): files under keys of their own. 1 carried them inline, and is
// still read, so a draft saved before the change still restores.
export const DRAFT_VERSION = 2;
const READABLE_VERSIONS = [1, DRAFT_VERSION];
export const DRAFT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

const DB_NAME = "reel48-designer";
const STORE_NAME = "drafts";
const DB_VERSION = 1;

const MAGNET_SLUGS = ["no_magnet", "with_magnet"];

/**
 * `assetId` is the artwork revision the logo element draws (several elements
 * can share one, after "Copy the front"); without it the element's id stands
 * in.
 *
 * `artwork` is the AI, EPS or PDF file a stand-in box is placed for
 * (vector-artwork.js): `blob` is then the box, and the original is kept
 * beside it, under the same revision.
 *
 * @typedef {{ blob: Blob, fileName: string, mimeType: string }} DraftArtwork
 * @typedef {{ elId: string, blob: Blob, fileName: string, mimeType: string,
 *   naturalWidth: number, naturalHeight: number, assetId?: string,
 *   artwork?: DraftArtwork }} DraftLogo
 * @typedef {{ family: string, blob: Blob, fileName: string }} DraftFont
 * @typedef {{ elId: string, url: string, fileName: string }} DraftArtworkFile
 * @typedef {{ proofUrl: string, logoUrls: string[], fontUrls: string[],
 *   jsonUrl: string | null, artworkFiles?: DraftArtworkFile[] }} DraftUploaded
 * @typedef {{ designId: string, fingerprint: string, uploaded: DraftUploaded,
 *   replaces?: string[], added?: boolean, unchanged?: boolean }} DraftCheckout
 * @typedef {{ expressProduction: boolean }} DraftSpeed
 * @typedef {{ size: string, color: string, patternId?: string | null,
 *   elements: Record<string, any>[], [key: string]: any }} DraftDesign
 * @typedef {{ design: DraftDesign, step: string, magnet: string, quantity: number,
 *   logos?: DraftLogo[], fonts?: DraftFont[], thumbnail?: Blob | null,
 *   checkout?: DraftCheckout | null, speed?: Partial<DraftSpeed> }} DraftInput
 * @typedef {{ get(key: string): Promise<any>, put(key: string, value: any): Promise<void>,
 *   delete(key: string): Promise<void>, keys?(): Promise<any[]> }} DraftBackend
 * @typedef {{ savedAt: number, design: { size: string, color: string,
 *   patternId: string | null, elements: Record<string, any>[] },
 *   step: string | null, magnet: "no_magnet" | "with_magnet", quantity: number,
 *   logos: DraftLogo[], fonts: DraftFont[], thumbnail: Blob | null,
 *   checkout: DraftCheckout | null, speed: DraftSpeed }} ParsedDraft
 */

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isBlob(value) {
  return typeof Blob !== "undefined" && value instanceof Blob;
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

/**
 * Build the draft: plain objects plus Blobs, which is exactly what structured
 * clone (and so IndexedDB) accepts. The design is copied field by field so a
 * `selectedId` or any other session-only key on the live state can never ride
 * into storage. The store (createDraftStore) keeps the Blobs under keys of
 * their own and the rest as the draft record.
 *
 * @param {DraftInput} input
 * @param {number} [now]
 */
export function serializeDraft(
  { design, step, magnet, quantity, logos, fonts, thumbnail, checkout, speed },
  now = Date.now(),
) {
  return {
    v: DRAFT_VERSION,
    savedAt: now,
    design: {
      size: design.size,
      color: design.color,
      patternId: design.patternId ?? null,
      elements: design.elements.map((el) => ({ ...el })),
    },
    step,
    magnet,
    quantity,
    logos: (logos ?? []).map(({ elId, blob, fileName, mimeType, naturalWidth, naturalHeight, assetId, artwork }) => ({
      elId,
      blob,
      fileName,
      mimeType,
      naturalWidth,
      naturalHeight,
      ...(assetId ? { assetId } : {}),
      ...(artwork ? { artwork: { blob: artwork.blob, fileName: artwork.fileName, mimeType: artwork.mimeType } } : {}),
    })),
    fonts: (fonts ?? []).map(({ family, blob, fileName }) => ({ family, blob, fileName })),
    thumbnail: thumbnail ?? null,
    checkout: checkout
      ? {
          designId: checkout.designId,
          fingerprint: checkout.fingerprint,
          uploaded: {
            proofUrl: checkout.uploaded.proofUrl,
            logoUrls: [...checkout.uploaded.logoUrls],
            fontUrls: [...checkout.uploaded.fontUrls],
            jsonUrl: checkout.uploaded.jsonUrl ?? null,
            artworkFiles: (checkout.uploaded.artworkFiles ?? []).map(({ elId, url, fileName }) => ({ elId, url, fileName })),
          },
          replaces: [...(checkout.replaces ?? [])],
          // Put in the cart on purpose (Add another design). Since 2026-10-17
          // a later edit still replaces its line; a second design is a copy.
          added: checkout.added === true,
          // Whether the design saved here is still exactly the one in the
          // cart: only then is it offered as safe to leave behind ("Your
          // last design is in your cart").
          unchanged: checkout.unchanged === true,
        }
      : null,
    // The speed choice is the order's, not the design's, so it is not in the
    // fingerprint; kept so a return from Stripe's cancel link does not quietly
    // drop an express order back to standard. (Drafts saved before express
    // shipping left can coolers, 2026-10-09, may carry an expressShipping key;
    // nothing reads it.)
    speed: {
      expressProduction: speed?.expressProduction === true,
    },
  };
}

// Exported, with parseFonts and parseCheckout, for the hat's draft
// (hat/hat-draft.js), whose files and checkout record are the same shape.
export function parseLogos(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const logos = [];
  for (const entry of raw) {
    if (!isObject(entry) || !isNonEmptyString(entry.elId) || seen.has(entry.elId)) continue;
    if (!isBlob(entry.blob)) continue;
    if (typeof entry.fileName !== "string" || typeof entry.mimeType !== "string") continue;
    if (!(entry.naturalWidth > 0) || !(entry.naturalHeight > 0)) continue;
    // A stand-in box without the file it stands in for must not be ordered:
    // the logo goes, as one whose own file is missing does.
    let artwork = null;
    if (entry.artwork !== undefined) {
      const a = entry.artwork;
      if (!isObject(a) || !isBlob(a.blob) || !isNonEmptyString(a.fileName) || !ARTWORK_CONTENT_TYPES.includes(a.mimeType)) {
        continue;
      }
      artwork = { blob: a.blob, fileName: a.fileName, mimeType: a.mimeType };
    }
    seen.add(entry.elId);
    logos.push({
      elId: entry.elId,
      blob: entry.blob,
      fileName: entry.fileName,
      mimeType: entry.mimeType,
      naturalWidth: entry.naturalWidth,
      naturalHeight: entry.naturalHeight,
      ...(artwork ? { artwork } : {}),
    });
  }
  return logos;
}

export function parseFonts(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const fonts = [];
  for (const entry of raw) {
    if (!isObject(entry) || !isNonEmptyString(entry.family) || seen.has(entry.family)) continue;
    if (!isBlob(entry.blob)) continue;
    seen.add(entry.family);
    fonts.push({
      family: entry.family,
      blob: entry.blob,
      fileName: typeof entry.fileName === "string" ? entry.fileName : "",
    });
  }
  return fonts;
}

function isArtworkFile(value) {
  return isObject(value) && isNonEmptyString(value.elId) && isNonEmptyString(value.url) && isNonEmptyString(value.fileName);
}

function isStringArray(value) {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

// A bad `checkout` costs the buyer a re-upload at the end, never the design.
// `replaces` lists designs this browser put in the cart on earlier attempts
// that the current one supersedes; they are posted on every attempt until the
// server confirms they are gone.
export function parseCheckout(raw) {
  if (!isObject(raw) || !isNonEmptyString(raw.designId) || !isNonEmptyString(raw.fingerprint)) {
    return null;
  }
  const up = raw.uploaded;
  if (!isObject(up) || !isNonEmptyString(up.proofUrl)) return null;
  if (!isStringArray(up.logoUrls) || !isStringArray(up.fontUrls)) return null;
  if (up.jsonUrl != null && typeof up.jsonUrl !== "string") return null;
  // A record with a damaged artwork list would post an order without its
  // AI, EPS or PDF file, so it goes: the next checkout uploads afresh.
  if (up.artworkFiles !== undefined && !(Array.isArray(up.artworkFiles) && up.artworkFiles.every(isArtworkFile))) {
    return null;
  }
  return {
    designId: raw.designId,
    fingerprint: raw.fingerprint,
    uploaded: {
      proofUrl: up.proofUrl,
      logoUrls: [...up.logoUrls],
      fontUrls: [...up.fontUrls],
      jsonUrl: up.jsonUrl ?? null,
      artworkFiles: (up.artworkFiles ?? []).map(({ elId, url, fileName }) => ({ elId, url, fileName })),
    },
    replaces: isStringArray(raw.replaces) ? raw.replaces.filter((id) => id.length > 0) : [],
    added: raw.added === true,
    unchanged: raw.unchanged === true,
  };
}

/**
 * Validate a draft, its files in place (the store puts back the ones it keeps
 * apart before this runs). Returns null when it should not be restored: not
 * an object, a version this file does not read (1, files inline, and 2, files
 * apart, are both read), no usable timestamp, older than DRAFT_MAX_AGE_MS, or
 * a design, magnet or quantity that is not what the designer would have
 * saved.
 *
 * Damage that costs less than the whole draft is repaired instead: a logo
 * element whose Blob is missing is dropped from the design (a layer with no
 * artwork cannot be drawn or uploaded), a Blob with no element is dropped, and
 * a font without its file is dropped.
 *
 * The result is the stored shape without `v`; `step` is null when the stored
 * one was not a string, so the caller starts from its first step.
 *
 * @param {any} record
 * @param {number} [now]
 * @returns {ParsedDraft | null}
 */
export function parseDraft(record, now = Date.now()) {
  if (!isObject(record) || !READABLE_VERSIONS.includes(record.v)) return null;
  if (typeof record.savedAt !== "number" || !Number.isFinite(record.savedAt)) return null;
  if (now - record.savedAt > DRAFT_MAX_AGE_MS) return null;

  const d = record.design;
  if (!isObject(d) || typeof d.size !== "string" || typeof d.color !== "string") return null;
  if (!Array.isArray(d.elements) || !d.elements.every(isObject)) return null;

  if (!MAGNET_SLUGS.includes(record.magnet)) return null;
  if (!Number.isInteger(record.quantity) || record.quantity <= 0) return null;

  const logos = parseLogos(record.logos).filter((logo) =>
    d.elements.some((el) => el.type === "logo" && el.id === logo.elId),
  );
  const logoIds = new Set(logos.map((l) => l.elId));
  const elements = d.elements
    .filter((el) => el.type !== "logo" || logoIds.has(el.id))
    .map((el) => ({ ...el }));

  return {
    savedAt: record.savedAt,
    design: {
      size: d.size,
      color: d.color,
      patternId: typeof d.patternId === "string" ? d.patternId : null,
      elements,
    },
    step: typeof record.step === "string" ? record.step : null,
    magnet: record.magnet,
    quantity: record.quantity,
    logos,
    fonts: parseFonts(record.fonts),
    thumbnail: isBlob(record.thumbnail) ? record.thumbnail : null,
    checkout: parseCheckout(record.checkout),
    speed: {
      expressProduction: isObject(record.speed) && record.speed.expressProduction === true,
    },
  };
}

// ── Store ───────────────────────────────────────────────────────────

/**
 * The real backend: one database, one object store with out-of-line keys,
 * opened lazily and once. The handle is dropped (and so reopened on the next
 * call) when the browser closes it or another tab upgrades the schema, and a
 * failed open is not cached, so a transient failure does not end drafts for
 * the life of the page.
 *
 * @returns {DraftBackend}
 */
function createIndexedDbBackend() {
  /** @type {Promise<IDBDatabase> | null} */
  let dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    const opening = new Promise((resolve, reject) => {
      if (typeof indexedDB === "undefined" || !indexedDB) {
        reject(new Error("IndexedDB is not available"));
        return;
      }
      // May throw synchronously (some private modes); the executor turns that
      // into a rejection.
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
      };
      request.onsuccess = () => {
        const db = request.result;
        const forget = () => {
          if (dbPromise === opening) dbPromise = null;
          try {
            db.close();
          } catch {
            // Already closing.
          }
        };
        db.onversionchange = forget;
        db.onclose = () => {
          if (dbPromise === opening) dbPromise = null;
        };
        resolve(db);
      };
      request.onerror = () => reject(request.error ?? new Error("IndexedDB open failed"));
    });
    dbPromise = opening;
    opening.catch(() => {
      if (dbPromise === opening) dbPromise = null;
    });
    return opening;
  }

  async function run(mode, action) {
    const db = await open();
    return new Promise((resolve, reject) => {
      // transaction() and the request calls can throw (a closing connection,
      // a value that cannot be cloned); inside the executor that rejects.
      const tx = db.transaction(STORE_NAME, mode);
      const request = action(tx.objectStore(STORE_NAME));
      let result;
      request.onsuccess = () => {
        result = request.result;
      };
      // Resolve on the transaction, not the request: for a write that is the
      // point the data is committed, and a quota failure aborts here.
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error ?? request.error);
      tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
    }).catch((err) => {
      if (err?.name === "InvalidStateError") dbPromise = null;
      throw err;
    });
  }

  return {
    get: (key) => run("readonly", (store) => store.get(key)),
    put: async (key, value) => {
      await run("readwrite", (store) => store.put(value, key));
    },
    delete: async (key) => {
      await run("readwrite", (store) => store.delete(key));
    },
    keys: () => run("readonly", (store) => store.getAllKeys()),
  };
}

// ── The files, apart ────────────────────────────────────────────────

function fileKey(draftKey, kind, id) {
  return `${draftKey}:${kind}:${id}`;
}

/**
 * The draft as it is stored, each file swapped for the id it is kept under,
 * and the files themselves by key. `thumbnailId` names a picture (it has no
 * id of its own).
 *
 * @param {ReturnType<typeof serializeDraft>} record
 * @param {string} draftKey
 * @param {(blob: Blob) => string} thumbnailId
 */
function splitDraft(record, draftKey, thumbnailId) {
  /** @type {Map<string, Blob>} */
  const files = new Map();
  const logos = record.logos.map(({ blob, assetId, artwork, ...logo }) => {
    const asset = assetId ?? logo.elId;
    files.set(fileKey(draftKey, "asset", asset), blob);
    if (!artwork) return { ...logo, asset };
    files.set(fileKey(draftKey, "artwork", asset), artwork.blob);
    return { ...logo, asset, artwork: { fileName: artwork.fileName, mimeType: artwork.mimeType } };
  });
  const fonts = record.fonts.map(({ blob, ...font }) => {
    files.set(fileKey(draftKey, "font", font.family), blob);
    return font;
  });
  let thumbnail = null;
  if (record.thumbnail) {
    thumbnail = thumbnailId(record.thumbnail);
    files.set(fileKey(draftKey, "thumbnail", thumbnail), record.thumbnail);
  }
  return { stored: { ...record, logos, fonts, thumbnail }, files };
}

/**
 * The stored draft with its files put back, for parseDraft, and the keys of
 * the files found. A version 1 can cooler draft carries its files inline; so
 * may a version 2 one that never went through the store, and an inline Blob
 * wins. Any record's files are read, whatever its version: a hat draft
 * (hat-draft.js) counts its versions from 1 and stores its files apart too.
 * A file that is missing comes back undefined, which parseDraft repairs (the
 * logo or font is dropped, the draft kept).
 *
 * @param {any} stored
 * @param {string} draftKey
 * @param {(key: string) => Promise<any>} get
 */
async function joinDraft(stored, draftKey, get) {
  if (!isObject(stored)) return { record: stored, found: new Set() };
  const reads = new Map();
  const found = new Set();
  const read = (kind, id) => {
    if (!isNonEmptyString(id)) return Promise.resolve(undefined);
    const key = fileKey(draftKey, kind, id);
    if (!reads.has(key)) {
      reads.set(
        key,
        get(key).then((blob) => {
          if (isBlob(blob)) found.add(key);
          return blob;
        }),
      );
    }
    return reads.get(key);
  };
  const each = (list, kind, idOf) =>
    Array.isArray(list)
      ? Promise.all(
          list.map(async (entry) =>
            isObject(entry) && !isBlob(entry.blob) ? { ...entry, blob: await read(kind, idOf(entry)) } : entry,
          ),
        )
      : list;
  const [withAssets, fonts, thumbnail] = await Promise.all([
    each(stored.logos, "asset", (logo) => logo.asset),
    each(stored.fonts, "font", (font) => font.family),
    isBlob(stored.thumbnail) ? stored.thumbnail : read("thumbnail", stored.thumbnail),
  ]);
  // A stand-in's original file, kept under the same revision.
  const logos = Array.isArray(withAssets)
    ? await Promise.all(
        withAssets.map(async (entry) =>
          isObject(entry) && isObject(entry.artwork) && !isBlob(entry.artwork.blob)
            ? { ...entry, artwork: { ...entry.artwork, blob: await read("artwork", entry.asset) } }
            : entry,
        ),
      )
    : withAssets;
  return { record: { ...stored, logos, fonts, thumbnail: thumbnail ?? null }, found };
}

/**
 * A tiny async store for the draft. `backend` is injectable for tests.
 *
 * `load` runs parseDraft and deletes a record that fails it, so a stale or
 * foreign record is not re-read (and re-rejected) on every visit. Nothing here
 * rejects: when storage fails, `load` resolves null and `save`/`clear` resolve
 * undefined, with one console.warn per store instance.
 *
 * The files are written before the record that names them and deleted after
 * the record that dropped them, so a tab closed mid-save leaves the previous
 * draft whole; anything left over by one is swept on the next load (where the
 * backend can list its keys). Operations run one at a time, in order, so a
 * save still writing can never land after a clear.
 *
 * `parse` checks a stored record: parseDraft, the can cooler's, unless a
 * designer whose drafts carry other fields (a hat's) brings its own. It is
 * handed the record with its files put back, and returns null to have it
 * deleted.
 *
 * @param {{ backend?: DraftBackend, parse?: (record: unknown) => ParsedDraft | null }} [options]
 */
export function createDraftStore({ backend, parse = parseDraft } = {}) {
  const store = backend ?? createIndexedDbBackend();
  let warned = false;
  let tail = Promise.resolve();
  // Per draft key, the file keys this store knows are stored.
  /** @type {Map<string, Set<string>>} */
  const known = new Map();
  /** @type {WeakMap<Blob, string>} */
  const thumbnailIds = new WeakMap();
  let thumbnails = 0;

  function warnOnce(action, err) {
    if (warned) return;
    warned = true;
    if (typeof console !== "undefined") {
      console.warn(`designer draft: could not ${action}, carrying on without a saved draft.`, err);
    }
  }

  function queue(job) {
    const run = tail.then(job, job);
    tail = run.catch(() => {});
    return run;
  }

  function knownFor(key) {
    if (!known.has(key)) known.set(key, new Set());
    return /** @type {Set<string>} */ (known.get(key));
  }

  function thumbnailId(blob) {
    let id = thumbnailIds.get(blob);
    if (!id) {
      thumbnails += 1;
      id = `${Date.now().toString(36)}-${thumbnails}`;
      thumbnailIds.set(blob, id);
    }
    return id;
  }

  // Deletes the draft's files that `keep` does not name, including any left
  // over by a tab closed mid-save. Only where the backend lists its keys.
  async function sweep(key, keep) {
    if (typeof store.keys !== "function") return;
    const prefix = `${key}:`;
    for (const k of await store.keys()) {
      if (typeof k === "string" && k.startsWith(prefix) && !keep.has(k)) await store.delete(k);
    }
  }

  return {
    /**
     * @param {string} [key]
     * @returns {Promise<ParsedDraft | null>}
     */
    load(key = COOZIE_DRAFT_KEY) {
      return queue(async () => {
        try {
          const stored = await store.get(key);
          let parsed = null;
          let kept = new Set();
          if (stored !== undefined && stored !== null) {
            const { record, found } = await joinDraft(stored, key, (k) => store.get(k));
            parsed = parse(record);
            if (parsed) {
              kept = found;
              // So the picture just read is not written again under a new id.
              if (parsed.thumbnail && isNonEmptyString(stored.thumbnail)) {
                thumbnailIds.set(parsed.thumbnail, stored.thumbnail);
              }
            } else {
              await store.delete(key);
            }
          }
          known.set(key, new Set(kept));
          await sweep(key, kept);
          return parsed;
        } catch (err) {
          warnOnce("read the draft", err);
          return null;
        }
      });
    },

    /**
     * Writes the files the store has not stored yet, then the record, then
     * deletes the files the record no longer names. In the usual save (a drag,
     * a colour, a step) that is the record alone.
     *
     * @param {ReturnType<typeof serializeDraft>} record
     * @param {string} [key]
     * @returns {Promise<void>}
     */
    save(record, key = COOZIE_DRAFT_KEY) {
      return queue(async () => {
        try {
          const { stored, files } = splitDraft(record, key, thumbnailId);
          const stocked = knownFor(key);
          for (const [k, blob] of files) {
            if (stocked.has(k)) continue;
            await store.put(k, blob);
            stocked.add(k);
          }
          await store.put(key, stored);
          for (const k of [...stocked]) {
            if (files.has(k)) continue;
            await store.delete(k);
            stocked.delete(k);
          }
        } catch (err) {
          warnOnce("save the draft", err);
        }
      });
    },

    /**
     * @param {string} [key]
     * @returns {Promise<void>}
     */
    clear(key = COOZIE_DRAFT_KEY) {
      return queue(async () => {
        try {
          await store.delete(key);
          const stocked = knownFor(key);
          for (const k of [...stocked]) {
            await store.delete(k);
            stocked.delete(k);
          }
          await sweep(key, new Set());
        } catch (err) {
          warnOnce("clear the draft", err);
        }
      });
    },
  };
}

// ── Fingerprint ─────────────────────────────────────────────────────

// Bump when the canonical form below changes, so an old fingerprint can never
// compare equal to a new one by accident.
const FINGERPRINT_VERSION = "f1";

/** Plain-data copy with every object's keys in sorted order and no undefineds. */
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (isObject(value)) {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      if (value[key] !== undefined) out[key] = canonical(value[key]);
    }
    return out;
  }
  return value;
}

function fnv1a(text, seed) {
  let h = seed >>> 0;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/**
 * The same stable hash over any plain value, for a designer whose design is
 * not a can cooler's (the hat's draft, hat/hat-draft.js). Its own prefix, so
 * it can never equal a can cooler's fingerprint.
 *
 * @param {string} kind
 * @param {unknown} value
 */
export function stableFingerprint(kind, value) {
  const text = JSON.stringify(canonical(value));
  return `${FINGERPRINT_VERSION}-${kind}-${fnv1a(text, 0x811c9dc5)}${fnv1a(text, 0x9747b28c)}-${text.length.toString(36)}`;
}

/**
 * A stable string for "this exact product on this exact cart line": the die,
 * colour, pattern, every element (so positions, rotation, scale, text, fonts,
 * fills and the artwork's revision) plus the magnet and the quantity.
 *
 * Checkout compares it with the fingerprint stored beside the uploaded files:
 * equal means the uploads still describe what is on screen and can be reused;
 * anything else means upload again, since reusing a stale proof would print the
 * wrong thing. It is a hash of a canonical JSON form (sorted keys, array order
 * kept because it is the layer order), so two equal designs agree whatever
 * order their keys were built in. Selection is not part of it.
 *
 * Two 32-bit FNV-1a runs with different seeds plus the text length: short
 * enough for a stored field, and a false match is far outside anything a
 * buyer's edits can produce.
 *
 * @param {{ design: DraftDesign, magnet: string, quantity: number }} input
 */
export function designFingerprint({ design, magnet, quantity }) {
  const text = JSON.stringify(
    canonical({
      size: design.size,
      color: design.color,
      patternId: design.patternId ?? null,
      elements: design.elements,
      magnet,
      quantity,
    }),
  );
  return `${FINGERPRINT_VERSION}-${fnv1a(text, 0x811c9dc5)}${fnv1a(text, 0x9747b28c)}-${text.length.toString(36)}`;
}
