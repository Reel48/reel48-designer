// Ported to @reel48/designer v1.15.0 from Reel48-Storefront src/lib/design-lines.ts (origin/main d78d90ee), TypeScript as JSDoc. Comments are the storefront's; imports point into this package.
//
/**
 * The three kinds of order line, told apart by their design fields.
 *
 * A line is DESIGNED when it left the koozie designer with a proof: designId
 * and/or designProofUrl are set, and what the customer saw is what we print.
 *
 * A line is BLANK when it came through the no-JS order form on /design/coozie
 * (addBlankCoozieToCart): no id, no proof, and designJson is `{ blank: true,
 * ... }`. The customer was told to email their artwork with the order number,
 * and nothing may be produced until it arrives.
 *
 * Everything else is a CATALOG line — a hat or polo added from its product
 * page — which gets a free digital mockup to approve before production.
 *
 * Three places used to make this call with their own copy of the same
 * expression: the cart's trust card, the admin orders screen and the team
 * order email. They must agree, because the email is what the shop floor works
 * from and the admin screen is where the artwork gets chased; a line the cart
 * calls blank but the email calls empty is a PAID order nobody produces.
 *
 * Plain module: no Prisma client, no server-only import, so the pure email
 * formatter and a client island can both use it.
 */
/**
 * @typedef {{ designId: string | null, designProofUrl: string | null }} DesignFields
 * @typedef {DesignFields & { designJson?: unknown }} DesignLineFields
 *   `designJson`: the Prisma Json column, unknown on purpose so callers never cast it.
 */

/** @param {DesignFields} line */

export function isDesignedLine(line) {
  return Boolean(line.designId || line.designProofUrl);
}

/** @param {DesignLineFields} line */
export function isBlankLine(line) {
  if (isDesignedLine(line)) return false;
  const json = line.designJson;
  return (
    typeof json === "object" &&
    json !== null &&
    /** @type {{ blank?: unknown }} */ (json).blank === true
  );
}

/**
 * Whether a design's elements put anything on the can cooler: a logo, or a
 * line of text that is more than spaces. The designer lets a customer skip
 * both, so a blank sleeve can reach checkout on purpose or by accident; the
 * checkout step asks first (artwork-preflight.js) and the order emails say
 * so out loud (isUnprintedDesign).
 */
export function hasPrintableArtwork(elements) {
  if (!Array.isArray(elements)) return false;
  return elements.some((el) => {
    if (typeof el !== "object" || el === null) return false;
    const { type, text } = /** @type {{ type?: unknown, text?: unknown }} */ (el);
    return type === "logo" || (type === "text" && typeof text === "string" && text.trim() !== "");
  });
}

/**
 * A DESIGNED line whose stored layout prints nothing: the customer finished
 * the designer with no logo and no text and confirmed it at checkout. Unlike
 * a BLANK line there is no artwork to wait for, but the shop floor must not
 * mistake an empty layout for a lost one. Lines stored before designJson
 * existed carry no elements list and are not called unprinted.
 */
export function isUnprintedDesign(line) {
  if (!isDesignedLine(line)) return false;
  const json = line.designJson;
  if (typeof json !== "object" || json === null) return false;
  const { elements, patternId } = /** @type {{ elements?: unknown, patternId?: unknown }} */ (json);
  return Array.isArray(elements) && !hasPrintableArtwork(elements) && !patternId;
}

/**
 * Which designer a stored design document came from. A can cooler document
 * (schema v3) names its die by `size` and carries no `kind`, and neither does
 * an empty or garbled one, which has always been read as a can cooler (its
 * proof is the artwork of record). A hat document (schema v4) says
 * `kind: "hat"` and names its die by `dieId` ("hat-no-7"). Anything else is
 * "other": a product this storefront cannot make from that document.
 *
 * Every path that reads a document as a can cooler checks this first, so a
 * hat is never opened, priced or made on a can's die (2026-10-20).
 */
/** @typedef {"koozie" | "hat" | "other"} DesignKind */

/**
 * @param {unknown} json
 * @returns {DesignKind}
 */
export function designKindOf(json) {
  const doc = typeof json === "object" && json !== null && !Array.isArray(json) ? json : {};
  const { kind = "koozie", dieId } = /** @type {{ kind?: unknown, dieId?: unknown }} */ (doc);
  if (kind === "hat" || (typeof dieId === "string" && dieId.startsWith("hat-"))) return "hat";
  return kind === "koozie" ? kind : "other";
}

/**
 * Whether a stored design document is a can cooler's. Compared against an
 * empty document's kind, which is always the can cooler's (above), so the
 * enum value is written in one place.
 */
export function isCanCoolerDesign(json) {
  return designKindOf(json) === designKindOf(null);
}

/**
 * Whether a line gets a free digital mockup to approve before it is made: a
 * catalog line (a hat or polo from its product page), and a hat designed
 * online, which then gets a sample too (Brayden, 2026-10-19). A designed can
 * cooler's preview is its proof, and a blank one waits for its artwork, so
 * neither does.
 *
 * Reads a cart line (which carries `designKind` and `designBlank`, computed in
 * cart.ts) or an order line (which carries `designJson`).
 *
 * @param {DesignLineFields & { designKind?: DesignKind | null, designBlank?: boolean }} line
 */
export function owesMockup(line) {
  if (isDesignedLine(line)) return (line.designKind ?? designKindOf(line.designJson)) === "hat";
  return !(line.designBlank ?? isBlankLine(line));
}

/** An AI, EPS or PDF file the customer placed as a stand-in box. */
/** @typedef {{ url: string, fileName: string }} LineArtworkFile */

/**
 * The AI, EPS and PDF files behind a DESIGNED line's stand-in boxes
 * (vector-artwork.js, 2026-10-18), one entry per file however many boxes
 * draw it. Such a line is the one exception to "the preview is the proof":
 * the team places the logo where the box is and emails a proof, and
 * production waits for the customer's approval. The list was checked when
 * the line was added (coozie-quote.ts); this only reads it.
 */
/**
 * @param {DesignLineFields} line
 * @returns {LineArtworkFile[]}
 */
export function artworkFilesOf(line) {
  if (!isDesignedLine(line)) return [];
  const json = line.designJson;
  if (typeof json !== "object" || json === null) return [];
  const list = /** @type {{ artworkFiles?: unknown }} */ (json).artworkFiles;
  if (!Array.isArray(list)) return [];
  /** @type {LineArtworkFile[]} */
  const out = [];
  for (const entry of list) {
    const { url, fileName } = /** @type {{ url?: unknown, fileName?: unknown }} */ (entry ?? {});
    if (typeof url !== "string" || typeof fileName !== "string") continue;
    if (out.some((f) => f.url === url)) continue;
    out.push({ url, fileName });
  }
  return out;
}

/** "logo.ai", "logo.ai and back.pdf", "a.ai, b.eps and c.pdf". */
/** @param {LineArtworkFile[]} files */
export function fileNameList(files) {
  const names = files.map((f) => f.fileName);
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
