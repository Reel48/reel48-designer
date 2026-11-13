// Ported to @reel48/designer v1.15.0 from Reel48-Storefront src/lib/decorations.ts (origin/main d78d90ee), TypeScript as JSDoc. Comments are the storefront's; imports point into this package.
//
/**
 * Human labels for decoration slugs — the single source of truth.
 *
 * This map previously existed in five places: DecorationTypeSelector,
 * CartLineItem, the cart checkout action, the Stripe webhook, and the coozie
 * designer. They drifted. DecorationTypeSelector's copy predated the coozie's
 * magnet options, so when the catalog went live the product page showed
 * customers the raw slugs "no_magnet" and "with_magnet".
 *
 * Plain module, not the server layer, so client components and Server Actions
 * can share it. Add a decoration slug HERE and everywhere renders it correctly.
 */
export const DECORATION_LABELS = {
  // Hats
  embroidery: "Embroidery",
  pvc_patch: "PVC Patch",
  silicon_patch: "Silicone Patch",
  woven_patch: "Woven Patch",
  blank: "No Decoration (Blank)",
  // Coozies — the magnet is the decoration. The DIE is a separate product
  // (custom-coozie vs custom-coozie-slim), so the size reaches the cart line,
  // the Stripe description and the order emails as the product title rather
  // than being folded in here.
  no_magnet: "No Magnet",
  with_magnet: "With Magnet",
};

export const DECORATION_DESCRIPTIONS = {
  // "the fabric", not "the hat": polos are embroidered too, and this line
  // shows under the chip on every product that offers embroidery.
  embroidery: "Thread-stitched directly onto the fabric",
  pvc_patch: "Durable rubber-like 3D patch",
  silicon_patch: "Soft, flexible raised patch",
  woven_patch: "Detailed fabric patch sewn on",
  blank: "Undecorated hat for reseller or DIY use",
  no_magnet: "Standard collapsible can cooler",
  with_magnet: "Built-in magnet so it sticks to metal surfaces",
};

/**
 * Every decoration slug the catalog can carry, across all categories.
 *
 * Distinct from `VALID_DECORATION_TYPES` in @/lib/pricing, which is the HAT
 * decoration set and carries that meaning in the pricing rules. This is the
 * admin's allow-list: it must cover every slug any product actually uses, or
 * saving that product silently drops the ones it omits.
 */
export const ALL_DECORATION_SLUGS = Object.keys(DECORATION_LABELS);

/**
 * Methods a hat design's extra spots are made with that are never a
 * product's decoration: the inside label is woven, and is priced as an extra
 * spot (hat-placements.ts). Kept out of DECORATION_LABELS so it never joins
 * ALL_DECORATION_SLUGS, the admin's list of decorations a product can offer.
 */
const SPOT_METHOD_LABELS = {
  woven_label: "Woven label",
};

/** Falls back to the raw slug rather than rendering nothing. */
export function decorationLabel(slug) {
  if (!slug) return "";
  return DECORATION_LABELS[slug] ?? SPOT_METHOD_LABELS[slug] ?? slug;
}

export function decorationDescription(slug) {
  return DECORATION_DESCRIPTIONS[slug] ?? "";
}
