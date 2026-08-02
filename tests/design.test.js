import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_COLOR,
  DESIGN_SCHEMA_VERSION,
  designReducer,
  historyReducer,
  initialDesignState,
  initialHistoryState,
  toDesignDescription,
} from "../src/core/design.js";

// Captured by running Reel48-Storefront's own coozie-design.js BEFORE this
// package existed. Element ids are replaced with "<id>" because they carry a
// counter and a timestamp; everything else is compared exactly.
//
// The serialized shape is the part that matters most: coozie-spec.ts formats it
// for production and data.reel48.com builds the supplier artwork zip from it.
// A renamed field here changes what a factory is told to print.
const GOLDEN = JSON.parse(
  readFileSync(fileURLToPath(new URL("./design.golden.json", import.meta.url)), "utf8"),
);

const anonymise = (v) => JSON.parse(JSON.stringify(v, (k, x) => (k === "id" ? "<id>" : x)));

function replay() {
  let s = initialDesignState("standard");
  s = designReducer(s, { type: "SET_COLOR", color: "#C13232" });
  s = designReducer(s, { type: "ADD_TEXT", text: "SABINE" });
  const textId = s.elements[s.elements.length - 1].id;
  s = designReducer(s, { type: "MOVE", id: textId, x: 0.5, y: 0.25 });
  s = designReducer(s, {
    type: "ADD_LOGO", fileName: "logo.png", mimeType: "image/png",
    naturalWidth: 400, naturalHeight: 200,
  });
  return s;
}

describe("the design document is unchanged by the extraction", () => {
  it("keeps the schema version", () => {
    // Not bumped by the move, on purpose: one behaviour-preserving extraction is
    // easier to verify than a move plus a schema migration.
    expect(DESIGN_SCHEMA_VERSION).toBe(GOLDEN.schemaVersion);
  });

  it("produces the same initial state", () => {
    expect(anonymise(initialDesignState("standard"))).toEqual(GOLDEN.initial);
  });

  it("produces the same state after a real editing sequence", () => {
    expect(anonymise(replay())).toEqual(GOLDEN.after);
  });

  it("serializes to the same description", () => {
    expect(anonymise(toDesignDescription(replay()))).toEqual(GOLDEN.description);
  });
});

describe("legacy size ids survive", () => {
  it("still writes `standard` and `slim`, not the package's die ids", () => {
    // Stored documents say `standard`; the package keys dies as
    // `koozie-standard`. Emitting the package id would orphan every design
    // already placed, including designs on orders in production.
    expect(initialDesignState("standard").size).toBe("standard");
    expect(initialDesignState("slim").size).toBe("slim");
    expect(initialDesignState(undefined).size).toBe("standard");
  });

  it("accepts a package die id too, and normalises it", () => {
    expect(initialDesignState("koozie-slim").size).toBe("slim");
  });

  it("falls back rather than throwing on junk", () => {
    // A design stored before `size` existed carries nothing at all.
    expect(initialDesignState("nonsense").size).toBe("standard");
    expect(initialDesignState(null).size).toBe("standard");
  });
});

describe("undo/redo", () => {
  it("matches the captured history behaviour", () => {
    let h = initialHistoryState("standard");
    h = historyReducer(h, { type: "SET_COLOR", color: "#111111" });
    h = historyReducer(h, { type: "SET_COLOR", color: "#222222" });
    expect({ past: h.past.length, future: h.future.length, color: h.present.color })
      .toEqual(GOLDEN.historyAfterTwo);

    h = historyReducer(h, { type: "UNDO" });
    expect({ past: h.past.length, future: h.future.length, color: h.present.color })
      .toEqual(GOLDEN.afterUndo);
  });

  it("collapses a continuous gesture into ONE step", () => {
    // The opacity slider fires per pixel. Without coalescing, dragging it once
    // costs fifty presses of undo to reverse.
    let h = initialHistoryState("standard");
    h = historyReducer(h, { type: "ADD_TEXT", id: "t1" });
    const before = h.past.length;
    for (const o of [0.9, 0.8, 0.7, 0.6]) {
      h = historyReducer(h, {
        type: "UPDATE_ELEMENT", id: "t1", patch: { opacity: o }, coalesceKey: "opacity:t1",
      });
    }
    expect(h.past.length).toBe(before + 1);
    expect(h.present.elements[0].opacity).toBe(0.6);

    // And one undo returns to before the whole gesture.
    h = historyReducer(h, { type: "UNDO" });
    expect(h.present.elements[0].opacity).toBe(1);
  });

  it("does not make selection undoable", () => {
    let h = initialHistoryState("standard");
    h = historyReducer(h, { type: "ADD_TEXT", id: "t1" });
    const depth = h.past.length;
    h = historyReducer(h, { type: "SELECT_ELEMENT", id: "t1" });
    h = historyReducer(h, { type: "CLEAR_SELECTION" });
    expect(h.past.length).toBe(depth);
  });

  it("caps history rather than growing without bound", () => {
    let h = initialHistoryState("standard");
    for (let i = 0; i < 80; i++) {
      h = historyReducer(h, { type: "SET_COLOR", color: `#${String(i).padStart(6, "0")}` });
    }
    expect(h.past.length).toBe(50);
  });

  it("a no-op action does not consume an undo step — where the reducer says so", () => {
    // historyReducer compares by IDENTITY, not deep equality: designReducer
    // returns the SAME object for a no-op, which makes "did anything change?"
    // free. That is the mechanism, and it means the answer depends on whether a
    // given case bothers to return `state` unchanged.
    let h = initialHistoryState("standard");
    h = historyReducer(h, { type: "ADD_TEXT", id: "t1" });
    const depth = h.past.length;

    // REORDER_ELEMENT past the end returns `state`, so it costs nothing.
    h = historyReducer(h, { type: "REORDER_ELEMENT", id: "t1", direction: 1 });
    expect(h.past.length).toBe(depth);

    // DELETE_ELEMENT with an unknown id does NOT. `.filter()` always builds a
    // new array, so the identity check sees a change and pushes a history entry
    // that undoes to exactly the same state.
    //
    // Pinned as-is rather than fixed. It is unreachable through the UI — you
    // cannot delete an element that is not there — and this extraction's job is
    // to be behaviour-preserving. Worth an early return in designReducer some
    // day; not worth conflating with a move.
    h = historyReducer(h, { type: "DELETE_ELEMENT", id: "does-not-exist" });
    expect(h.past.length).toBe(depth + 1);
  });
});

describe("brand-library logos", () => {
  const add = (source) => {
    let s = initialDesignState("standard");
    return designReducer(s, {
      type: "ADD_LOGO", id: "l1", fileName: "mark.svg", mimeType: "image/svg+xml",
      naturalWidth: 400, naturalHeight: 200, ...(source ? { source } : {}),
    });
  };

  it("records which saved asset a logo came from", () => {
    // account.reel48.com's designer places logos from a company's brand library.
    // Recording the asset id — not the URL — is what lets production be told
    // "this is the approved mark on file", and what survives a storage change.
    const src = { kind: "brand", assetId: "b7f1c2a0-0000-4000-8000-000000000001" };
    const s = add(src);
    expect(s.elements[0].source).toEqual(src);
    expect(toDesignDescription(s).elements[0].source).toEqual(src);
  });

  it("omits the key entirely when there is no source", () => {
    // The storefront passes nothing, and its stored documents must stay
    // byte-identical — which is what makes this additive at schemaVersion 3.
    // `source: undefined` would serialize away but compare unequal in a golden
    // test, so absence has to mean absent.
    const s = add(null);
    expect("source" in s.elements[0]).toBe(false);
    expect("source" in toDesignDescription(s).elements[0]).toBe(false);
  });

  it("did not bump the schema version", () => {
    // An added optional field is readable by everything that read version 3.
    expect(DESIGN_SCHEMA_VERSION).toBe(3);
  });
});
