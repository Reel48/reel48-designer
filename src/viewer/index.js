// The 3D views, framework-free: no React, no Next, no Tailwind, no analytics.
// Peers (optional): `@google/model-viewer` 4.2.0, which brings `three`
// 0.182.0; only loadViewer imports it, by `import()`.
//
// Ported in v1.15.0 from Reel48-Storefront origin/main d78d90ee:
// src/components/storefront/hat/{hat-look,hat-surface,hat-edit,hat-place,
// hat-edit-host,hat-3d-assets}.js and coozie/load-3d.js, with the can
// cooler's painting and both views' settings and pictures pulled out of
// CanCooler3D.jsx and Hat3D.jsx. Every asset URL is the host's, and nothing
// here injects a <style> element, writes a `style` attribute from markup,
// evaluates code, or fetches from another origin. See the README.

// Loading model-viewer, WebGL 2, warming the files.
export { loadViewer, sameOrigin, warm3D, webglAvailable } from "./load-3d.js";

// The can cooler.
export * from "./can-cooler.js";

// The hat: the host's side, the files, and the storefront's modules as they are.
export * from "./hat-view.js";
export * from "./hat-3d-assets.js";
export * from "./hat-look.js";
export * from "./hat-surface.js";
export * from "./hat-edit.js";
export * from "./hat-place.js";
export * from "./hat-edit-host.js";

// The picture both views make.
export { PICTURE, composePicture, coverView, nextFrame } from "./picture.js";
