// patterns/ (v1.16.0): the can cooler's pattern tiles, so a host that is not
// the storefront can draw a pattern. The files the designer DRAWS (each
// registry entry's `file` or both `files`, and its `thumb`), copied byte for
// byte from Reel48-Storefront public/patterns/ at the commit the registry was
// ported from; never the print masters (`printFile` / `printFiles`), which
// production reads from www.reel48.com (coozie-spec's absolute URL).
//
// MANIFEST.json records each file's sha256, storefront path and commit; this
// re-hashes every file against it, checks it names exactly what the registry
// draws, and checks each SVG is a plain picture: a host serves these from its
// own origin under a strict CSP, so none may run code or reach another origin.
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { COOZIE_PATTERNS, PATTERN_BASE, patternTile } from "../src/core/coozie-patterns.js";

const dir = fileURLToPath(new URL("../patterns/", import.meta.url));
const manifest = JSON.parse(readFileSync(join(dir, "MANIFEST.json"), "utf8"));
const sha256 = (name) => createHash("sha256").update(readFileSync(join(dir, name))).digest("hex");

/** Every file under patterns/, as a path relative to it. */
function files(at = dir) {
  return readdirSync(at).flatMap((name) => {
    const p = join(at, name);
    return statSync(p).isDirectory() ? files(p) : [relative(dir, p)];
  });
}

const drawn = new Set();
const prints = new Set();
for (const p of COOZIE_PATTERNS) {
  if (p.file) drawn.add(p.file);
  for (const f of Object.values(p.files ?? {})) drawn.add(f);
  drawn.add(p.thumb);
  if (p.printFile) prints.add(p.printFile);
  for (const f of Object.values(p.printFiles ?? {})) prints.add(f);
}

describe("patterns/", () => {
  it("holds exactly the files the registry draws, and the manifest", () => {
    expect(drawn.size).toBe(66);
    expect(Object.keys(manifest).sort()).toEqual([...drawn].sort());
    expect(files().sort()).toEqual([...drawn, "MANIFEST.json"].sort());
  });

  it("holds no print master", () => {
    expect(prints.size).toBeGreaterThan(0);
    for (const f of files()) {
      expect(prints.has(f), f).toBe(false);
      expect(f).not.toMatch(/\.print\.|\.png$/);
    }
  });

  it("has every file the manifest names, as the storefront committed it", () => {
    for (const [name, entry] of Object.entries(manifest)) {
      expect(sha256(name), name).toBe(entry.sha256);
      expect(entry.source).toBe(`public/patterns/${name}`);
      expect(entry.storefrontCommit).toMatch(/^[0-9a-f]{40}$/);
    }
  });

  it("is where patternTile points, under PATTERN_BASE", () => {
    expect(PATTERN_BASE).toBe("/patterns/");
    for (const p of COOZIE_PATTERNS) {
      for (const size of ["standard", "slim"]) {
        const { src } = patternTile(p, size);
        expect(src.startsWith(PATTERN_BASE)).toBe(true);
        expect(manifest[src.slice(PATTERN_BASE.length)], src).toBeDefined();
      }
    }
  });

  it("names a redrawn tile anew: every file carries its version", () => {
    for (const name of Object.keys(manifest)) expect(name).toMatch(/\.v\d+\.(svg|webp)$/);
  });

  it("holds SVGs that are plain pictures: no script, no handlers, nothing from another origin", () => {
    const svgs = files().filter((f) => f.endsWith(".svg"));
    expect(svgs.length).toBeGreaterThan(20);
    for (const f of svgs) {
      const text = readFileSync(join(dir, f), "utf8");
      expect(text.trimStart().startsWith("<svg"), f).toBe(true);
      expect(text, f).not.toMatch(/<\s*(script|foreignObject|iframe|object|embed|image|use|style|a)\b/i);
      expect(text, f).not.toMatch(/\son[a-z]+\s*=/i);
      expect(text, f).not.toMatch(/javascript:|@import|data:/i);
      // every reference is to an element of the file itself
      for (const [, ref] of text.matchAll(/(?:href\s*=\s*["']|url\(\s*["']?)([^"')\s]*)/gi)) expect(ref.startsWith("#"), `${f}: ${ref}`).toBe(true);
      expect(text, f).not.toMatch(/xlink:href|\shref\s*=\s*["'](?!#)/i);
    }
  });

  it("holds WebPs that are WebPs", () => {
    for (const f of files().filter((n) => n.endsWith(".webp"))) {
      const buf = readFileSync(join(dir, f));
      expect(buf.subarray(0, 4).toString("ascii"), f).toBe("RIFF");
      expect(buf.subarray(8, 12).toString("ascii"), f).toBe("WEBP");
    }
  });
});
