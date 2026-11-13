// The one door to the 3D dependency, `@google/model-viewer` (on three.js):
// nothing else in the package imports it, and it is only ever import()ed, so a
// host that bundles this module keeps it out of its first load.
//
// Ported from Reel48-Storefront src/components/storefront/coozie/load-3d.js
// (origin/main d78d90ee). What changed, for a host under a strict CSP
// (account.reel48.com):
//   - The meshopt "decoder location" is the host's own same-origin empty
//     script, passed in. The storefront used `data:text/javascript,`, which a
//     `script-src` without `data:` blocks. A `data:` URL is refused here.
//   - No asset URL is built in. The host passes every URL it wants warmed,
//     and only same-origin ones are fetched.

/**
 * The models are meshopt-compressed. model-viewer 4.2.0 bundles three's
 * decoder but switches it on only once a script has loaded from
 * `ModelViewerElement.meshoptDecoderLocation`, and loads no model until then.
 * The script's content is never used: an empty file served by the host is
 * enough, and nothing comes from a CDN.
 */
let viewerLoading = null;
let decoderLocation = null;

/**
 * Whether `url` is on this page's own origin (always true off a page, where
 * nothing is fetched by a browser anyway). Relative URLs are same-origin.
 *
 * @param {string} url
 * @returns {boolean}
 */
export function sameOrigin(url) {
  if (typeof url !== "string" || url === "") return false;
  const here = globalThis.location;
  if (!here || typeof here.href !== "string") return !/^[a-z][a-z0-9+.-]*:/i.test(url) && !url.startsWith("//") && !url.startsWith("\\");
  try {
    return new URL(url, here.href).origin === here.origin;
  } catch {
    return false;
  }
}

/**
 * Loads model-viewer (defining `<model-viewer>`), once a page. Resolves to
 * its module; a failed load is forgotten, so a later call tries again.
 *
 * @param {{ meshoptDecoderLocation: string }} options the URL of a
 *   same-origin, empty JavaScript file (the portal's `meshopt-ready.js`). It
 *   must not be a `data:` URL: a strict CSP blocks it.
 * @returns {Promise<unknown>}
 */
export function loadViewer({ meshoptDecoderLocation } = /** @type {any} */ ({})) {
  if (typeof meshoptDecoderLocation !== "string" || !meshoptDecoderLocation) {
    return Promise.reject(new TypeError("loadViewer needs { meshoptDecoderLocation }: the URL of a same-origin empty script."));
  }
  if (/^\s*data:/i.test(meshoptDecoderLocation) || !sameOrigin(meshoptDecoderLocation)) {
    return Promise.reject(new TypeError("meshoptDecoderLocation must be a same-origin script URL, never a data: URL."));
  }
  if (viewerLoading && decoderLocation !== meshoptDecoderLocation) {
    return Promise.reject(new Error("The 3D viewer is already loading with another meshoptDecoderLocation."));
  }
  if (!viewerLoading) {
    decoderLocation = meshoptDecoderLocation;
    const w = /** @type {any} */ (globalThis);
    w.ModelViewerElement = { ...(w.ModelViewerElement || {}), meshoptDecoderLocation };
    viewerLoading = import("@google/model-viewer").catch((err) => {
      viewerLoading = null;
      decoderLocation = null;
      throw err;
    });
  }
  return viewerLoading;
}

let webgl2 = null;
/**
 * Whether this browser can draw the 3D at all: WebGL 2, which three.js has
 * required since r163 (on WebGL 1 its renderer throws and model-viewer just
 * draws nothing). Asked before the viewer loads, because model-viewer fires no
 * error event then, and a host needs to know to show the flat die. Asked
 * once: the browser can't change its mind. False off a page.
 *
 * @returns {boolean}
 */
export function webglAvailable() {
  if (webgl2 === null) {
    try {
      const gl = /** @type {any} */ (globalThis).document?.createElement("canvas").getContext("webgl2");
      gl?.getExtension("WEBGL_lose_context")?.loseContext();
      webgl2 = Boolean(gl);
    } catch {
      webgl2 = false;
    }
  }
  return webgl2;
}

const warmed = new Set();
/**
 * Starts the 3D's files downloading at once (`urls`, in order of need: the
 * studio, then the models), instead of one after another as the viewer asks
 * for them. The bodies are read through so each lands whole in the HTTP
 * cache, where the viewer's own requests find it. Only same-origin URLs are
 * fetched. Returns false where the 3D can't run, so nothing is fetched for it.
 * The viewer's code itself is loaded by loadViewer, which a host calls too.
 *
 * @param {Array<string | null | undefined>} urls
 * @param {(url: string) => Promise<{ arrayBuffer: () => Promise<unknown> }>} [fetchImpl]
 * @returns {boolean}
 */
export function warm3D(urls, fetchImpl = (u) => fetch(u)) {
  if (!webglAvailable()) return false;
  for (const url of urls ?? []) {
    if (typeof url !== "string" || warmed.has(url) || !sameOrigin(url)) continue;
    warmed.add(url);
    Promise.resolve()
      .then(() => fetchImpl(url))
      .then((r) => r.arrayBuffer())
      .catch(() => warmed.delete(url));
  }
  return true;
}
