// The renderer. Peers: react, react-dom, konva, react-konva.
//
// Split from `core` on purpose: `core` is zero-dependency and safe to import
// anywhere — a server action pricing a design, a Node script building a supplier
// zip, a test. `stage` needs a DOM and a canvas. Importing `@reel48/designer/core`
// must never drag Konva in behind it.
export { default as DesignStage } from "./DesignStage.jsx";
export { useImage } from "./useImage.js";
