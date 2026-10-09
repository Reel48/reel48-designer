import { describe, expect, it, vi, afterEach } from "vitest";
import { createImageReadiness } from "../src/stage/imageReadiness.js";

function stage(entries = [["logo:1", "original"]]) {
  const readiness = createImageReadiness();
  readiness.mount();
  readiness.commit(entries, true);
  return readiness;
}

afterEach(() => vi.useRealTimers());

describe("canvas image readiness", () => {
  it("does not treat a downloaded previous source as the committed replacement", async () => {
    const readiness = stage();
    readiness.report("logo:1", "original", "loaded");
    expect(readiness.status()).toBe("ready");
    readiness.commit([["logo:1", "processed"]], true);
    let resolved = false;
    const waiting = readiness.wait().then(() => { resolved = true; });
    readiness.report("logo:1", "original", "loaded");
    await Promise.resolve();
    expect(resolved).toBe(false);
    readiness.report("logo:1", "processed", "loaded");
    await waiting;
    expect(readiness.status()).toBe("ready");
  });

  it("requires the pattern and every logo, and ignores removed logos", async () => {
    const readiness = stage([["logo:1", "a"], ["logo:2", "b"], ["pattern", "p"]]);
    readiness.report("logo:1", "a", "loaded");
    readiness.report("pattern", "p", "loaded");
    expect(readiness.status()).toBe("loading");
    readiness.commit([["logo:1", "a"], ["pattern", "p"]], true);
    await expect(readiness.wait()).resolves.toBe(readiness.revision);
  });

  it("follows replacement sources while waiting and ignores stale failures", async () => {
    const readiness = stage();
    const waiting = readiness.wait();
    readiness.commit([["logo:1", "replacement"]], true);
    readiness.report("logo:1", "original", "failed");
    expect(readiness.status()).toBe("loading");
    readiness.report("logo:1", "replacement", "loaded");
    await expect(waiting).resolves.toBe(readiness.revision);
  });

  it("fails clearly for missing and failed sources", async () => {
    await expect(stage([["logo:1", undefined]]).wait()).rejects.toThrow("could not be loaded");
    const readiness = stage();
    readiness.report("logo:1", "original", "failed");
    await expect(readiness.wait()).rejects.toThrow("could not be loaded");
  });

  it("cannot be ready until the measured stage is committed", async () => {
    const readiness = stage([]);
    readiness.commit([], false);
    expect(readiness.status()).toBe("loading");
    readiness.commit([], true);
    await expect(readiness.wait()).resolves.toBe(readiness.revision);
  });

  it("does not invalidate an export for equivalent host rerenders", async () => {
    const readiness = stage([]);
    readiness.commit([], true, "document-a");
    const revision = readiness.revision;
    readiness.commit([], true, "document-a");
    expect(readiness.revision).toBe(revision);
    readiness.commit([], true, "document-b");
    expect(readiness.revision).toBe(revision + 1);
  });

  it("bounds loading waits and rejects on unmount", async () => {
    vi.useFakeTimers();
    const readiness = stage();
    const timeout = expect(readiness.wait(50)).rejects.toThrow("too long");
    await vi.advanceTimersByTimeAsync(50);
    await timeout;
    const closed = expect(readiness.wait()).rejects.toThrow("closed");
    readiness.unmount();
    await closed;
    readiness.mount(); // React Strict Mode effect replay remains usable.
    readiness.report("logo:1", "original", "loaded");
    await expect(readiness.wait()).resolves.toBe(readiness.revision);
  });

  it("rejects a capture if artwork changes while asynchronous PNG encoding finishes", async () => {
    const readiness = stage();
    readiness.report("logo:1", "original", "loaded");
    let finish;
    const result = expect(readiness.capture(() => new Promise((resolve) => { finish = resolve; })))
      .rejects.toThrow("changed or closed");
    readiness.commit([["logo:1", "replacement"]], true);
    await result;
    finish(new Blob(["old artwork"]));
  });

  it("captures ready artwork and propagates canvas export failures", async () => {
    const readiness = stage([]);
    const proof = new Blob(["proof"]);
    await expect(readiness.capture(() => Promise.resolve(proof))).resolves.toBe(proof);
    await expect(readiness.capture(() => { throw new Error("tainted"); })).rejects.toThrow("tainted");
    await expect(readiness.capture(() => Promise.reject(new Error("encoding")))).rejects.toThrow("encoding");
  });

  it("bounds PNG encoding and cancels it on unmount", async () => {
    vi.useFakeTimers();
    const readiness = stage([]);
    const timeout = expect(readiness.capture(() => new Promise(() => {}), 50)).rejects.toThrow("too long");
    await vi.advanceTimersByTimeAsync(50);
    await timeout;
    const closed = expect(readiness.capture(() => new Promise(() => {}))).rejects.toThrow("closed");
    readiness.unmount();
    await closed;
  });
});
