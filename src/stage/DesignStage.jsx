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

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Stage,
  Layer,
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
  dieGeometry,
  resolveDie,
  snapTargets,
  traceDie,
} from "../core/index.js";
import { useImage } from "./useImage.js";
import { createImageReadiness } from "./imageReadiness.js";

/** Snap distance to a guide, in NATIVE stage px. */
const DEFAULT_SNAP_THRESHOLD = 8;

/** The storefront's colour, so an unconfigured host is byte-identical to it. */
const DEFAULT_ACCENT = "#0a6b6b";

// Draggable logo image. node.x()/node.y() are the CENTRE (offset is half the
// size), so the stage's centre-snap logic is uniform across logos and text.
function LogoNode({
  el,
  src,
  displayW,
  displayH,
  onSelect,
  onDragMove,
  onDragEnd,
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
      draggable
      onMouseDown={() => onSelect(el.id)}
      onTouchStart={() => onSelect(el.id)}
      onTap={() => onSelect(el.id)}
      onClick={() => onSelect(el.id)}
      onDragMove={onDragMove}
      onDragEnd={(e) => onDragEnd(e, el)}
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
  onStartEdit,
  onSelect,
  onDragMove,
  onDragEnd,
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
      draggable
      onMouseDown={() => onSelect(el.id)}
      onTouchStart={() => onSelect(el.id)}
      onTap={() => onSelect(el.id)}
      onClick={() => onSelect(el.id)}
      onDblClick={() => onStartEdit(el.id)}
      onDblTap={() => onStartEdit(el.id)}
      onDragMove={onDragMove}
      onDragEnd={(e) => onDragEnd(e, el)}
      onTransform={onTransform}
      onTransformEnd={(e) => onTransformEnd(e, el)}
    />
  );
}

// Overlay <textarea> for editing a text element in place on the canvas.
// Positioned from the element's normalized transform (NOT the Konva node) so it
// can open on the same frame the element is created. Enter/blur commit, Escape
// cancels.
function InlineTextEditor({ el, displayW, displayH, className, onCommit, onCancel }) {
  const taRef = useRef(null);
  const doneRef = useRef(false); // Enter commits, then the unmount fires blur — settle once
  const fontSize = el.fontScale * displayW;
  const width = Math.min(displayW, Math.max(140, displayW * 0.8));

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
        left: el.x * displayW - width / 2,
        top: el.y * displayH - fontSize * 0.75,
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
 * Imperative handle: `beginTextEdit(id)`, `exportProof() → Promise<Blob>`.
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
  },
  ref,
) {
  const containerRef = useRef(null);
  const stageRef = useRef(null);
  const trRef = useRef(null);
  const uiLayerRef = useRef(null);
  const patternRef = useRef(null);
  const exportingRef = useRef(false);
  const readiness = useMemo(() => createImageReadiness(), []);
  const reportImage = useMemo(() => (id, src, status) => readiness.report(id, src, status), [readiness]);
  const nodesRef = useRef(new Map());
  const [displayW, setDisplayW] = useState(0);
  // Snap guides, in display px — null when that axis isn't snapped.
  const [guides, setGuides] = useState({ x: null, y: null });
  const [editingId, setEditingId] = useState(null);
  const [liveRotation, setLiveRotation] = useState(null); // degrees while transforming, else null

  // `dieId ?? state.size` — the prop wins so a picker can preview another die,
  // and the document is the fallback so a stage rendered with no prop still
  // draws what was stored.
  const die = resolveDie(dieId ?? state.size);
  const native = die.stage;
  const geom = dieGeometry(die);
  const aspect = native.height / native.width;
  const displayH = displayW * aspect;
  // Native stage px → display px. Everything the die draws goes through this.
  const scale = displayW / native.width;

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
    readiness.commit(entries, displayW > 0 && !!stageRef.current,
      JSON.stringify([state, displayW, native.width, native.height, fontVersion]));
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
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return undefined;
    const measure = () => setDisplayW(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [native.width, native.height]);

  const registerNode = useMemo(
    () => (id, node) => {
      if (node) nodesRef.current.set(id, node);
      else nodesRef.current.delete(id);
    },
    [],
  );

  // The die's own centre lines. Derived in core/ rather than here so it is
  // testable with no DOM — tests/dies.test.js pins the result against the three
  // expressions the storefront hardcoded.
  const targets = useMemo(() => snapTargets(geom), [geom]);

  // Attach the transformer to the selected element node (hidden while a text
  // element is being edited inline).
  useEffect(() => {
    const tr = trRef.current;
    if (!tr) return;
    const node =
      state.selectedId && state.selectedId !== editingId
        ? nodesRef.current.get(state.selectedId)
        : null;
    tr.nodes(node ? [node] : []);
    tr.getLayer()?.batchDraw();
  }, [state.selectedId, state.elements, displayW, fontVersion, editingId]);

  function handleDragMove(e) {
    const node = e.target;
    const snap = snapThreshold * scale;

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
    if (x !== guides.x || y !== guides.y) setGuides({ x, y });
  }

  function handleDragEnd(e, el) {
    setGuides({ x: null, y: null });
    const node = e.target;
    dispatch({
      type: "UPDATE_ELEMENT",
      id: el.id,
      patch: { x: node.x() / displayW, y: node.y() / displayH },
    });
  }

  // Live readout while the transformer handles are being dragged, so the user
  // can see the exact angle.
  function handleTransform(e) {
    const rot = ((Math.round(e.target.rotation()) % 360) + 360) % 360;
    setLiveRotation(rot);
  }

  function handleTransformEnd(e, el) {
    setLiveRotation(null);
    const node = e.target;
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
        const blob = await readiness.capture(() => stage.toBlob({ pixelRatio, mimeType: "image/png" }));
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
    if (e.target === e.target.getStage()) dispatch({ type: "CLEAR_SELECTION" });
  }

  // Reserve the right box before the first measurement, so the page doesn't jump
  // when the stage appears — and so Konva is never built at zero size.
  if (displayW === 0) {
    return (
      <div
        ref={containerRef}
        className={classNames.root}
        style={{ width: "100%", aspectRatio: `${native.width} / ${native.height}` }}
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
    onSelect: (id) => dispatch({ type: "SELECT_ELEMENT", id }),
    onDragMove: handleDragMove,
    onDragEnd: handleDragEnd,
    onTransform: handleTransform,
    onTransformEnd: handleTransformEnd,
    registerNode,
    reportImage,
  };

  return (
    // `touchAction: pan-y` keeps one-finger vertical page scrolling alive on
    // touch devices — the canvas fills most of a phone viewport, so "none" would
    // trap the user. Konva still preventDefaults during an active node drag.
    <div
      ref={containerRef}
      className={classNames.root}
      style={{ position: "relative", width: "100%", userSelect: "none", touchAction: "pan-y" }}
    >
      <Stage
        ref={stageRef}
        width={displayW}
        height={displayH}
        onMouseDown={handleStageMouseDown}
        onTouchStart={handleStageMouseDown}
      >
        {/* Artwork layer — clipped to the silhouette */}
        <Layer>
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
                onStartEdit={setEditingId}
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

        {/* Overlay layer — die-line outline */}
        <Layer listening={false}>
          <Shape
            sceneFunc={drawDie}
            stroke={DIE_LINE_COLOR}
            strokeWidth={DIE_LINE_WIDTH}
            opacity={DIE_LINE_OPACITY}
          />
        </Layer>

        {/* UI layer — alignment guides + transform handles (not exported) */}
        <Layer ref={uiLayerRef}>
          {guides.x !== null && (
            <Line
              points={[guides.x, 0, guides.x, displayH]}
              stroke={accent}
              strokeWidth={1}
              dash={[6, 6]}
              listening={false}
            />
          )}
          {guides.y !== null && (
            <Line
              points={[0, guides.y, displayW, guides.y]}
              stroke={accent}
              strokeWidth={1}
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
            anchorSize={18}
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
