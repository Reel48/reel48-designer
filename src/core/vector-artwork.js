// Ported to @reel48/designer v1.15.0 from Reel48-Storefront src/lib/vector-artwork.js (origin/main d78d90ee). Comments are the storefront's; imports point into this package.
//
// AI, EPS and PDF logos in the can cooler designer (Brayden, 2026-10-17:
// "upload it, we finish it"). The designer never draws one of these files.
// It checks the file is what its name says, reads the shape of its artboard
// when it can, and places a stand-in box of that shape for the customer to
// position. The original file travels with the design (drafts, the upload,
// the cart line's `artworkFiles`), and the team puts the real logo where the
// box is and emails a proof before production.
//
// Pure and dependency-free, so the browser, the server's checks and the
// tests read the same rules. The drawing of the box is in
// vector-artwork-client.js.

/** File names the designer takes as vector artwork. */
export const VECTOR_FILE_NAME = /\.(ai|eps|pdf)$/i;

/** What browsers report for those files (often nothing at all for .ai and .eps). */
export const VECTOR_MIME = ["application/pdf", "application/postscript", "application/illustrator", "image/x-eps", "application/eps"];

/** The content types an original vector file is stored under, by what its bytes say it is. */
export const ARTWORK_CONTENT_TYPES = ["application/pdf", "application/postscript"];

/** The stand-in's longer side, in pixels: large enough to place, never to print. */
export const STAND_IN_LONG_EDGE = 1200;

/** The shape used when the file's artboard can't be read, as width over height. */
export const DEFAULT_ASPECT = 3 / 2;

const MAX_ASPECT = 4;

/** Whether a picked file should be handled as vector artwork. */
export function isVectorFile(file) {
  return Boolean(file) && (VECTOR_FILE_NAME.test(String(file.name || "")) || VECTOR_MIME.includes(file.type));
}

function startsWith(bytes, text, at = 0) {
  if (bytes.length < at + text.length) return false;
  for (let i = 0; i < text.length; i += 1) {
    if (bytes[at + i] !== text.charCodeAt(i)) return false;
  }
  return true;
}

/**
 * What the file's own bytes say it is: "pdf" (a PDF, and every Illustrator
 * file saved since CS, which carries a PDF header), "postscript" (an EPS, a
 * legacy .ai, or the binary DOS EPS wrapper), or null for anything else. A
 * PDF may have junk before its header; the PDF spec allows it within the
 * first 1024 bytes.
 *
 * @param {Uint8Array} bytes
 * @returns {"pdf" | "postscript" | null}
 */
export function sniffVectorKind(bytes) {
  if (!bytes || bytes.length < 4) return null;
  if (bytes[0] === 0xc5 && bytes[1] === 0xd0 && bytes[2] === 0xd3 && bytes[3] === 0xc6) return "postscript";
  if (startsWith(bytes, "%!PS")) return "postscript";
  const limit = Math.min(bytes.length - 5, 1024);
  for (let i = 0; i <= limit; i += 1) {
    if (bytes[i] === 0x25 && startsWith(bytes, "%PDF-", i)) return "pdf";
  }
  return null;
}

/** The content type an original is stored under. */
export function artworkContentType(kind) {
  return kind === "pdf" ? "application/pdf" : "application/postscript";
}

const NUM = "(-?\\d+(?:\\.\\d+)?|-?\\.\\d+)";
const MEDIA_BOX = new RegExp(`/MediaBox\\s*\\[\\s*${NUM}\\s+${NUM}\\s+${NUM}\\s+${NUM}\\s*\\]`);
const HIRES_BOUNDING_BOX = new RegExp(`%%HiResBoundingBox:\\s*${NUM}\\s+${NUM}\\s+${NUM}\\s+${NUM}`);
const BOUNDING_BOX = new RegExp(`%%BoundingBox:\\s*${NUM}\\s+${NUM}\\s+${NUM}\\s+${NUM}`);

function latin1(bytes) {
  // One byte, one character: the boxes are ASCII. TextDecoder is several
  // times faster on a 12 MB file than building the string by hand.
  if (typeof TextDecoder !== "undefined") {
    try {
      return new TextDecoder("latin1").decode(bytes);
    } catch {
      // A runtime without the encoding falls through.
    }
  }
  let out = "";
  // In slices, so a 12 MB file never builds one enormous argument list.
  for (let i = 0; i < bytes.length; i += 0x8000) {
    out += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return out;
}

function boxAspect(match) {
  if (!match) return null;
  const [x1, y1, x2, y2] = match.slice(1, 5).map(Number);
  const w = Math.abs(x2 - x1);
  const h = Math.abs(y2 - y1);
  if (!(w > 0) || !(h > 0) || !Number.isFinite(w / h)) return null;
  return w / h;
}

/**
 * The artboard's shape, width over height, held between 1:4 and 4:1: a PDF's
 * first MediaBox, an EPS's bounding box. A PDF whose page objects are
 * compressed hides it, and gets DEFAULT_ASPECT; the customer resizes the
 * box either way, and the team places the real logo.
 *
 * @param {Uint8Array} bytes
 * @param {"pdf" | "postscript"} kind
 */
export function readVectorAspect(bytes, kind) {
  const text = latin1(bytes);
  const aspect =
    kind === "pdf"
      ? boxAspect(MEDIA_BOX.exec(text))
      : boxAspect(HIRES_BOUNDING_BOX.exec(text)) ?? boxAspect(BOUNDING_BOX.exec(text));
  if (!aspect) return DEFAULT_ASPECT;
  return Math.min(MAX_ASPECT, Math.max(1 / MAX_ASPECT, aspect));
}

/** The stand-in's pixel size for an aspect: STAND_IN_LONG_EDGE on its longer side. */
export function standInSize(aspect) {
  const a = Number.isFinite(aspect) && aspect > 0 ? aspect : DEFAULT_ASPECT;
  return a >= 1
    ? { width: STAND_IN_LONG_EDGE, height: Math.round(STAND_IN_LONG_EDGE / a) }
    : { width: Math.round(STAND_IN_LONG_EDGE * a), height: STAND_IN_LONG_EDGE };
}

/** The name a stand-in is uploaded under, beside the original it stands in for. */
export function standInFileName(originalName) {
  return `${originalName || "logo"}-stand-in.png`;
}
