/** Tracks only image sources committed to the canvas, never merely downloaded. */
export function createImageReadiness() {
  let expected = new Map();
  const reports = new Map();
  const listeners = new Set();
  let mounted = false;
  let stageReady = false;
  let revision = 0;
  let contentKey;
  const notify = () => listeners.forEach((listener) => listener());
  const status = () => {
    if (!mounted) return "unmounted";
    for (const [id, src] of expected) {
      if (!src) return "failed";
      const report = reports.get(id);
      if (report?.src === src && report.status === "failed") return "failed";
    }
    if (!stageReady) return "loading";
    for (const [id, src] of expected) {
      const report = reports.get(id);
      if (report?.src !== src || report.status !== "loaded") return "loading";
    }
    return "ready";
  };
  return {
    status,
    get revision() { return revision; },
    mount() { mounted = true; notify(); },
    unmount() { mounted = false; revision++; notify(); },
    commit(entries, ready, nextContentKey) {
      const next = new Map(entries);
      const changed = ready !== stageReady || nextContentKey !== contentKey ||
        next.size !== expected.size || [...next].some(([id, src]) => !expected.has(id) || expected.get(id) !== src);
      expected = next;
      contentKey = nextContentKey;
      for (const id of reports.keys()) if (!expected.has(id)) reports.delete(id);
      stageReady = ready;
      if (changed) revision++;
      notify();
    },
    report(id, src, imageStatus) {
      reports.set(id, { src, status: imageStatus });
      notify();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    capture(snapshot, timeoutMs = 15000) {
      const capturedRevision = revision;
      return new Promise((resolve, reject) => {
        let timer;
        const finish = (error, value) => {
          clearTimeout(timer);
          listeners.delete(check);
          if (error) reject(error); else resolve(value);
        };
        const check = () => {
          if (revision !== capturedRevision || status() !== "ready") {
            finish(new Error("The design changed or closed while exporting. Please try again."));
          }
        };
        timer = setTimeout(() => finish(new Error("The proof took too long to generate. Please try again.")), timeoutMs);
        listeners.add(check);
        if (status() !== "ready") { check(); return; }
        try {
          Promise.resolve(snapshot()).then((value) => {
            if (revision !== capturedRevision || status() !== "ready") check();
            else finish(null, value);
          }, (error) => finish(error));
        } catch (error) { finish(error); }
      });
    },
    wait(timeoutMs = 15000) {
      return new Promise((resolve, reject) => {
        let timer;
        const check = () => {
          const current = status();
          if (current === "loading") return;
          listeners.delete(check);
          clearTimeout(timer);
          if (current === "ready") resolve(revision);
          else reject(new Error(current === "failed"
            ? "Artwork could not be loaded. Please upload it again before exporting."
            : "The designer was closed before the proof was ready."));
        };
        timer = setTimeout(() => {
          listeners.delete(check);
          reject(new Error("Artwork is taking too long to load. Please try exporting again."));
        }, timeoutMs);
        listeners.add(check);
        check();
      });
    },
  };
}
