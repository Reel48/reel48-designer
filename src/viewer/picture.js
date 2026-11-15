// The design in 3D as a picture to keep (the order's picture-3d.png): the
// front and the back side by side on a light grey, as both storefront 3D
// views make it (CanCooler3D.jsx and Hat3D.jsx `picture()`, Reel48-Storefront
// origin/main d78d90ee), pulled out as plain functions.

/** The picture: front and back side by side on the storefront's light grey (sf-canvas). */
export const PICTURE = Object.freeze({ width: 1600, height: 1000, ground: "#F7F8FA" });

/** The next animation frame, as a promise. */
export const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));

/**
 * Two shots (front, back) side by side on PICTURE's ground, as a PNG. Each is
 * fitted into its half and never enlarged: a desktop's smaller render, scaled
 * up, went soft. The bitmaps are closed.
 *
 * @param {Array<ImageBitmap | HTMLCanvasElement>} shots
 * @param {{ document?: Document, picture?: { width: number, height: number, ground: string } }} [options]
 * @returns {Promise<Blob | null>}
 */
export async function composePicture(shots, { document: doc = globalThis.document, picture = PICTURE } = {}) {
  const canvas = doc.createElement("canvas");
  canvas.width = picture.width;
  canvas.height = picture.height;
  const g = /** @type {CanvasRenderingContext2D} */ (canvas.getContext("2d"));
  g.fillStyle = picture.ground;
  g.fillRect(0, 0, picture.width, picture.height);
  const half = picture.width / 2;
  shots.forEach((bmp, i) => {
    const s = Math.min(1, half / bmp.width, picture.height / bmp.height);
    const w = bmp.width * s;
    const h = bmp.height * s;
    g.drawImage(bmp, i * half + (half - w) / 2, (picture.height - h) / 2, w, h);
    /** @type {any} */ (bmp).close?.();
  });
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  canvas.width = 0;
  return /** @type {Blob | null} */ (blob);
}

/**
 * Covers the view with a still of itself while the camera visits the front
 * and the back, so the customer never sees it jump. Returns a function that
 * takes the cover away. With no `host`, or a host that is hidden, nothing is
 * covered. The cover is an <img> laid over the host by its `className`, or
 * else by CSSOM properties (never a `style` attribute, so a strict
 * `style-src` allows it); the host should be positioned.
 *
 * @param {any} mv the <model-viewer>
 * @param {{ host?: HTMLElement | null, className?: string }} [cover]
 * @returns {Promise<() => void>}
 */
export async function coverView(mv, { host = null, className } = {}) {
  if (!host) return () => {};
  const view = host.ownerDocument?.defaultView;
  if (view?.getComputedStyle(host).visibility === "hidden") return () => {};
  const still = await mv.toBlob({ mimeType: "image/png" });
  const img = host.ownerDocument.createElement("img");
  img.alt = "";
  if (className) img.className = className;
  else Object.assign(img.style, { position: "absolute", inset: "0", width: "100%", height: "100%", objectFit: "contain" });
  img.src = URL.createObjectURL(still);
  await img.decode().catch(() => {});
  host.appendChild(img);
  return () => {
    img.remove();
    URL.revokeObjectURL(img.src);
  };
}
