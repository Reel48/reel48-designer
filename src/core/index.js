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
