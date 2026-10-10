"use client";

// The canvas: draws a design document onto a die, and edits it in place.
//
// Extracted from Reel48-Storefront/src/components/storefront/coozie/
// CoozieStage.jsx. The Konva tree, the snap arithmetic, the transform maths and
// the export path are unchanged — see the storefront's own adapter for the
// evidence, and the changelog below for every intentional difference.
//
// WHAT MOVED AND WHY: this component turns normalized fractions into pixels and
// pixels back into normalized fractions. Both directions are the design
// document's own arithmetic, and getting either wrong relocates artwork. It
// belongs with the geometry it is inverting, not with either app's chrome.
//
// WHAT STAYED BEHIND: every panel, picker, toolbar and button. Those compute
// class names. This computes coordinates. The README states the rule.
//
// ---------------------------------------------------------------------------
// The four intentional differences from the storefront original
//
//  1. `dieId` replaces `size`, resolved through the package's `resolveDie`.
//     Legacy `"standard"` / `"slim"` still work — `resolveDie` maps them.
//  2. Snap targets come from `geom.zones[].snapLines` rather than three
//     hardcoded expressions. For a koozie the resulting numbers are IDENTICAL
//     (front-panel centre, back-panel centre, and the shared vertical). It
//     matters for what comes next: a hat has one zone, a polo has a bounded
//     imprint, and neither can be expressed as "the two panel midpoints".
//  3. Class names are props. This package has no Tailwind and the portal has no
//     Tailwind either — it has `r48-*`. The host owns every cosmetic class; the
//     package owns the styles it must COMPUTE (positions, sizes, the fonts a
//     text element declares), which it applies via React's `style` prop.
//     That is deliberate for the portal's CSP: React sets `style` through
//     `style.setProperty` (CSSOM), which `style-src` does not govern, whereas a
//     literal `style="…"` attribute would be blocked.
//  4. `accent` replaces the four hardcoded `#0a6b6b` occurrences. It defaults to
//     that same value, so a host that passes nothing renders exactly what the
//     storefront rendered. The accent only ever touches the UI layer — snap
//     guides and the transformer — which is detached before export, so it can
//     never reach a proof or a stored document.
// ---------------------------------------------------------------------------
// v1.5.0: a camera and two-finger gestures for a phone host. ALL OPT-IN.
//
// Two apps consume this stage. With none of the props below passed, it renders
// and behaves exactly as v1.4.1 did: no layer is ever transformed, the export
// is the same `toBlob` call, and every new listener is a no-op.
//
//  5. `fit="contain"` fits the die inside a box the host sizes, and `view`
//     points a camera (core/camera.js) at one face of it. The camera is written
//     to the three layers IMPERATIVELY and tweened as one; it is reset for the
//     export, so a proof is still the whole die at native resolution.
//  6. `gestures` adds pinch / twist / pan of the selected element from raw
//     container touch events. One gesture is one undo step.
//  7. `interactive`, `inlineTextEdit`, `touchAction`, `anchorSize` and
//     `anchorPadding` let a host that owns its own controls switch the stage's
//     off or resize them. `onManipulate` and `onSnap` report what a finger is
//     doing (the storefront uses them for haptics and to retire hints).
//  8. `hint(id)` sways an element a few pixels and back. It never dispatches.
//  9. The die-line and snap guides draw with `strokeScaleEnabled={false}`, so
//     they stay hairlines under a zoom. At scale 1 that is the same pixels.
// ---------------------------------------------------------------------------
// v1.6.0: two more opt-in props for the same phone host. Unpassed, the stage is
// v1.5.0 to the attr.
//
// 10. `magnet` draws a "with magnet" koozie's magnet strip (core/magnet.js) on
//     the back panel, in the die-line overlay layer so it follows the camera
//     and never takes a tap. It is a part, not print: every proof is taken
//     with it hidden.
// 11. `animateResize` glides the camera when the container changes size under
//     an unchanged view (a host panel growing or shrinking), where v1.5.0
//     jumps.
// ---------------------------------------------------------------------------

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Konva from "konva";
import {
  Stage,
  Layer,
  Group,
  Rect,
  Line,
  Shape,
  Image as KonvaImage,
  Text as KonvaText,
  Transformer,
} from "react-konva";
import {
  DIE_LINE_COLOR,
  DIE_LINE_OPACITY,
  DIE_LINE_WIDTH,
  IDENTITY_CAMERA,
  cameraFor,
  cameraPoint,
  containDisplayWidth,
  dieGeometry,
  focusRects,
  magnetRect,
  resolveDie,
  snapTargets,
  traceDie,
} from "../core/index.js";
import { useImage } from "./useImage.js";
import { createImageReadiness } from "./imageReadiness.js";

/**
 * The die line's width in a contain-mode proof, in NATIVE stage px. Width mode
 * keeps v1.4.1's DIE_LINE_WIDTH × pixelRatio (about 4–5 px on the storefront's
 * desktop canvas); contain mode pins the same look rather than letting a small
 * on-screen die thicken it.
 */
const CONTAIN_PROOF_DIE_LINE_PX = 4;

/** Snap distance to a guide, in NATIVE stage px. */
const DEFAULT_SNAP_THRESHOLD = 8;

/** The storefront's colour, so an unconfigured host is byte-identical to it. */
const DEFAULT_ACCENT = "#0a6b6b";

/** The transformer's anchor size before v1.5.0 made it a prop. */
const DEFAULT_ANCHOR_SIZE = 18;

/** Overview: the whole die. Frozen so a default can't be mutated by a host. */
const DEFAULT_VIEW = Object.freeze({ focus: null });

/** Neither axis snapped. */
const NO_SNAP = Object.freeze({ x: null, y: null });

/** Nothing measured yet. */
const EMPTY_BOX = Object.freeze({ width: 0, height: 0 });

// Camera move between views. Long enough to show the die turning over for the
// back panel, short enough not to stand between a tap and the next step.
const CAMERA_TWEEN_SECONDS = 0.3;

// The "you can move this" sway: three segments of this length, this far on
// screen. Small on purpose — it is a nudge, not an animation to watch.
const HINT_SEGMENT_SECONDS = 0.2;
const HINT_SCREEN_PX = 6;

// Pinch limits. 16px is the same floor the transformer's boundBoxFunc
// enforces, so a pinch can't shrink an element into something no anchor can
// grab. The logo ceiling stops one hard spread from blowing artwork far past
// the die, where a single finger can no longer find it.
const MIN_DISPLAYED_PX = 16;
const MAX_LOGO_WIDTH_OF_STAGE = 1.5;

/** Twist rotation sticks to 0/90/180/270 within this many degrees. */
const PINCH_ROTATION_SNAP = 4;

// The magnet strip's look. Charcoal like the part in the photo, with a pale
// stitched border and pads that catch a little light from above. "ghost" lets
// the artwork under it show while the customer is placing it.
const MAGNET_FILL = "#262626";
const MAGNET_PAD_TOP = "#3a3a3a";
const MAGNET_PAD_BOTTOM = "#1c1c1c";
const MAGNET_STITCH = "rgba(255, 255, 255, 0.45)";
const MAGNET_GHOST_OPACITY = 0.35;

/** The transform a camera writes, read back off a layer. */
function readCamera(layer) {
  return {
    x: layer.x(),
    y: layer.y(),
    offsetX: layer.offsetX(),
    offsetY: layer.offsetY(),
    scaleX: layer.scaleX(),
    scaleY: layer.scaleY(),
    rotation: layer.rotation(),
  };
}

/** Write one camera to every layer, then draw — all of them in one frame. */
function setCamera(layers, camera) {
  for (const layer of layers) layer.setAttrs(camera);
  for (const layer of layers) layer.batchDraw();
}

/** Degrees into (-180, 180], the range the transformer itself produces. */
function wrap180(deg) {
  const r = ((((deg % 360) + 540) % 360) - 180);
  return r === -180 ? 180 : r;
}

/** A rotation as the badge shows it: whole degrees, 0–359, relative to the view. */
function badgeAngle(rotation, viewRotation) {
  return ((Math.round(rotation - viewRotation) % 360) + 360) % 360;
}

function touchById(touches, id) {
  for (let i = 0; i < touches.length; i++) {
    if (touches[i].identifier === id) return touches[i];
  }
  return null;
}

// Draggable logo image. node.x()/node.y() are the CENTRE (offset is half the
// size), so the stage's centre-snap logic is uniform across logos and text.
function LogoNode({
  el,
  src,
  displayW,
  displayH,
  interactive,
  onSelect,
  onDragStart,
  onDragMove,
  onDragEnd,
  onTransformStart,
  onTransform,
  onTransformEnd,
  registerNode,
  reportImage,
}) {
  const [img, imageStatus] = useImage(src, null); // same-origin blob URL → no crossOrigin needed
  const ref = useRef(null);

  useEffect(() => {
    registerNode(el.id, ref.current);
    return () => registerNode(el.id, null);
  }, [el.id, registerNode, img]);

  // Layout effects run after the Konva node has received this exact image.
  useLayoutEffect(() => {
    reportImage(`logo:${el.id}`, src, img && ref.current ? "loaded" : imageStatus === "failed" ? "failed" : "loading");
  }, [el.id, src, img, imageStatus, reportImage]);

  if (!img) return null;

  const aspect = el.naturalHeight / el.naturalWidth || 1;
  const width = el.scale * displayW;
  const height = width * aspect;

  return (
    <KonvaImage
      ref={ref}
      image={img}
      x={el.x * displayW}
      y={el.y * displayH}
      width={width}
      height={height}
      offsetX={width / 2}
      offsetY={height / 2}
      rotation={el.rotation}
      opacity={el.opacity}
      draggable={interactive}
      listening={interactive}
      onMouseDown={(e) => onSelect(el.id, e)}
      onTouchStart={(e) => onSelect(el.id, e)}
      onTap={(e) => onSelect(el.id, e)}
      onClick={(e) => onSelect(el.id, e)}
      onDragStart={onDragStart}
      onDragMove={onDragMove}
      onDragEnd={(e) => onDragEnd(e, el)}
      onTransformStart={onTransformStart}
      onTransform={onTransform}
      onTransformEnd={(e) => onTransformEnd(e, el)}
    />
  );
}

function TextNode({
  el,
  displayW,
  displayH,
  fontVersion,
  editing,
  interactive,
  onStartEdit,
  onSelect,
  onDragStart,
  onDragMove,
  onDragEnd,
  onTransformStart,
  onTransform,
  onTransformEnd,
  registerNode,
}) {
  const ref = useRef(null);
  const fontSize = el.fontScale * displayW;

  useEffect(() => {
    registerNode(el.id, ref.current);
    return () => registerNode(el.id, null);
  }, [el.id, registerNode]);

  // Re-centre the node on its own bounding box whenever text/size/font changes
  // (Text auto-sizes to content), so position and rotation pivot on the middle.
  // `fontVersion` is in the deps because a custom font finishing loading changes
  // the measured width with no prop change at all.
  useEffect(() => {
    const n = ref.current;
    if (!n) return;
    n.offsetX(n.width() / 2);
    n.offsetY(n.height() / 2);
    n.getLayer()?.batchDraw();
  }, [el.text, el.fontFamily, el.fontStyle, el.align, fontSize, displayW, fontVersion]);

  return (
    <KonvaText
      ref={ref}
      text={el.text || " "}
      fontSize={fontSize}
      fontFamily={el.fontFamily}
      fontStyle={el.fontStyle}
      fill={el.fill}
      align={el.align}
      x={el.x * displayW}
      y={el.y * displayH}
      rotation={el.rotation}
      opacity={el.opacity}
      visible={!editing}
      draggable={interactive}
      listening={interactive}
      onMouseDown={(e) => onSelect(el.id, e)}
      onTouchStart={(e) => onSelect(el.id, e)}
      onTap={(e) => onSelect(el.id, e)}
      onClick={(e) => onSelect(el.id, e)}
      onDblClick={(e) => onStartEdit(el.id, e)}
      onDblTap={(e) => onStartEdit(el.id, e)}
      onDragStart={onDragStart}
      onDragMove={onDragMove}
      onDragEnd={(e) => onDragEnd(e, el)}
      onTransformStart={onTransformStart}
      onTransform={onTransform}
      onTransformEnd={(e) => onTransformEnd(e, el)}
    />
  );
}

// Overlay <textarea> for editing a text element in place on the canvas.
// Positioned from the element's normalized transform (NOT the Konva node) so it
// can open on the same frame the element is created. Enter/blur commit, Escape
// cancels.
//
// Under a camera (contain mode) the same point is pushed through the camera's
// own transform, so the editor still opens over the text rather than where the
// text would be if the die were drawn at the top-left of the box.
// The magnet strip (v1.6.0): a charcoal strip, three pads lit softly from
// above, and a stitch line run midway through the border, all from
// core/magnet.js's native rect times the stage's `scale`. The stitch is a
// screen hairline like the die line. Never hit-tested, never in a proof (the
// export hides it by ref).
const MagnetStrip = forwardRef(function MagnetStrip({ box, scale, opacity }, ref) {
  const x = box.x0 * scale;
  const y = box.y0 * scale;
  const w = (box.x1 - box.x0) * scale;
  const h = (box.y1 - box.y0) * scale;
  const border = (box.pads[0].x0 - box.x0) * scale;
  const radius = w * 0.08;
  return (
    <Group ref={ref} listening={false} opacity={opacity}>
      <Rect x={x} y={y} width={w} height={h} cornerRadius={radius} fill={MAGNET_FILL} />
      {box.pads.map((pad, i) => {
        const padH = (pad.y1 - pad.y0) * scale;
        return (
          <Rect
            key={i}
            x={pad.x0 * scale}
            y={pad.y0 * scale}
            width={(pad.x1 - pad.x0) * scale}
            height={padH}
            cornerRadius={radius / 2}
            fillLinearGradientStartPoint={{ x: 0, y: 0 }}
            fillLinearGradientEndPoint={{ x: 0, y: padH }}
            fillLinearGradientColorStops={[0, MAGNET_PAD_TOP, 1, MAGNET_PAD_BOTTOM]}
          />
        );
      })}
      <Rect
        x={x + border / 2}
        y={y + border / 2}
        width={w - border}
        height={h - border}
        cornerRadius={radius}
        stroke={MAGNET_STITCH}
        strokeWidth={1}
        strokeScaleEnabled={false}
        dash={[3, 2]}
      />
    </Group>
  );
});

function InlineTextEditor({ el, displayW, displayH, camera, viewportWidth, className, onCommit, onCancel }) {
  const taRef = useRef(null);
  const doneRef = useRef(false); // Enter commits, then the unmount fires blur — settle once
  let fontSize = el.fontScale * displayW;
  let width = Math.min(displayW, Math.max(140, displayW * 0.8));
  let centre = { x: el.x * displayW, y: el.y * displayH };
  if (camera) {
    centre = cameraPoint(camera, centre);
    fontSize *= camera.scaleX;
    width = Math.min(viewportWidth, Math.max(140, displayW * 0.8 * camera.scaleX));
  }

  const settle = (fn, value) => {
    if (doneRef.current) return;
    doneRef.current = true;
    fn(value);
  };

  useLayoutEffect(() => {
    const ta = taRef.current;
    if (ta) {
      ta.focus();
      ta.select();
    }
  }, []);

  return (
    <textarea
      ref={taRef}
      defaultValue={el.text}
      rows={1}
      aria-label="Edit text"
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          settle(onCommit, e.currentTarget.value);
        } else if (e.key === "Escape") {
          e.stopPropagation();
          settle(onCancel);
        }
      }}
      onBlur={(e) => settle(onCommit, e.currentTarget.value)}
      className={className}
      style={{
        position: "absolute",
        left: centre.x - width / 2,
        top: centre.y - fontSize * 0.75,
        width,
        height: Math.max(fontSize * 1.5, 28),
        fontSize,
        lineHeight: 1.2,
        // The element's own typography, so what is typed matches what will
        // render the moment it is committed.
        fontFamily: el.fontFamily,
        fontStyle: el.fontStyle?.includes("italic") ? "italic" : "normal",
        fontWeight: el.fontStyle?.includes("bold") ? "bold" : "normal",
        color: el.fill,
        caretColor: el.fill,
        textAlign: el.align,
        // Functional, not cosmetic: a resizable, scrolling or wrapping textarea
        // stops sitting exactly where the text will be. Inline rather than left
        // to the host, because forgetting them breaks behaviour, not looks.
        resize: "none",
        overflow: "hidden",
        whiteSpace: "nowrap",
        background: "transparent",
        padding: 0,
        outline: "none",
      }}
    />
  );
}

/**
 * @param {object}   props
 * @param {object}   props.state         the design document (see core/design.js)
 * @param {function} props.dispatch      the history reducer's dispatch
 * @param {object}   props.logoSources   elementId → object URL / https URL
 * @param {string}   [props.patternSrc]  tiled background image
 * @param {function} [props.onReadyChange] (ready, error|null), current committed artwork
 * @param {number}   [props.fontVersion] bump to re-measure after a font loads
 * @param {string}   [props.dieId]       die id, or a legacy `size`
 * @param {string}   [props.accent]      guides + transformer colour
 * @param {number}   [props.snapThreshold] native stage px
 * @param {object}   [props.classNames]  {root, textEditor, rotationBadge,
 *                                        rotationBadgeAligned}
 *
 * v1.5.0, all opt-in (the defaults are v1.4.1's behaviour):
 * @param {"width"|"contain"} [props.fit="width"] contain = fit inside a box the
 *                                        host gives a definite height
 * @param {object}   [props.view={focus:null}] {focus: "front"|"back"|"base"|null,
 *                                        rotate180?: boolean, inset?: {top,
 *                                        right,bottom,left} px the host's own
 *                                        overlays cover}; contain only
 * @param {boolean}  [props.animate=true] tween view changes (false for
 *                                        prefers-reduced-motion)
 * @param {boolean}  [props.interactive=true] false: nothing can be selected,
 *                                        dragged or transformed
 * @param {boolean}  [props.gestures=false] two-finger pinch/twist/pan of the
 *                                        selected element
 * @param {string}   [props.touchAction="pan-y"] the container's touch-action
 * @param {number}   [props.anchorSize]  transformer anchor px (default 18);
 *                                        passing it also rounds the anchors
 * @param {number}   [props.anchorPadding=0] transformer padding px
 * @param {number}   [props.anchorHitSize] px a finger can hit an anchor
 *                                        within, when larger than the anchor
 *                                        drawn: small handles, finger-sized
 *                                        targets
 * @param {boolean}  [props.inlineTextEdit=true] false: double-tap doesn't open
 *                                        the canvas text editor
 * @param {function} [props.onManipulate] ("drag"|"transform"|"pinch") at the
 *                                        start of each manipulation
 * @param {function} [props.onSnap]      () when a snap engages
 *
 * v1.6.0, both opt-in (the defaults are v1.5.0's behaviour):
 * @param {null|"solid"|"ghost"} [props.magnet=null] draw the magnet strip on
 *                                        the back panel; ghost is see-through.
 *                                        Never in a proof
 * @param {boolean}  [props.animateResize=false] contain only: a resize under
 *                                        an unchanged view tweens the camera
 *                                        too (still instant without `animate`)
 *
 * Imperative handle: `beginTextEdit(id)`, `exportProof() → Promise<Blob>`,
 * `hint(id, {reducedMotion}) → Promise<void>`.
 */
const DesignStage = forwardRef(function DesignStage(
  {
    state,
    dispatch,
    logoSources,
    patternSrc,
    onReadyChange,
    fontVersion = 0,
    dieId,
    accent = DEFAULT_ACCENT,
    snapThreshold = DEFAULT_SNAP_THRESHOLD,
    classNames = {},
    // v1.5.0. Every default is what v1.4.1 did.
    fit = "width",
    view = DEFAULT_VIEW,
    animate = true,
    interactive = true,
    gestures = false,
    touchAction = "pan-y",
    anchorSize,
    anchorPadding = 0,
    anchorHitSize,
    inlineTextEdit = true,
    onManipulate,
    onSnap,
    // v1.6.0. Every default is what v1.5.0 did.
    magnet = null,
    animateResize = false,
  },
  ref,
) {
  const containerRef = useRef(null);
  const stageRef = useRef(null);
  const trRef = useRef(null);
  const artLayerRef = useRef(null);
  const overlayLayerRef = useRef(null);
  const dieLineRef = useRef(null);
  const magnetRef = useRef(null);
  const uiLayerRef = useRef(null);
  const patternRef = useRef(null);
  const exportingRef = useRef(false);
  const readiness = useMemo(() => createImageReadiness(), []);
  const reportImage = useMemo(() => (id, src, status) => readiness.report(id, src, status), [readiness]);
  const nodesRef = useRef(new Map());
  // The container as measured. In width mode `height` is pinned to 0: the die
  // decides the height there, so a height change must not re-render anything.
  const [box, setBox] = useState(EMPTY_BOX);
  // Snap guides, in display px — null when that axis isn't snapped.
  const [guides, setGuides] = useState(NO_SNAP);
  const [editingId, setEditingId] = useState(null);
  const [liveRotation, setLiveRotation] = useState(null); // degrees while transforming, else null

  // v1.5.0 machinery. All refs, because none of it may cause a React render:
  // a tween writes Konva attrs sixty times a second, and the export keys its
  // revision to React state (a render mid-export aborts the proof).
  const cameraTweenRef = useRef(null); // the running Konva.Tween, if any
  const appliedCameraRef = useRef(null); // {layer, viewKey, dieId, displayW} last written
  const hintRef = useRef(null); // the running sway, if any
  const pinchRef = useRef(null); // the gesture in progress, if any
  const multiTouchRef = useRef(false); // a second finger has been down since the last all-up
  const snapRef = useRef(NO_SNAP); // what the current drag is snapped to, for onSnap
  const latestRef = useRef(null); // this render's values, for native listeners

  // `dieId ?? state.size` — the prop wins so a picker can preview another die,
  // and the document is the fallback so a stage rendered with no prop still
  // draws what was stored.
  const die = resolveDie(dieId ?? state.size);
  const native = die.stage;
  const geom = dieGeometry(die);
  const contain = fit === "contain";
  // Width mode: the container's width IS the die's. Contain: the die fits
  // inside the box, and the Konva stage fills the box around it.
  const displayW = contain ? containDisplayWidth(box, native) : box.width;
  const aspect = native.height / native.width;
  const displayH = displayW * aspect;
  // Native stage px → display px. Everything the die draws goes through this.
  const scale = displayW / native.width;

  // The camera. Only contain mode has one; width mode never moves a layer.
  // `focusRects` is memoized on `geom`, which dieGeometry caches per die, so a
  // rect keeps its identity and the camera only recomputes on a real change.
  const focus = view?.focus ?? null;
  const rotate180 = !!view?.rotate180;
  // Keyed by value, not identity: hosts pass a fresh object every render.
  const insetKey = view?.inset
    ? [view.inset.top, view.inset.right, view.inset.bottom, view.inset.left].map((n) => Number(n) || 0).join(",")
    : "";
  const inset = useMemo(() => {
    if (!insetKey) return undefined;
    const [top, right, bottom, left] = insetKey.split(",").map(Number);
    return { top, right, bottom, left };
  }, [insetKey]);
  const rects = useMemo(() => focusRects(geom), [geom]);
  const focusRect =
    contain && focus && Object.prototype.hasOwnProperty.call(rects, focus) ? rects[focus] : null;
  const camera = useMemo(
    () =>
      contain && displayW > 0
        ? cameraFor({
            rect: focusRect,
            native,
            displayW,
            viewport: box,
            rotate: focusRect && rotate180 ? 180 : 0,
            inset,
          })
        : null,
    [contain, displayW, box, focusRect, native, rotate180, inset],
  );
  // What "upright" means on screen right now: 180 while the back panel is
  // shown turned over. The rotation badge reads relative to it.
  const viewRotation = camera ? camera.rotation : 0;
  const cameraScale = camera ? camera.scaleX : 1;

  const editingEl =
    state.elements.find((el) => el.id === editingId && el.type === "text") || null;

  // Drop a stale editing id if the element was deleted out from under it.
  useEffect(() => {
    if (editingId && !editingEl) setEditingId(null);
  }, [editingId, editingEl]);

  const [patternImg, patternStatus] = useImage(patternSrc || null);

  useLayoutEffect(() => {
    readiness.mount();
    return () => readiness.unmount();
  }, [readiness]);

  useLayoutEffect(() => {
    const entries = state.elements.filter((el) => el.type === "logo")
      .map((el) => [`logo:${el.id}`, logoSources[el.id]]);
    if (patternSrc) entries.push(["pattern", patternSrc]);
    // In contain mode the display size is left out of the content key: a phone
    // resizes its canvas box all the time (the on-screen keyboard closing as
    // the customer taps Checkout), and the proof does not depend on it, since
    // the contain export reads the live layout at capture time (below). Width
    // mode keeps v1.4.1's key exactly.
    readiness.commit(entries, displayW > 0 && !!stageRef.current,
      JSON.stringify([state, contain ? 0 : displayW, native.width, native.height, fontVersion]));
  }, [readiness, state, logoSources, patternSrc, displayW, native.width, native.height, fontVersion]);

  useLayoutEffect(() => {
    if (patternSrc) reportImage("pattern", patternSrc,
      patternImg && patternRef.current?.fillPatternImage() === patternImg ? "loaded" : patternStatus === "failed" ? "failed" : "loading");
  }, [reportImage, patternSrc, patternImg, patternStatus, displayW]);

  useLayoutEffect(() => {
    let previous;
    let previousError;
    const report = () => {
      const status = readiness.status();
      const ready = status === "ready";
      const error = status === "failed" ? "Artwork could not be loaded. Please upload it again." : null;
      if (ready !== previous || error !== previousError) {
        previous = ready;
        previousError = error;
        onReadyChange?.(ready, error);
      }
    };
    const unsubscribe = readiness.subscribe(report);
    report();
    return unsubscribe;
  }, [readiness, onReadyChange]);

  // Measured, not computed: the container is fluid, and the die's aspect decides
  // the height. Re-measured when the die changes too — that resizes the
  // container from outside, and on a backgrounded tab the ResizeObserver won't
  // have delivered a callback yet.
  //
  // Contain mode measures the height as well: the host gives the box a definite
  // height (a flex child at `height: 100%`) and the die fits inside it.
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return undefined;
    const measure = () => {
      const width = el.clientWidth;
      const height = contain ? el.clientHeight : 0;
      setBox((prev) => (prev.width === width && prev.height === height ? prev : { width, height }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [native.width, native.height, contain]);

  // Native listeners (gestures) read this render's values from here rather
  // than closing over a stale render.
  useLayoutEffect(() => {
    latestRef.current = {
      state,
      dispatch,
      interactive,
      editingId,
      displayW,
      displayH,
      viewRotation,
      onManipulate,
      onSnap,
    };
  });

  const registerNode = useMemo(
    () => (id, node) => {
      if (node) nodesRef.current.set(id, node);
      else nodesRef.current.delete(id);
      // A logo's node registers only once its bitmap has loaded, which is
      // usually AFTER the transformer effect below has already run for the new
      // selection and found nothing to attach to. Attach it late, here, or a
      // freshly added logo sits selected with no handles until something else
      // re-renders the stage.
      const tr = trRef.current;
      const L = latestRef.current;
      if (node && tr && L && L.interactive && L.state.selectedId === id && L.editingId !== id) {
        tr.nodes([node]);
        tr.getLayer()?.batchDraw();
      }
    },
    [],
  );

  // The die's own centre lines. Derived in core/ rather than here so it is
  // testable with no DOM — tests/dies.test.js pins the result against the three
  // expressions the storefront hardcoded.
  const targets = useMemo(() => snapTargets(geom), [geom]);

  // The magnet strip, native px, or null for a die with no back panel. Memoized
  // on `geom` for the same reason as the targets.
  const magnetBox = useMemo(() => magnetRect(geom), [geom]);
  const showMagnet = (magnet === "solid" || magnet === "ghost") && !!magnetBox;

  // Attach the transformer to the selected element node (hidden while a text
  // element is being edited inline, and absent when the host has made the
  // stage non-interactive — selection itself is left alone).
  useEffect(() => {
    const tr = trRef.current;
    if (!tr) return;
    const node =
      interactive && state.selectedId && state.selectedId !== editingId
        ? nodesRef.current.get(state.selectedId)
        : null;
    tr.nodes(node ? [node] : []);
    tr.getLayer()?.batchDraw();
  }, [state.selectedId, state.elements, displayW, fontVersion, editingId, interactive]);

  // ---- Hint ---------------------------------------------------------------
  // Stop the sway, and put the node back. `restoreX` defaults to where the
  // node was when the sway began; `null` skips the restore (node gone).
  const stopHint = useMemo(
    () => (restoreX) => {
      const h = hintRef.current;
      if (!h) return;
      hintRef.current = null;
      h.tween?.destroy();
      const x = restoreX === undefined ? h.x0 : restoreX;
      if (x !== null && h.node.getStage()) {
        h.node.x(x);
        h.node.getLayer()?.batchDraw();
      }
      h.resolve();
    },
    [],
  );

  // A touch or click anywhere on the stage ends a sway BEFORE Konva sees it.
  // Capture phase on the container runs ahead of Konva's own listeners on its
  // content div, so a drag that starts on a swaying node measures its grab
  // offset from the node's real position, not from mid-sway. Passive: it never
  // cancels anything, so it costs scrolling nothing.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return undefined;
    const stop = () => stopHint();
    const opts = { capture: true, passive: true };
    const types = ["pointerdown", "mousedown", "touchstart"];
    for (const type of types) el.addEventListener(type, stop, opts);
    return () => {
      for (const type of types) el.removeEventListener(type, stop, opts);
    };
  }, [stopHint]);

  // If the document moves the element while it sways (undo, a host nudge),
  // the sway must not put back a position that is no longer true. React has
  // already written the new x; settle on it.
  useLayoutEffect(() => {
    const h = hintRef.current;
    if (!h) return;
    const el = state.elements.find((e) => e.id === h.id);
    stopHint(el ? el.x * displayW : null);
  }, [state.elements, displayW, stopHint]);

  // ---- Camera -------------------------------------------------------------
  const stopCameraTween = useMemo(
    () => (finish = false) => {
      const tween = cameraTweenRef.current;
      if (!tween) return;
      // Finishing runs the tween's own onFinish, which writes the exact target
      // and destroys it. Konva's Tween.destroy is not safe to call twice.
      if (finish) {
        tween.finish();
        return;
      }
      cameraTweenRef.current = null;
      tween.destroy();
    },
    [],
  );

  // Applied in a layout effect, imperatively, to all three layers — never as
  // Layer props. react-konva writes a prop's FINAL value the moment it changes,
  // which would snap the layers to the target mid-tween and fight the tween for
  // every frame of it. As refs, the layers are only ever written here, by the
  // tween, and by the export (which puts them back).
  //
  // The key is the EFFECTIVE view: a view change tweens; a resize, a die swap
  // or the first layout sets the camera at once, because there is nothing on
  // screen yet (or nothing that moved) for a tween to start from. v1.6.0's
  // `animateResize` makes a resize under the same die tween as well.
  const viewKey = `${focusRect ? focus : ""}|${viewRotation}|${insetKey}`;
  useLayoutEffect(() => {
    const layers = [artLayerRef.current, overlayLayerRef.current, uiLayerRef.current];
    const art = layers[0];
    const applied = appliedCameraRef.current;
    if (!camera) {
      // Width mode never transforms a layer. The one write it can make is
      // undoing a camera this stage applied before a host switched fit back.
      if (applied && art && applied.layer === art) {
        stopCameraTween();
        setCamera(layers.filter(Boolean), IDENTITY_CAMERA);
      }
      appliedCameraRef.current = null;
      return;
    }
    if (layers.some((layer) => !layer)) return;
    // A new Konva stage (the placeholder came back in between) starts from
    // identity, so it is a first layout even if a camera was applied before.
    const sameStage = applied && applied.layer === art;
    const viewChanged = sameStage && applied.viewKey !== viewKey;
    // v1.6.0, opt-in: the box changed size under the same die (a host panel
    // growing or shrinking below the canvas), so glide from where the die is
    // to its new fit. Never across a die swap: the die changed shape then, so
    // there is no "where it was" to start from.
    const glide = animateResize && sameStage && applied.dieId === die.id;
    appliedCameraRef.current = { layer: art, viewKey, dieId: die.id, displayW };
    // Interrupt rather than finish: the next tween starts from wherever the
    // layers are now, so a quick second tap retargets instead of jumping.
    stopCameraTween();
    if (!(animate && (viewChanged || glide))) {
      setCamera(layers, camera);
      return;
    }
    if (glide && applied.displayW > 0 && applied.displayW !== displayW) {
      // React has already laid every node out at the NEW display width, while
      // the layers still hold the old camera, so the first frame would jump by
      // the ratio. Start instead from the camera that puts the new layout
      // exactly where the old one was on screen: scale times old/new, offsets
      // times new/old, the same viewport point and turn. (The Konva stage's
      // origin is the container's top-left either way.) Nothing has painted
      // yet, since Konva draws on the next animation frame, so it never shows.
      const r = applied.displayW / displayW;
      const now = readCamera(art);
      setCamera(layers, {
        ...now,
        scaleX: now.scaleX * r,
        scaleY: now.scaleY * r,
        offsetX: now.offsetX / r,
        offsetY: now.offsetY / r,
      });
    }
    const [, ...followers] = layers;
    // ONE tween, on the artwork layer, mirrored to the other two every frame,
    // so the die-line can never be a frame (or a millisecond of easing) off
    // the artwork it outlines. All three draw in the same animation frame:
    // Konva queues every batchDraw onto one requestAnimationFrame.
    const tween = new Konva.Tween({
      node: art,
      duration: CAMERA_TWEEN_SECONDS,
      easing: Konva.Easings.StrongEaseOut,
      ...camera,
      onFinish: () => {
        if (cameraTweenRef.current !== tween) return;
        cameraTweenRef.current = null;
        // start + diff × 1 is not always the target to the last bit; land on it.
        setCamera(layers, camera);
        tween.destroy();
      },
    });
    // Assigned rather than passed in the config: Konva tweens every config key
    // it doesn't blacklist, and `onUpdate` isn't on its list.
    tween.onUpdate = () => {
      const now = readCamera(art);
      for (const layer of followers) {
        layer.setAttrs(now);
        layer.batchDraw();
      }
    };
    cameraTweenRef.current = tween;
    tween.play();
    // `animate` (and `animateResize`, `die`, `displayW`, all of which reach the
    // effect through `camera`) are read, not depended on: switching motion off
    // mid-session must not re-run (or re-tween) the camera.
  }, [camera, viewKey, stopCameraTween]);

  // Nothing of ours may outlive the stage.
  useEffect(
    () => () => {
      stopCameraTween();
      stopHint(null);
    },
    [stopCameraTween, stopHint],
  );

  // ---- Gestures -----------------------------------------------------------
  // Two fingers scale, twist and pan the SELECTED element, wherever they land
  // on the stage. Raw container touch events rather than Konva's: Konva's stage
  // touchmove is suppressed while a node drags (unless hitOnDragEnabled), and
  // the first finger is very often dragging when the second lands.
  //
  // Listeners are on the container, so for every touch Konva's own handlers
  // (on its content div, a child) have already run by the time these do.
  useEffect(() => {
    const el = containerRef.current;
    if (!gestures || !el) return undefined;

    const begin = (evt) => {
      if (evt.touches.length < 2) return;
      multiTouchRef.current = true;
      if (pinchRef.current) return;
      const L = latestRef.current;
      if (!L?.interactive) return;
      const id = L.state.selectedId;
      const element = id && id !== L.editingId ? L.state.elements.find((e) => e.id === id) : null;
      const node = element ? nodesRef.current.get(id) : null;
      const stage = stageRef.current;
      if (!node || !node.getStage() || !stage) return;
      const [a, b] = [evt.touches[0], evt.touches[1]];
      const dist0 = Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY);
      if (!(dist0 > 0)) return;
      stopHint();

      // Konva's own CSS-scale correction (Stage._getContentPosition), so a
      // finger's travel in client px becomes the same travel in stage px.
      const content = stage.getContent();
      const contentWidth = content.clientWidth;
      const cssScale = (contentWidth && content.getBoundingClientRect().width / contentWidth) || 1;

      const g = {
        id,
        type: element.type,
        node,
        a: a.identifier,
        b: b.identifier,
        dist0,
        angle: Math.atan2(b.clientY - a.clientY, b.clientX - a.clientX),
        turn: 0, // radians, unwrapped across ±π
        mid0: { x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 },
        cssScale,
        key: `pinch-${Date.now()}`,
        moved: false, // the pinch itself changed the node
        dragged: false, // a drag it interrupted had moved the node
        transformed: false, // a transform it interrupted had changed the node
        snapped: false, // seeded from the start rotation below
        disabled: [],
      };
      // Set BEFORE stopping anything, so the dragend / transformend those stops
      // fire synchronously can see that this gesture will commit for them.
      pinchRef.current = g;

      // draggable(false) is how Konva cancels a drag (Node._dragChange): a drag
      // that hasn't started yet is dropped silently, and an active one is
      // stopped. Every element, not just this one — a second finger that landed
      // on another element has just armed a drag on it. Restored on end.
      for (const n of nodesRef.current.values()) {
        if (n.draggable()) {
          n.draggable(false);
          g.disabled.push(n);
        }
      }
      // A finger on a transformer anchor: the transformer would keep following
      // the FIRST touch, so hand the element to the pinch instead.
      const tr = trRef.current;
      if (tr?.isTransforming()) tr.stopTransform();

      g.x0 = node.x();
      g.y0 = node.y();
      g.s0 = node.scaleX();
      g.r0 = node.rotation();
      // An element that starts square is already snapped: onSnap is for a
      // twist ARRIVING at a right angle, not for every pinch of an upright one.
      g.snapped = Math.abs(((g.r0 % 90) + 90) % 90 - 45) >= 45 - PINCH_ROTATION_SNAP;
      if (evt.cancelable) evt.preventDefault();
      L.onManipulate?.("pinch");
    };

    const move = (evt) => {
      const g = pinchRef.current;
      if (!g) return;
      const a = touchById(evt.touches, g.a);
      const b = touchById(evt.touches, g.b);
      if (!a || !b) return;
      if (evt.cancelable) evt.preventDefault();
      const { node } = g;
      const layer = node.getLayer();
      if (!layer) return;
      const L = latestRef.current;
      // The camera as it is THIS frame (it may be mid-tween), from the layer.
      const k = layer.scaleX() || 1;
      const theta = (layer.rotation() * Math.PI) / 180;

      // Scale: the finger spread, clamped without ever forcing a jump — the
      // floor never exceeds, and the ceiling never undercuts, where it began.
      const w = node.width();
      const h = node.height();
      let s = (g.s0 * Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY)) / g.dist0;
      const minSide = Math.min(w, h);
      if (minSide > 0) s = Math.max(s, Math.min(MIN_DISPLAYED_PX / (minSide * k), g.s0));
      if (g.type === "logo" && w > 0) {
        s = Math.min(s, Math.max((MAX_LOGO_WIDTH_OF_STAGE * L.displayW) / w, g.s0));
      }

      // Twist: accumulate per-move deltas so crossing ±180° doesn't flip it.
      const angle = Math.atan2(b.clientY - a.clientY, b.clientX - a.clientX);
      let step = angle - g.angle;
      if (step > Math.PI) step -= 2 * Math.PI;
      else if (step < -Math.PI) step += 2 * Math.PI;
      g.turn += step;
      g.angle = angle;
      let rotation = g.r0 + (g.turn * 180) / Math.PI;
      const m = ((rotation % 360) + 360) % 360;
      const nearest = Math.round(m / 90) * 90;
      const snapped = Math.abs(m - nearest) <= PINCH_ROTATION_SNAP;
      if (snapped) rotation += nearest - m;
      if (snapped && !g.snapped) L.onSnap?.();
      g.snapped = snapped;

      // Pan: the midpoint's travel, screen px → layer coords. Divide by the
      // camera's scale and turn by minus its rotation (under the back view,
      // fingers moving right move the element left in the die's own frame).
      const sx = ((a.clientX + b.clientX) / 2 - g.mid0.x) / g.cssScale;
      const sy = ((a.clientY + b.clientY) / 2 - g.mid0.y) / g.cssScale;
      const cos = Math.cos(theta);
      const sin = Math.sin(theta);
      node.setAttrs({
        x: g.x0 + (cos * sx + sin * sy) / k,
        y: g.y0 + (-sin * sx + cos * sy) / k,
        scaleX: s,
        scaleY: s,
        rotation,
      });
      g.moved = true;
      // The transformer skips its own update while it believes it is dragging
      // (it proxies the node's drag), so push it.
      const tr = trRef.current;
      tr?.forceUpdate();
      layer.batchDraw();
      tr?.getLayer()?.batchDraw();
      setLiveRotation(badgeAngle(rotation, L.viewRotation));
    };

    // Bake exactly as handleTransformEnd does, and commit ONE step.
    const commit = (g) => {
      const L = latestRef.current;
      for (const n of g.disabled) if (n.getStage()) n.draggable(!!L.interactive);
      setLiveRotation(null);
      const { node } = g;
      const element = L.state.elements.find((e) => e.id === g.id);
      if (!element || !node.getStage()) return;
      // A two-finger tap changed nothing, and an undo step that undoes
      // nothing is worse than none.
      if (!g.moved && !g.dragged && !g.transformed) return;
      const patch = { x: node.x() / L.displayW, y: node.y() / L.displayH };
      if (g.moved || g.transformed) {
        const scaleX = node.scaleX();
        node.scaleX(1);
        node.scaleY(1);
        if (element.type === "logo") patch.scale = (node.width() * scaleX) / L.displayW;
        else patch.fontScale = (node.fontSize() * scaleX) / L.displayW;
        patch.rotation = wrap180(node.rotation());
      }
      L.dispatch({ type: "UPDATE_ELEMENT", id: g.id, patch, coalesceKey: g.key });
    };

    const end = (evt) => {
      const g = pinchRef.current;
      if (
        g &&
        (evt.type === "touchcancel" || !touchById(evt.touches, g.a) || !touchById(evt.touches, g.b))
      ) {
        pinchRef.current = null;
        commit(g);
      }
      // Cleared only when every finger is up, and only here — after Konva has
      // fired the tap/dbltap this same touchend produces, which the select and
      // edit handlers must still ignore.
      if (evt.touches.length === 0) multiTouchRef.current = false;
    };

    const active = { passive: false };
    el.addEventListener("touchstart", begin, active);
    el.addEventListener("touchmove", move, active);
    el.addEventListener("touchend", end);
    el.addEventListener("touchcancel", end);
    return () => {
      el.removeEventListener("touchstart", begin, active);
      el.removeEventListener("touchmove", move, active);
      el.removeEventListener("touchend", end);
      el.removeEventListener("touchcancel", end);
      // Torn down mid-gesture (gestures switched off, or unmount): commit what
      // the fingers did rather than strand the node mid-pinch and undraggable.
      const g = pinchRef.current;
      pinchRef.current = null;
      multiTouchRef.current = false;
      if (g) commit(g);
    };
  }, [gestures, stopHint]);

  /** A second finger is (or has been, this touch) down — gestures only. */
  const isMultiTouch = (e) =>
    gestures && (multiTouchRef.current || (e?.evt?.touches?.length ?? 0) > 1);

  // Snap distance in display px. Constant on SCREEN: under a camera zoomed by
  // k, k display px are one screen px. In width mode cameraScale is 1 and this
  // is v1.4.1's number.
  const snapDistance = () => (snapThreshold * scale) / cameraScale;

  function handleDragStart(e) {
    stopHint();
    // A drag that begins ON a guide is already snapped there. Seeding that
    // means onSnap reports a snap engaging, not the first move of every
    // element that was placed on a centre line (which is where adds land).
    // Konva fires dragstart before it moves the node, so this is the start.
    const node = e.target;
    const snap = snapDistance();
    const on = (v, list) => list.some((t) => Math.abs(v - t * scale) < snap);
    snapRef.current = {
      x: on(node.x(), targets.x) ? node.x() : null,
      y: on(node.y(), targets.y) ? node.y() : null,
    };
    onManipulate?.("drag");
  }

  function handleDragMove(e) {
    const node = e.target;
    const snap = snapDistance();

    let x = null;
    for (const target of targets.x) {
      const t = target * scale;
      if (Math.abs(node.x() - t) < snap) {
        node.x(t);
        x = t;
        break;
      }
    }
    let y = null;
    for (const target of targets.y) {
      const t = target * scale;
      if (Math.abs(node.y() - t) < snap) {
        node.y(t);
        y = t;
        break;
      }
    }
    // Engage, not hold: once per transition into a snap on either axis.
    const was = snapRef.current;
    if ((x !== null && was.x === null) || (y !== null && was.y === null)) onSnap?.();
    snapRef.current = x === null && y === null ? NO_SNAP : { x, y };
    if (x !== guides.x || y !== guides.y) setGuides({ x, y });
  }

  function handleDragEnd(e, el) {
    setGuides({ x: null, y: null });
    snapRef.current = NO_SNAP;
    // A pinch that lands mid-drag stops the drag, and Konva reports that stop
    // as a dragend. The pinch commits the position itself, so the drag and
    // the pinch are one undo step rather than two.
    const g = pinchRef.current;
    if (g && g.node === e.target) {
      g.dragged = true;
      return;
    }
    const node = e.target;
    dispatch({
      type: "UPDATE_ELEMENT",
      id: el.id,
      patch: { x: node.x() / displayW, y: node.y() / displayH },
    });
  }

  function handleTransformStart() {
    stopHint();
    onManipulate?.("transform");
  }

  // Live readout while the transformer handles are being dragged, so the user
  // can see the exact angle. Relative to the view: an element on the back
  // panel turned to read upright in the back view reads 0°, not 180°.
  function handleTransform(e) {
    setLiveRotation(badgeAngle(e.target.rotation(), viewRotation));
  }

  function handleTransformEnd(e, el) {
    setLiveRotation(null);
    const node = e.target;
    // As in handleDragEnd: a pinch that took over from an anchor commits for
    // it, scale and all (it reads the node's scale where the anchor left it).
    const g = pinchRef.current;
    if (g && g.node === node) {
      g.transformed = true;
      return;
    }
    const scaleX = node.scaleX();
    // Bake the scale into the element's own size and reset the node's, so the
    // document only ever stores one representation of "how big".
    node.scaleX(1);
    node.scaleY(1);
    if (el.type === "logo") {
      const newWidthPx = node.width() * scaleX;
      dispatch({
        type: "UPDATE_ELEMENT",
        id: el.id,
        patch: {
          x: node.x() / displayW,
          y: node.y() / displayH,
          scale: newWidthPx / displayW,
          rotation: node.rotation(),
        },
      });
    } else {
      const newFontSize = node.fontSize() * scaleX;
      dispatch({
        type: "UPDATE_ELEMENT",
        id: el.id,
        patch: {
          x: node.x() / displayW,
          y: node.y() / displayH,
          fontScale: newFontSize / displayW,
          rotation: node.rotation(),
        },
      });
    }
  }

  useImperativeHandle(ref, () => ({
    beginTextEdit(id) {
      setEditingId(id);
    },
    // A non-committing "you can move this": the node slides 6 screen px each
    // way and back to exactly where it was. Nothing is dispatched, so nothing
    // reaches the document, the undo stack or a proof. Any touch or click on
    // the stage ends it first (see the capture listener above).
    hint(id, { reducedMotion = false } = {}) {
      stopHint(); // one at a time
      const node = nodesRef.current.get(id);
      if (reducedMotion || !node || !node.getLayer()) return Promise.resolve();
      // Never sway something a finger is already holding.
      if (node.isDragging() || trRef.current?.isTransforming() || pinchRef.current) {
        return Promise.resolve();
      }
      const d = HINT_SCREEN_PX / cameraScale;
      const x0 = node.x();
      return new Promise((resolve) => {
        const h = { id, node, x0, tween: null, resolve };
        hintRef.current = h;
        const segment = (to, then) => {
          h.tween?.destroy();
          h.tween = new Konva.Tween({
            node,
            x: to,
            duration: HINT_SEGMENT_SECONDS,
            easing: Konva.Easings.EaseInOut,
            onFinish: () => {
              if (hintRef.current === h) then();
            },
          });
          h.tween.play();
        };
        // The last segment ends ON x0, and stopHint then writes x0 exactly.
        segment(x0 + d, () => segment(x0 - d, () => segment(x0, () => stopHint())));
      });
    },
    async exportProof() {
      if (exportingRef.current) throw new Error("A proof is already being generated.");
      exportingRef.current = true;
      const requestedRevision = readiness.revision;
      let uiLayer;
      let wasVisible;
      try {
        // Closing the editor restores the existing committed text node. The
        // host still owns committing its value before requesting a proof.
        if (editingId) {
          setEditingId(null);
          await new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error("The designer is not ready. Please try again.")), 15000);
            requestAnimationFrame(() => requestAnimationFrame(() => { clearTimeout(timer); resolve(); }));
          });
        }
        await readiness.wait();
        if (readiness.revision !== requestedRevision) {
          throw new Error("The design changed while preparing the proof. Please try again.");
        }
        const stage = stageRef.current;
        if (!stage) throw new Error("The designer is not ready. Please try again.");
        // Hide the entire UI layer synchronously, including snap guides. This
        // avoids relying on a React state update before the canvas snapshot.
        uiLayer = uiLayerRef.current;
        wasVisible = uiLayer?.visible();
        uiLayer?.hide();
        stage.draw();
        const pixelRatio = native.width / (displayW || native.width);
        // The proof itself, one synchronous toBlob draw.
        const captureDie = () => {
          if (!contain) return stage.toBlob({ pixelRatio, mimeType: "image/png" });
          // Contain mode: the proof is camera-independent — the whole die at
          // native resolution, exactly as width mode exports it. Land any
          // camera move, take the layers back to identity, export the die's
          // own rectangle (Stage._toKonvaCanvas takes x/y/width/height), and
          // put the camera back. All synchronous Konva attrs: toBlob renders
          // inside its own call (only PNG encoding is async), nothing here is
          // React state, and the batchDraws queued by the reset run after the
          // restore — so the screen never shows the identity frame.
          stopCameraTween(true);
          // The layout as it is NOW, not as it was when the export was asked
          // for: a resize while the artwork was loading has already re-laid
          // every node out at the new display width, so the proof must be
          // taken at that width (see the content key above).
          const liveW = latestRef.current?.displayW || displayW;
          const liveH = latestRef.current?.displayH || displayH;
          const livePixelRatio = native.width / liveW;
          const layers = [artLayerRef.current, overlayLayerRef.current, uiLayerRef.current]
            .filter(Boolean);
          const saved = layers.map(readCamera);
          for (const layer of layers) layer.setAttrs(IDENTITY_CAMERA);
          // The die line is a screen hairline (strokeScaleEnabled false), so a
          // proof draws it DIE_LINE_WIDTH × pixelRatio wide — and in contain
          // mode displayW can be tiny (a phone's checkout step shows the die
          // ~50px wide), which would print a 30px band over the artwork's
          // edges. Pin it to a fixed native width for the export instead.
          const dieLine = dieLineRef.current;
          const lineWidth = dieLine?.strokeWidth();
          dieLine?.strokeWidth(CONTAIN_PROOF_DIE_LINE_PX / livePixelRatio);
          try {
            return stage.toBlob({
              x: 0,
              y: 0,
              width: liveW,
              height: liveH,
              pixelRatio: livePixelRatio,
              mimeType: "image/png",
            });
          } finally {
            dieLine?.strokeWidth(lineWidth);
            layers.forEach((layer, i) => layer.setAttrs(saved[i]));
            for (const layer of layers) layer.batchDraw();
          }
        };
        const blob = await readiness.capture(() => {
          // A sway is not an edit; it must never reach a proof.
          stopHint();
          // Nor is the magnet: it is sewn on, not printed. Hidden for this
          // synchronous draw only (toBlob renders inside its own call), so the
          // screen never shows a frame without it.
          const magnetNode = magnetRef.current;
          const magnetShown = magnetNode?.visible();
          magnetNode?.hide();
          try {
            return captureDie();
          } finally {
            if (magnetNode) {
              magnetNode.visible(magnetShown);
              magnetNode.getLayer()?.batchDraw();
            }
          }
        });
        if (!blob) throw new Error("The proof could not be created. Please try again.");
        return blob;
      } finally {
        if (uiLayer && stageRef.current && uiLayer.getStage() === stageRef.current) {
          uiLayer.visible(wasVisible);
          uiLayer.draw();
        }
        exportingRef.current = false;
      }
    },
  }));

  function handleStageMouseDown(e) {
    // A host-driven stage leaves selection alone, and so does a second finger
    // landing on bare stage mid-pinch.
    if (!interactive || isMultiTouch(e)) return;
    if (e.target === e.target.getStage()) dispatch({ type: "CLEAR_SELECTION" });
  }

  // `anchorHitSize` widens each anchor's HIT region past what is drawn, via
  // the anchor's own hitStrokeWidth (a stroke of width w grows the hit shape
  // by w/2 a side), so a host can draw quiet 16px handles that still take a
  // 40px fingertip. Memoized: a new function every render would re-style the
  // anchors every render.
  const drawnAnchor = anchorSize ?? DEFAULT_ANCHOR_SIZE;
  const hitExtra = anchorHitSize > drawnAnchor ? anchorHitSize - drawnAnchor : 0;
  const anchorStyleFunc = useMemo(
    () => (hitExtra ? (anchor) => anchor.hitStrokeWidth(hitExtra) : undefined),
    [hitExtra],
  );

  // Reserve the right box before the first measurement, so the page doesn't jump
  // when the stage appears — and so Konva is never built at zero size. In
  // contain mode the host sized the box; fill it.
  if (displayW === 0) {
    return (
      <div
        ref={containerRef}
        className={classNames.root}
        style={
          contain
            ? { width: "100%", height: "100%" }
            : { width: "100%", aspectRatio: `${native.width} / ${native.height}` }
        }
      />
    );
  }

  // Fill for the silhouette, stroke for the die-line — one path, so the mask and
  // the outline can't drift apart.
  const drawDie = (ctx, shape) => {
    traceDie(ctx, geom, scale);
    ctx.fillStrokeShape(shape);
  };

  const nodeProps = {
    displayW,
    displayH,
    interactive,
    onSelect: (id, e) => {
      // Mid-pinch, a finger landing on another element must not switch the
      // element being pinched.
      if (!interactive || isMultiTouch(e)) return;
      dispatch({ type: "SELECT_ELEMENT", id });
    },
    onDragStart: handleDragStart,
    onDragMove: handleDragMove,
    onDragEnd: handleDragEnd,
    onTransformStart: handleTransformStart,
    onTransform: handleTransform,
    onTransformEnd: handleTransformEnd,
    registerNode,
    reportImage,
  };

  // Anchors: v1.4.1's 18px square unless the host sizes them, in which case
  // they are round (a phone host asks for bigger, finger-sized targets).
  // Spread only when given, so an unconfigured transformer carries exactly
  // v1.4.1's attrs.
  const anchorProps = {
    anchorSize: drawnAnchor,
    ...(anchorSize != null ? { anchorCornerRadius: anchorSize / 2 } : {}),
    ...(anchorPadding ? { padding: anchorPadding } : {}),
    ...(anchorStyleFunc ? { anchorStyleFunc } : {}),
  };

  // Bare stage clears the selection on touchstart, as v1.4.1 does — unless
  // gestures are on. Then the clear waits for the tap: the first finger of a
  // pinch often lands on bare stage (the strip a zoomed view shows beyond the
  // die frame), and clearing on touchdown would leave the second finger
  // nothing to pinch. A tap that had a second finger in it is ignored.
  const stageTouchProps = gestures
    ? { onTap: handleStageMouseDown }
    : { onTouchStart: handleStageMouseDown };

  return (
    // `touchAction: pan-y` keeps one-finger vertical page scrolling alive on
    // touch devices — the canvas fills most of a phone viewport, so "none" would
    // trap the user. Konva still preventDefaults during an active node drag.
    // (A full-screen host that owns the whole viewport passes "none".)
    <div
      ref={containerRef}
      className={classNames.root}
      style={
        contain
          ? {
              position: "relative",
              width: "100%",
              height: "100%",
              overflow: "hidden",
              userSelect: "none",
              touchAction,
            }
          : { position: "relative", width: "100%", userSelect: "none", touchAction }
      }
    >
      <Stage
        ref={stageRef}
        width={contain ? box.width : displayW}
        height={contain ? box.height : displayH}
        onMouseDown={handleStageMouseDown}
        {...stageTouchProps}
      >
        {/* Artwork layer — clipped to the silhouette */}
        <Layer ref={artLayerRef}>
          <Rect x={0} y={0} width={displayW} height={displayH} fill={state.color} />
          {patternImg && (
            <Rect
              x={0}
              y={0}
              width={displayW}
              height={displayH}
              ref={(node) => {
                patternRef.current = node;
                if (node) reportImage("pattern", patternSrc, "loaded");
              }}
              fillPatternImage={patternImg}
              fillPatternRepeat="repeat"
              fillPatternScale={{ x: scale, y: scale }}
            />
          )}

          {state.elements.map((el) =>
            el.type === "logo" ? (
              <LogoNode key={el.id} el={el} src={logoSources[el.id]} {...nodeProps} />
            ) : (
              <TextNode
                key={el.id}
                el={el}
                fontVersion={fontVersion}
                editing={el.id === editingId}
                onStartEdit={(id, e) => {
                  if (!inlineTextEdit || isMultiTouch(e)) return;
                  setEditingId(id);
                }}
                {...nodeProps}
              />
            ),
          )}

          {/* Clip everything above to the die: keep only what the shape covers. */}
          <Shape
            sceneFunc={drawDie}
            fill="#000"
            listening={false}
            globalCompositeOperation="destination-in"
          />
        </Layer>

        {/* Overlay layer — die-line outline. Not scaled with the camera's
            zoom: Konva resets the transform for the stroke, so it stays a
            DIE_LINE_WIDTH hairline on screen (and DIE_LINE_WIDTH × pixelRatio
            in a proof, as before). */}
        <Layer listening={false} ref={overlayLayerRef}>
          <Shape
            ref={dieLineRef}
            sceneFunc={drawDie}
            stroke={DIE_LINE_COLOR}
            strokeWidth={DIE_LINE_WIDTH}
            strokeScaleEnabled={false}
            opacity={DIE_LINE_OPACITY}
          />
          {showMagnet && (
            <MagnetStrip
              ref={magnetRef}
              box={magnetBox}
              scale={scale}
              opacity={magnet === "ghost" ? MAGNET_GHOST_OPACITY : 1}
            />
          )}
        </Layer>

        {/* UI layer — alignment guides + transform handles (not exported).
            The camera moves it too, so the guides land on the artwork; the
            transformer ignores its layer's transform by design (it overrides
            getAbsoluteTransform), so anchors keep their screen size. */}
        <Layer ref={uiLayerRef}>
          {guides.x !== null && (
            <Line
              points={[guides.x, 0, guides.x, displayH]}
              stroke={accent}
              strokeWidth={1}
              strokeScaleEnabled={false}
              dash={[6, 6]}
              listening={false}
            />
          )}
          {guides.y !== null && (
            <Line
              points={[0, guides.y, displayW, guides.y]}
              stroke={accent}
              strokeWidth={1}
              strokeScaleEnabled={false}
              dash={[6, 6]}
              listening={false}
            />
          )}
          <Transformer
            ref={trRef}
            keepRatio
            rotateEnabled
            rotationSnaps={[0, 45, 90, 135, 180, 225, 270, 315]}
            rotationSnapTolerance={8}
            {...anchorProps}
            anchorStrokeWidth={2}
            borderStroke={accent}
            anchorStroke={accent}
            enabledAnchors={["top-left", "top-right", "bottom-left", "bottom-right"]}
            boundBoxFunc={(oldBox, newBox) =>
              newBox.width < 16 || newBox.height < 16 ? oldBox : newBox
            }
          />
        </Layer>
      </Stage>

      {liveRotation !== null && (
        <div
          className={
            liveRotation % 90 === 0 ? classNames.rotationBadgeAligned : classNames.rotationBadge
          }
          style={{
            position: "absolute",
            left: "50%",
            top: 8,
            transform: "translateX(-50%)",
            pointerEvents: "none",
          }}
        >
          {liveRotation}°
        </div>
      )}

      {editingEl && (
        <InlineTextEditor
          key={editingEl.id}
          el={editingEl}
          displayW={displayW}
          displayH={displayH}
          camera={camera}
          viewportWidth={box.width}
          className={classNames.textEditor}
          onCommit={(text) => {
            setEditingId(null);
            if (text.trim() === "") {
              // Committing empty text would leave an invisible, unselectable
              // element — remove it instead.
              dispatch({ type: "DELETE_ELEMENT", id: editingEl.id });
            } else if (text !== editingEl.text) {
              dispatch({ type: "UPDATE_ELEMENT", id: editingEl.id, patch: { text } });
            }
          }}
          onCancel={() => setEditingId(null)}
        />
      )}
    </div>
  );
});

export default DesignStage;
