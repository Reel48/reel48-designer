// Ported to @reel48/designer v1.15.0 from Reel48-Storefront src/components/storefront/hat/hat-edit.js (origin/main d78d90ee), its surface fetch held to the page's origin. Comments are the storefront's; imports point into this package.
//
/**
 * The on-hat editor's glue (round E1, 2026-10-21): what Hat3D does while a
 * spot is edited on the 3D hat itself, as plain functions over the modules
 * beside it, so tests/hat-edit.test.ts drives every one in node with a fake
 * model-viewer and a fake placer. The placement lab
 * (scripts/blender/hat-no7/lab/place-lab.js) is where each was proved; this
 * is that page's wiring, moved in, with the designer's document in place of
 * the lab's.
 *
 * - loadSurfaceJson: the surface file (hat-3d-assets SURFACE), fetched once a
 *   page, whoever asks.
 * - createProjector: the live camera as a 3x4 matrix, measured a frame after
 *   each camera change through one hidden hotspot (hat-surface
 *   measureProjection), measured again when a change lands while a
 *   measurement waits, rather than kept stale.
 * - createCameraAdapter and orbitWindow: the camera the placer turns when a
 *   finger drags bare fabric, held to a window round the spot's own view.
 * - fitSpot: each spot's view, zoomed so its AREA fills most of the editor.
 * - createLivePaint: a piece dragged on the hat repainted live (hat-look's
 *   buildSprite / beginLive / liveFrame / endLive), its last frame held
 *   until the host hands the committed art over.
 * - createEditSession: all of it on a <model-viewer> and its host, with the
 *   placer (hat-place createPlacer) for the gestures.
 *
 * It imports only the hat modules beside it, touches the DOM only through
 * what it is given, and names no file.
 */
import { measureProjection, probePointsFor } from "./hat-surface.js";
import { createPlacer } from "./hat-place.js";
import { areaHome, areaRings } from "../core/region.js";
import { pieceMatrix } from "./hat-look.js";
import { sameOrigin } from "./load-3d.js";

const RAD = Math.PI / 180;

/** How far the fabric turns the hat from a spot's own view, degrees either way: enough to see the curve, never so far the spot turns away. */
export const ORBIT_WINDOW = Object.freeze({ theta: 30, phi: 15 });
/** The inside label's, seen through the opening: tighter. */
export const LABEL_ORBIT_WINDOW = Object.freeze({ theta: 20, phi: 10 });
/** An editor narrower than this (CSS px) is a phone's. */
export const NARROW_PX = 600;
/** The texture resolution a phone's editor draws at (createHatLook textureScale). */
export const PHONE_TEXTURE_SCALE = 0.6;
/**
 * How much of the editor a spot's area fills once its view is reached: a
 * phone's narrow view otherwise shows the whole hat and a thumbnail of a
 * logo; a laptop's wide one keeps the hat round the spot in view.
 */
export const SPOT_FILL = Object.freeze({ narrow: Object.freeze({ w: 0.8, h: 0.6 }), wide: Object.freeze({ w: 0.5, h: 0.45 }) });
/** The nearest a fitted view comes, metres (the viewer's own floor is lower: Hat3D's min-camera-orbit). */
export const MIN_FIT_RADIUS = 0.12;
/** A projection this far off its own probes (screen px) is not the hat on screen. */
export const MAX_RESIDUAL_PX = 0.5;
/** Measurements in a row that may miss before editing on the hat gives up. */
export const MAX_BAD_MEASURES = 3;
/** The probe hotspot's slot; the host renders `<div slot="hotspot-probe" data-position="0m 0m 0m" hidden>`. */
export const PROBE_SLOT = "hotspot-probe";

/** The camera view a die zone is edited from: an outside spot's own, the inside label's for either label zone. */
export function spotOfZone(zone) {
  return String(zone).startsWith("label") ? "label" : zone;
}

/** An orbit as model-viewer's cameraOrbit string gives it back ("<theta>deg <phi>deg <r>m"): numbers, NaN where "auto". */
export function parseOrbit(orbit) {
  const [theta, phi, radius] = String(orbit ?? "").trim().split(/\s+/).map((s) => parseFloat(s));
  return { theta, phi, radius };
}

/** The orbit window (radians, [min, max] each) round a spot's view at theta, phi degrees. */
export function orbitWindow(spot, theta, phi) {
  const w = spot === "label" ? LABEL_ORBIT_WINDOW : ORBIT_WINDOW;
  return { theta: [(theta - w.theta) * RAD, (theta + w.theta) * RAD], phi: [(phi - w.phi) * RAD, (phi + w.phi) * RAD] };
}

/** What a spot's area should fill of an editor this wide. */
export function fillFor(width) {
  return width < NARROW_PX ? SPOT_FILL.narrow : SPOT_FILL.wide;
}

/**
 * The radius that makes `points` (an area's outline and home, on screen at
 * the radius the camera `had`) fill the editor as SPOT_FILL says: apparent
 * size goes as one over distance, so the radius scales by how far the area
 * overflows (or underfills) its share in the tighter direction.
 *
 * @param {{ had: number, points: number[][], width: number, height: number }} o
 */
export function fitRadius({ had, points, width, height }) {
  let k = 1;
  if (points.length >= 4 && width > 0 && height > 0) {
    const xs = points.map((p) => p[0]);
    const ys = points.map((p) => p[1]);
    const pw = Math.max(...xs) - Math.min(...xs);
    const ph = Math.max(...ys) - Math.min(...ys);
    const fill = fillFor(width);
    const need = Math.max(pw / (fill.w * width), ph / (fill.h * height));
    if (need > 0 && Number.isFinite(need)) k = need;
  }
  return Math.max(MIN_FIT_RADIUS, had * k);
}

/** An area's outline and home point, die px: what a spot fit measures on screen. */
export function areaFitPoints(area) {
  return [...(areaRings(area)[0] ?? []), areaHome(area)].filter(Boolean);
}

const frames = () => ({
  request: (cb) => requestAnimationFrame(cb),
  cancel: (id) => cancelAnimationFrame(id),
});

// ---- The surface file ----------------------------------------------------------------
const surfaceFiles = new Map();
/**
 * The surface JSON at `url`, fetched once a page however many editors ask
 * (a failed fetch is forgotten, so the next one tries again). The URL is the
 * host's, and must be on its own origin (package v1.15.0): anything else is
 * refused without a request.
 *
 * @param {string} url
 * @param {(url: string) => Promise<{ ok: boolean, status?: number, json: () => Promise<any> }>} [fetchImpl]
 */
export function loadSurfaceJson(url, fetchImpl = (u) => fetch(u)) {
  let p = surfaceFiles.get(url);
  if (!p) {
    p = Promise.resolve()
      .then(() => {
        if (!sameOrigin(url)) throw new Error(`${url}: not on this page's origin`);
        return fetchImpl(url);
      })
      .then((r) => {
        if (!r.ok) throw new Error(`${url}: ${r.status}`);
        return r.json();
      });
    p.catch(() => surfaceFiles.delete(url));
    surfaceFiles.set(url, p);
  }
  return p;
}

// ---- The camera, measured ----------------------------------------------------------------
/**
 * The live camera, measured a frame after it changes: model-viewer refreshes
 * its camera's matrices when a frame renders, after camera-change, so a probe
 * taken in that frame's own task reads the frame before. A change that lands
 * while a measurement waits (a jump made earlier in the same frame, before the
 * render) may be measured stale, so it is measured again a frame later rather
 * than dropped (place-lab.js reproject, 2026-10-21).
 *
 * @param {any} mv the <model-viewer>
 * @param {{ surface: { bounds: Function, dieToModel: Function, normal: Function }, zone: () => string,
 *   onMeasure: (res: { P: number[], residual: number } | null) => void,
 *   requestFrame?: (cb: () => void) => any, cancelFrame?: (id: any) => void }} opts
 */
export function createProjector(mv, { surface, zone, onMeasure, requestFrame, cancelFrame }) {
  const f = frames();
  const request = requestFrame ?? f.request;
  const cancel = cancelFrame ?? f.cancel;
  let pending = false;
  let id = null;
  let again = false;
  let stopped = false;
  function measure() {
    if (stopped) return;
    if (pending) {
      again = true;
      return;
    }
    pending = true;
    id = request(() => {
      pending = false;
      id = null;
      if (stopped) return;
      const rerun = again;
      again = false;
      onMeasure(measureProjection(mv, probePointsFor(surface, zone()), { name: PROBE_SLOT }));
      if (rerun) measure();
    });
  }
  return {
    request: measure,
    stop() {
      stopped = true;
      if (pending) cancel(id);
      pending = false;
      id = null;
    },
  };
}

const LENGTH_UNITS = { m: 1, cm: 0.01, mm: 0.001 };
/**
 * The radius the camera is headed for, metres: the goal's (the cameraOrbit
 * string last set; in an edit, the fit's or the last turn's), else where the
 * camera is. model-viewer's getCameraOrbit() is the camera as it is now,
 * eased part way to its goal, so a turn that kept that radius mid-flight
 * stopped the fit's zoom part way.
 */
export function goalRadius(mv) {
  const token = String(mv.cameraOrbit ?? "").trim().split(/\s+/)[2] ?? "";
  const m = /^([0-9]*\.?[0-9]+(?:e[-+]?[0-9]+)?)(m|cm|mm)$/i.exec(token);
  const r = m ? parseFloat(m[1]) * LENGTH_UNITS[m[2].toLowerCase()] : NaN;
  return Number.isFinite(r) && r > 0 ? r : mv.getCameraOrbit().radius;
}

/**
 * The camera as the placer turns it (a drag on bare fabric, the keys): the
 * orbit's angles in radians, the radius left at the goal the fit set (not
 * where a flight to it has got to), held in the window `getWindow` gives.
 *
 * @param {any} mv
 * @param {() => { theta: number[], phi: number[] }} getWindow
 */
export function createCameraAdapter(mv, getWindow) {
  return {
    getOrbit() {
      const o = mv.getCameraOrbit();
      return { theta: o.theta, phi: o.phi };
    },
    setOrbit({ theta, phi }) {
      mv.cameraOrbit = `${theta}rad ${phi}rad ${goalRadius(mv)}m`;
    },
    get window() {
      return getWindow();
    },
    onMove(cb) {
      mv.addEventListener("camera-change", cb);
      return () => mv.removeEventListener("camera-change", cb);
    },
  };
}

/**
 * A spot's view, zoomed so its area fills the editor (place-lab.js viewSpot):
 * the look puts the camera on the spot, the window is set round that view,
 * the camera jumps to it, and once a frame has rendered it (two frames on),
 * the area's outline is measured on screen and the radius the camera really
 * had (the viewer clamps the goal's) is scaled to fill SPOT_FILL. Then it
 * flies there, or jumps under reduced motion. Returns a cancel.
 *
 * @param {{ mv: any, look: { view: (spot: string) => void }, surface: any, zone: string,
 *   area: object, host: { getBoundingClientRect: () => { width: number, height: number } },
 *   reducedMotion?: boolean, requestFrame?: (cb: () => void) => any, cancelFrame?: (id: any) => void,
 *   onWindow?: (w: { theta: number[], phi: number[] }) => void,
 *   onFitted?: (fit: { radius: number, had: number } | null) => void }} o
 */
export function fitSpot({ mv, look, surface, zone, area, host, reducedMotion = false, requestFrame, cancelFrame, onWindow, onFitted }) {
  const f = frames();
  const request = requestFrame ?? f.request;
  const cancel = cancelFrame ?? f.cancel;
  const spot = spotOfZone(zone);
  look.view(spot);
  // the goal the view set, as numbers: "<theta>deg <phi>deg <r>m"
  const { theta, phi, radius } = parseOrbit(mv.cameraOrbit);
  if (Number.isFinite(theta) && Number.isFinite(phi)) onWindow?.(orbitWindow(spot, theta, phi));
  if (!Number.isFinite(theta) || !Number.isFinite(phi) || !Number.isFinite(radius)) {
    onFitted?.(null);
    return () => {};
  }
  mv.jumpCameraToGoal();
  let done = false;
  let id = request(() => {
    id = request(() => {
      id = null;
      if (done) return;
      done = true;
      const had = mv.getCameraOrbit().radius;
      const res = measureProjection(mv, probePointsFor(surface, zone), { name: PROBE_SLOT });
      const rect = host.getBoundingClientRect();
      let points = [];
      if (res && res.residual <= MAX_RESIDUAL_PX) {
        surface.setCamera(res.P);
        points = areaFitPoints(area)
          .map(([x, y]) => surface.dieToScreen(zone, x, y))
          .filter(Boolean);
      }
      const r = fitRadius({ had, points, width: rect.width, height: rect.height });
      mv.cameraOrbit = `${theta}deg ${phi}deg ${r}m`;
      if (reducedMotion) mv.jumpCameraToGoal();
      onFitted?.({ radius: r, had });
    });
  });
  return () => {
    if (done) return;
    done = true;
    if (id != null) cancel(id);
  };
}

// ---- The live repaint ------------------------------------------------------------------
/** Die px and degrees a gesture's pose may differ from the committed one and still be it. */
const SAME_PX = 0.5;
const SAME_DEG = 0.01;
/** Whether a gesture's pose is still the piece's committed pose. */
export function samePose(piece, pose) {
  const turn = ((((pose.rotation || 0) - (piece.rotation || 0)) % 360) + 540) % 360 - 180;
  return (
    ["cx", "cy", "w", "h"].every((k) => Math.abs(pose[k] - piece[k]) < SAME_PX) && Math.abs(turn) < SAME_DEG
  );
}

/**
 * A piece dragged on the hat, repainted every frame of the gesture as the
 * lab does: its look built once (buildSprite, at the size the gesture starts
 * at, so sprite px are die px), the rest of its spot laid once (beginLive),
 * then a transformed sprite a frame (liveFrame). Release draws the pose it
 * came to rest at and holds it (endLive with the sprite and its matrix) until
 * the host hands the committed art over; a cancel shows the committed art at
 * once.
 *
 * `pieceArt(id)` is the piece's art alone at die scale, its canvas the
 * piece's unturned box (the host may keep and hand back the same canvas: the
 * look keeps sprites by canvas). `restArt(zone, id)` is the zone's art without
 * it, in the zone rect's px, or null; that canvas is this module's once handed
 * over, and is zeroed when the gesture ends.
 *
 * Nothing starts while the gesture's pose is still the piece's committed one:
 * the hat already shows it, and a gesture that ends there may end with no
 * commit and no cancel (hat-place's two-finger tap that changed nothing), which
 * would leave the spot held live, deaf to every later change.
 *
 * @param {{ buildSprite: Function, beginLive: Function, liveFrame: Function, endLive: Function }} look
 * @param {{ zone: () => string, piece: (id: string) => ({ w: number } | null),
 *   pieceArt: (id: string) => any, restArt: (zone: string, id: string) => any }} source
 */
export function createLivePaint(look, { zone, piece, pieceArt, restArt }) {
  let live = null; // { id, zid, sprite, unit, rest }
  let refused = null; // a piece whose look could not be built: not retried every frame of its gesture
  const m = [1, 0, 0, 1, 0, 0];
  const matrixFor = (l, pose) =>
    pieceMatrix(l.sprite, { x: pose.cx, y: pose.cy, angle: (pose.rotation || 0) * RAD, scale: pose.w / l.unit }, m);

  function start(id) {
    const p = piece(id);
    const art = p ? pieceArt(id) : null;
    if (!p || !art?.width || !art.height || !(p.w > 0)) return null;
    const zid = zone();
    // sprite px are die px at the size the gesture starts at
    const scale = p.w / art.width;
    const sprite = look.buildSprite(zid, art, { scale });
    if (!sprite) return null;
    const rest = restArt(zid, id) ?? null;
    if (!look.beginLive(zid, { rest })) {
      if (rest) rest.width = 0;
      return null;
    }
    return { id, zid, sprite, unit: art.width * scale, rest };
  }
  function stop(opts) {
    refused = null;
    if (!live) return;
    look.endLive(live.zid, opts);
    if (live.rest) live.rest.width = 0;
    live = null;
  }
  return {
    /** One frame of a gesture on piece `id` at `pose` (die px, degrees). False when nothing could be drawn. */
    frame(id, pose) {
      if (!live || live.id !== id) {
        if (refused === id) return false;
        const p = piece(id);
        if (p && samePose(p, pose)) {
          // the committed pose: what the hat shows already (any other piece's
          // live paint, a stale one, ends here too)
          stop({ now: true });
          return true;
        }
        stop({ now: true });
        live = start(id);
        if (!live) refused = id;
      }
      if (!live) return false;
      return look.liveFrame(live.zid, live.sprite, matrixFor(live, pose)) !== false;
    },
    /** The gesture on `id` came to rest at `pose`: draw it there and hold it for the host's art. */
    finish(id, pose) {
      if (live && live.id === id) stop({ sprite: live.sprite, m: matrixFor(live, pose) });
      else stop({ now: true });
    },
    /** Show the committed art again at once (Escape, a spot change, leaving). */
    cancel() {
      stop({ now: true });
    },
    get id() {
      return live?.id ?? null;
    },
  };
}

// ---- The session -----------------------------------------------------------------------
const sameSize = (a, b) => (a?.w ?? null) === (b?.w ?? null) && (a?.h ?? null) === (b?.h ?? null);

/**
 * Editing on the hat: the placer on `host` (the element model-viewer fills,
 * so their top-left corners agree), the camera owned through the adapter and
 * fitted to the spot, the projection kept current, and the drag painted live.
 * Hat3D makes one when an edit begins and destroys it when the edit ends;
 * `update(edit)` passes each new edit prop on, and only what changed reaches
 * the placer (a new zone ends a gesture, so it is the one change that does).
 *
 * `edit` is Hat3D's prop: { zone, area, cap, pxPerInch, pieces, selectedId,
 * pieceArt, restArt, onSelect, onCommit, onCancel, onNote, onDelete, labels,
 * snapX?, level?, reducedMotion } (its onFailed is Hat3D's to call), die px throughout; a `reducedMotion` left out is
 * the browser's prefers-reduced-motion. `onCommit` is called once per
 * gesture (and per key step), after the live frame is held; the host then
 * re-exports its art, which hands that frame over.
 *
 * `onFailed(reason)` is called once when the projection stays unmeasurable
 * or off by more than MAX_RESIDUAL_PX for MAX_BAD_MEASURES measurements in a
 * row: Hat3D then stops editing on the hat and tells its host (edit.onFailed).
 *
 * @param {{ mv: any, host: any, look: any, surface: any, edit: object,
 *   requestFrame?: (cb: () => void) => any, cancelFrame?: (id: any) => void,
 *   makePlacer?: typeof createPlacer, onFailed?: (reason: string) => void }} o
 */
export function createEditSession({ mv, host, look, surface, edit, requestFrame, cancelFrame, makePlacer = createPlacer, onFailed }) {
  let cur = edit;
  let windowFor = { theta: [-Math.PI, Math.PI], phi: [0, Math.PI] };
  const reduced = (e) => !!(e.reducedMotion ?? globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches);
  let bad = 0;
  let failed = false;
  let destroyed = false;
  let residual = null;
  let cancelFit = () => {};
  let placer = null;

  const camera = createCameraAdapter(mv, () => windowFor);
  const live = createLivePaint(look, {
    zone: () => cur.zone,
    piece: (id) => (cur.pieces ?? []).find((p) => p.id === id) ?? null,
    pieceArt: (id) => cur.pieceArt?.(id) ?? null,
    restArt: (zone, id) => cur.restArt?.(zone, id) ?? null,
  });

  /** Whether a measurement is good to use; enough bad ones in a row fail the session. */
  function judge(res) {
    if (destroyed || failed) return false;
    if (res && Number.isFinite(res.residual) && res.residual <= MAX_RESIDUAL_PX) {
      bad = 0;
      residual = res.residual;
      return true;
    }
    if (++bad >= MAX_BAD_MEASURES) {
      failed = true;
      onFailed?.(res ? `projection residual ${res.residual} px` : "the projection could not be measured");
    }
    return false;
  }

  const projector = createProjector(mv, {
    surface,
    zone: () => cur.zone,
    requestFrame,
    cancelFrame,
    onMeasure(res) {
      if (!judge(res)) return;
      surface.setCamera(res.P);
      placer?.update({ cameraMoved: true });
    },
  });

  placer = makePlacer(host, {
    ...(requestFrame ? { requestFrame, cancelFrame } : {}),
    surface,
    zone: cur.zone,
    area: cur.area,
    cap: cur.cap,
    pieces: cur.pieces ?? [],
    selectedId: cur.selectedId ?? null,
    camera,
    pxPerInch: cur.pxPerInch,
    labels: cur.labels ?? {},
    ...("snapX" in cur ? { snapX: cur.snapX } : {}),
    level: cur.level ?? 0,
    reducedMotion: reduced(cur),
    onSelect: (id) => cur.onSelect?.(id),
    onLive: (id, pose) => {
      live.frame(id, pose);
    },
    onCommit: (id, pose) => {
      live.finish(id, pose);
      cur.onCommit?.(id, pose);
    },
    onCancel: (id) => {
      live.cancel();
      placer?.update({ pieces: cur.pieces ?? [], selectedId: cur.selectedId ?? null });
      cur.onCancel?.(id);
    },
    onNote: (text) => cur.onNote?.(text),
    onSnap: () => cur.onSnap?.(),
    onDelete: (id) => cur.onDelete?.(id),
  });

  function fit() {
    cancelFit();
    cancelFit = fitSpot({
      mv,
      look,
      surface,
      zone: cur.zone,
      area: cur.area,
      host,
      reducedMotion: reduced(cur),
      requestFrame,
      cancelFrame,
      onWindow: (w) => {
        windowFor = w;
      },
      onFitted: () => {
        cancelFit = () => {};
        projector.request();
      },
    });
  }

  // A gesture the placer ends with neither a commit nor a cancel (a
  // two-finger tap, hat-place finishManip) leaves no frame to hold: once the
  // last finger is up, a live repaint still open shows the committed art
  // again. These listen after the placer's (added later, on the same host, in
  // the same phase), so a commit or a cancel in that event has already ended it.
  const down = new Set();
  const onDown = (e) => {
    if (e.isPrimary) down.clear();
    down.add(e.pointerId);
  };
  const onUp = (e) => {
    if (!down.delete(e.pointerId) || down.size) return;
    if (live.id != null) live.cancel();
  };
  const POINTERS = [
    ["pointerdown", onDown],
    ["pointerup", onUp],
    ["pointercancel", onUp],
  ];
  for (const [type, fn] of POINTERS) host.addEventListener?.(type, fn, { capture: true });

  const onCameraChange = () => projector.request();
  mv.addEventListener("camera-change", onCameraChange);
  const RO = globalThis.ResizeObserver;
  const resize = RO ? new RO(() => projector.request()) : null;
  resize?.observe(host);
  fit();

  return {
    /** A new edit prop: only what changed reaches the placer; a new zone refits the camera. */
    update(next) {
      if (destroyed || !next) return;
      const prev = cur;
      cur = next;
      if (next.zone !== prev.zone) {
        live.cancel();
        placer.update({
          zone: next.zone,
          area: next.area,
          cap: next.cap,
          pieces: next.pieces ?? [],
          selectedId: next.selectedId ?? null,
          labels: next.labels ?? {},
          ...("snapX" in next ? { snapX: next.snapX } : {}),
          level: next.level ?? 0,
          reducedMotion: reduced(next),
        });
        fit();
        return;
      }
      // A piece gone mid-gesture (Delete, the host's remove) ends the gesture
      // silently in the placer: its live repaint ends here.
      if (live.id != null && !(next.pieces ?? []).some((p) => p.id === live.id)) live.cancel();
      const patch = {};
      if (next.area !== prev.area) patch.area = next.area;
      if (!sameSize(next.cap, prev.cap)) patch.cap = next.cap;
      if (next.pieces !== prev.pieces) patch.pieces = next.pieces ?? [];
      if ((next.selectedId ?? null) !== (prev.selectedId ?? null)) patch.selectedId = next.selectedId ?? null;
      if (next.labels?.spot !== prev.labels?.spot || next.labels?.size !== prev.labels?.size) patch.labels = next.labels ?? {};
      if (next.snapX !== prev.snapX) patch.snapX = next.snapX;
      if ((next.level ?? 0) !== (prev.level ?? 0)) patch.level = next.level ?? 0;
      if (reduced(next) !== reduced(prev)) patch.reducedMotion = reduced(next);
      if (Object.keys(patch).length) placer.update(patch);
    },
    /** The spot's view again (a new model load, a host that asks). */
    fit,
    /** Measure the camera again a frame from now. */
    reproject: () => projector.request(),
    /** Hide or show the outline and handles (Hat3D's pictures are of the hat, not the editor). */
    setChromeHidden(hidden) {
      const svg = host.querySelector?.("[data-hat-place]");
      if (svg) svg.style.visibility = hidden ? "hidden" : "";
    },
    get residual() {
      return residual;
    },
    get failed() {
      return failed;
    },
    /** Off the host: a gesture held now commits what it did (hat-place), then the hat shows the committed art. */
    destroy() {
      if (destroyed) return;
      cancelFit();
      projector.stop();
      placer.destroy();
      live.cancel();
      destroyed = true;
      for (const [type, fn] of POINTERS) host.removeEventListener?.(type, fn, { capture: true });
      mv.removeEventListener("camera-change", onCameraChange);
      resize?.disconnect();
      surface.setCamera?.(null);
    },
  };
}
