// models/: the 3D files, copied byte for byte from Reel48-Storefront
// public/3d/** (origin/main), renamed to stable names. MANIFEST.json records
// each file's sha256, its storefront path and commit; this re-hashes every
// file against it, so a file that changes (or one added without an entry)
// fails here, not in a customer's browser.
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { createSurface, HAT_3D_STYLES } from "../src/viewer/index.js";
import { hatDie } from "../src/core/index.js";

const dir = new URL("../models/", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("MANIFEST.json", dir), "utf8"));
const sha256 = (name) => createHash("sha256").update(readFileSync(new URL(name, dir))).digest("hex");

const EXPECTED = [
  "can-cooler-slim.glb",
  "can-cooler-standard.glb",
  "hat-no-6-poster.webp",
  "hat-no-6-surface.json",
  "hat-no-6.glb",
  "hat-no-7-poster.webp",
  "hat-no-7-surface.json",
  "hat-no-7.glb",
  "studio.hdr",
];

describe("models/", () => {
  it("holds exactly the manifest's files, and the manifest", () => {
    expect(Object.keys(manifest).sort()).toEqual(EXPECTED);
    expect(readdirSync(dir).sort()).toEqual([...EXPECTED, "MANIFEST.json"].sort());
  });

  for (const name of EXPECTED) {
    it(`${name} is the file the manifest names`, () => {
      const entry = manifest[name];
      expect(sha256(name)).toBe(entry.sha256);
      // The storefront names each file by the first 8 hex of its SHA-256.
      expect(entry.source).toMatch(/^public\/3d\/(hats|can-coolers)\//);
      expect(entry.source).toContain(`.${entry.sha256.slice(0, 8)}.`);
      expect(entry.storefrontCommit).toMatch(/^[0-9a-f]{40}$/);
    });
  }

  it("each GLB is a glTF binary", () => {
    for (const name of EXPECTED.filter((n) => n.endsWith(".glb"))) {
      const buf = readFileSync(new URL(name, dir));
      expect(buf.subarray(0, 4).toString("ascii")).toBe("glTF");
      expect(buf.readUInt32LE(4)).toBe(2);
      expect(buf.readUInt32LE(8)).toBe(buf.length);
    }
  });

  it("each poster is a WebP of the size the viewer boxes it at", () => {
    for (const style of ["no-6", "no-7"]) {
      const buf = readFileSync(new URL(`hat-${style}-poster.webp`, dir));
      expect(buf.subarray(0, 4).toString("ascii")).toBe("RIFF");
      expect(buf.subarray(8, 12).toString("ascii")).toBe("WEBP");
      expect(HAT_3D_STYLES[style].posterSize).toEqual({ width: 1200, height: 900 });
    }
  });

  it("the studio is a Radiance HDR", () => {
    expect(readFileSync(new URL("studio.hdr", dir)).subarray(0, 2).toString("ascii")).toBe("#?");
  });

  it("each surface is on its die's frame and its model's, and reads", () => {
    for (const [style, dieId] of [
      ["no-7", "hat-no-7-v2"],
      ["no-6", "hat-no-6"],
    ]) {
      const json = JSON.parse(readFileSync(new URL(`hat-${style}-surface.json`, dir), "utf8"));
      expect(json.frame).toEqual(hatDie(dieId).stage);
      expect(json.frame).toEqual(HAT_3D_STYLES[style].frame);
      const surface = createSurface(json);
      expect(surface.zoneIds).toEqual(expect.arrayContaining(["front", "left", "right", "back", "label_tall"]));
    }
  });
});
