export {
  DIES,
  DEFAULT_DIE_ID,
  DIE_LINE_COLOR,
  DIE_LINE_OPACITY,
  DIE_LINE_WIDTH,
  dieGeometry,
  diesOfKind,
  isKoozieGeometry,
  nearestZone,
  resolveDie,
  snapTargets,
  traceDie,
  tracePath,
  zoneAt,
} from "./dies.js";

export { hatOutline } from "./hats.js";

// v1.12.0: the hat placer's confine rule (region.js, verbatim). Its rubber
// band is `areaRubberBand` here: `rubberBand` is confine.js's, a different
// curve that the koozie stage has used since v1.7.0.
export {
  areaBounds,
  areaHome,
  areaRect,
  areaRings,
  bandPose,
  confinePose,
  overhang,
  pointInArea,
  poseValid,
  rotatedSize,
  rubberBand as areaRubberBand,
} from "./region.js";

export {
  IDENTITY_CAMERA,
  artExportRect,
  cameraFor,
  cameraForResize,
  cameraPoint,
  containDisplayWidth,
  focusRects,
} from "./camera.js";

export { MAGNET_INCHES, magnetRect } from "./magnet.js";
export {
  confineCenter,
  elementFits,
  faceAt,
  faceClipRegion,
  faceRegions,
  fitScale,
  insideRegion,
  rubberBand,
  scaleRegion,
  traceRegion,
  zoneOfElement,
} from "./confine.js";

export {
  DEFAULT_COLOR,
  DEFAULT_TEXT,
  DESIGN_SCHEMA_VERSION,
  ZONED_SCHEMA_VERSION,
  designDie,
  designReducer,
  historyReducer,
  initialDesignState,
  initialHistoryState,
  moveToZone,
  nextElementId,
  toDesignDescription,
} from "./design.js";

// v1.14.0: where a tiled pattern starts, and the back panel drawn upright.
export { patternFillScale, patternPlacements, tracePatternClip } from "./pattern.js";

// ---------------------------------------------------------------------------
// v1.15.0: the storefront's framework-free design modules, moved here so the
// portal (account.reel48.com) and the hub (data.reel48.com) read one copy.
// Ported from Reel48-Storefront origin/main d78d90ee; see the README.
// ---------------------------------------------------------------------------

// What a design is priced from, and what is refused.
export { HAT_DECORATIONS, InvalidDesignError, pricingFacts } from "./pricing-facts.js";

// The production spec (the storefront's /api/admin/orders `designSpec`).
export { describeDesign, specToTextLines } from "./coozie-spec.js";
export { describeHatDesign, hatFixedMarks, hatSpecToTextLines, isHatSpec, partColourText } from "./hat-spec.js";

// Which designer a document came from, and the line kinds.
export {
  artworkFilesOf,
  designKindOf,
  fileNameList,
  hasPrintableArtwork,
  isBlankLine,
  isCanCoolerDesign,
  isDesignedLine,
  isUnprintedDesign,
  owesMockup,
} from "./design-lines.js";

export {
  ALL_DECORATION_SLUGS,
  DECORATION_DESCRIPTIONS,
  DECORATION_LABELS,
  decorationDescription,
  decorationLabel,
} from "./decorations.js";

// The can cooler's storefront vocabulary. Its dieGeometry, traceDie,
// resolveDie, DEFAULT_COLOR, DEFAULT_TEXT and DIE_LINE_* are the core's own
// (above) under the storefront's legacy size ids, so they are not re-exported.
export {
  ACCEPTED_FONT_ACCEPT_ATTR,
  ACCEPTED_FONT_MIME,
  ACCEPTED_MIME,
  COLOR_PRESETS,
  COOZIE_SIZES,
  COOZIE_SIZE_LIST,
  DEFAULT_SIZE_ID,
  DESIGN_RELAY_MAX_BYTES,
  FONT_OPTIONS,
  KOOZIE_PRODUCT_HANDLES,
  LOGO_ACCEPT_ATTR,
  MAX_FILE_BYTES,
  MAX_FONTS,
  MAX_LOGOS,
  SNAP_THRESHOLD,
  dieInches,
  koozieProductHandle,
  resolveSize,
} from "./coozie-config.js";

export {
  COOZIE_PATTERNS,
  PATTERN_BASE,
  PATTERN_FAMILIES,
  isPatternId,
  patternById,
  patternGroups,
  patternName,
  patternPrintPath,
  patternRepeatIn,
  patternTile,
} from "./coozie-patterns.js";

// Hats: dies as the storefront reads them, styles, spots, colours.
export {
  CHOSEN_PARTS,
  DEFAULT_PRESET_ID,
  HAT_DIES,
  HAT_FABRIC_COLORS,
  HAT_NO_6_DIE,
  HAT_NO_7_DIE,
  HAT_NO_7_V1_DIE,
  HAT_PARTS,
  HAT_PART_GROUPS,
  HAT_PRESETS,
  HAT_THREAD_COLORS,
  LABEL_GROUND_COLORS,
  LABEL_GROUND_SWATCHES,
  LABEL_SHAPES,
  LABEL_ZONE,
  MAX_THREADS_PER_SPOT,
  NATURAL_LABEL_GROUND,
  OUTSIDE_ZONES,
  RETIRED_ZONES,
  SPOT_AREAS,
  SPOT_HOMES,
  SPOT_LEVELS,
  SPOT_NAMES,
  fabricColourName,
  hatDie,
  presetOf,
  presetParts,
  spotFact,
  spotHome,
  spotLevel,
  wholeHatParts,
} from "./hat-config.js";
export { DEFAULT_HAT_STYLE, HAT_DESIGN_STYLES, chosenPartsOf, hatStyleOf } from "./hat-style-config.js";
export { SWEATBANDS, SWEATBAND_FOLLOWS, labelGroundFor, sweatbandFor, withSweatband } from "./sweatband.js";
export { deltaE2000, hexToLab, hexToLch, hexToRgb, labToLch } from "./cielab.js";
export {
  PMS_COLORS,
  PMS_FAMILIES,
  PMS_FILE_COUNT,
  buildPmsPalette,
  familyOf,
  nearestPms,
  nearestPmsColors,
  pmsByFormerHex,
  pmsByHex,
  pmsById,
  pmsIdOf,
  searchPms,
} from "./pms-palette.js";
// A hat's spots. Its zoneOfElement(el, die) is `hatZoneOfElement` here:
// `zoneOfElement` is confine.js's (geom, stage, el), exported since v1.11.0.
export {
  MISFIT_CAP,
  MISFIT_PX,
  confineElement,
  distanceToArea,
  elementPose,
  extraAsItem,
  fitsSpot,
  hatPlacements,
  hatSpotProblem,
  logoMisfit,
  placeElement,
  spotLine,
  spotSummary,
  strayElement,
  zoneArea,
  zoneAtPoint,
  zoneCap,
  zoneOfElement as hatZoneOfElement,
} from "./hat-placements.js";

// The designers' on-device drafts, their step machines, the first-die
// migration and the AI/EPS/PDF stand-ins, each as a namespace: the two step
// machines (and the two drafts) share export names.
export * as coozieDraft from "./coozie-draft.js";
export * as hatDraft from "./hat-draft.js";
export * as hatMigrate from "./hat-migrate.js";
export * as coozieSteps from "./coozie-step-machine.js";
export * as hatSteps from "./hat-step-machine.js";
export * as vectorArtwork from "./vector-artwork.js";
