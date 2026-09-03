import type { Options } from "react-scan";
import { getApiClient } from "../api";
import { isTauriEnvironment } from "../api/client";

type OnRenderFn = NonNullable<Options["onRender"]>;
type Render = Parameters<OnRenderFn>[1][number];

let logFilePath: string | null = null;
const buffer: string[] = [];
let flushTimer: ReturnType<typeof setInterval> | null = null;

const FLUSH_INTERVAL_MS = 2000;

/**
 * How many render events may wait for a file to write them to.
 *
 * The buffer is only ever drained by a write, so anything that stops the write
 * from happening turns it into an unbounded log of every render the app has
 * ever done — which on a large diff is hundreds of megabytes of JS heap spent
 * on a debug file nobody is reading. The window is small (the log path
 * resolves asynchronously at startup), so a cap this size holds everything a
 * real startup produces and drops the oldest beyond it.
 */
const MAX_BUFFERED = 5000;

const CHANGE_TYPE_LABELS: Record<number, string> = {
  1: "props",
  2: "state",
  3: "state",
  4: "context",
};

function serializeRender(render: Render): string {
  const changes = render.changes.map((c) => ({
    type: CHANGE_TYPE_LABELS[c.type] ?? "unknown",
    name: c.name,
  }));

  return JSON.stringify({
    ts: Date.now(),
    component: render.componentName,
    phase: render.phase === 1 ? "mount" : "update",
    time: render.time,
    count: render.count,
    forget: render.forget,
    didCommit: render.didCommit,
    unnecessary: render.unnecessary,
    changes,
  });
}

function flush(): void {
  if (buffer.length === 0) return;
  if (!logFilePath) return;

  const lines = buffer.splice(0).join("\n") + "\n";

  import("@tauri-apps/api/core").then(({ invoke }) => {
    invoke("append_to_file", { path: logFilePath, contents: lines }).catch(
      () => {
        // Silently fail
      },
    );
  });
}

function ensureFlushTimer(): void {
  if (flushTimer !== null) return;
  flushTimer = setInterval(flush, FLUSH_INTERVAL_MS);
}

/** React Scan onRender callback. Buffers render events for batched file writes. */
export const onScanRender: OnRenderFn = (_fiber, renders) => {
  if (!import.meta.env.DEV) return;
  // The writer is Tauri's `append_to_file`, so in web mode there is nowhere for
  // these to go. Buffering them anyway is how this grew past 250MB in a browser
  // session: `flush` bailed on the same condition *before* draining.
  if (!isTauriEnvironment()) return;

  for (const render of renders) {
    buffer.push(serializeRender(render));
  }
  if (buffer.length > MAX_BUFFERED) {
    buffer.splice(0, buffer.length - MAX_BUFFERED);
  }
  ensureFlushTimer();
};

/**
 * How many render events are waiting to be written.
 *
 * Exported for the test that holds the line this file crossed once already:
 * the buffer is drained by a write, so a condition that stops the write must
 * also stop the buffering.
 */
export function bufferedRenderCount(): number {
  return buffer.length;
}

/**
 * Start React Scan, in dev builds only.
 *
 * The import is dynamic so that production never carries it: `import.meta.env.DEV`
 * is replaced with `false` at build time, which makes the whole branch dead code
 * and keeps react-scan's runtime — and its toolbar — out of the shipped bundle.
 * It used to be a static import and an unconditional `scan({})`, so the released
 * app instrumented every React commit for a profiler nobody could see.
 */
export function startReactScan(): void {
  if (!import.meta.env.DEV) return;

  void import("react-scan").then(({ scan, setOptions }) => {
    scan({});
    // setOptions after scan() — scan's start() overwrites options from
    // localStorage, which drops non-persisted keys like onRender.
    setOptions({ onRender: onScanRender });
  });
}

/** Resolve the app-wide react-scan JSONL log path. Call once at startup. */
export function initReactScanLog(options?: { clear?: boolean }): void {
  if (!import.meta.env.DEV) return;

  getApiClient()
    .getReviewRoot()
    .then(async (root) => {
      if (!root) return;
      logFilePath = `${root}/react-scan.jsonl`;

      if (options?.clear && isTauriEnvironment()) {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("write_text_file", {
          path: logFilePath,
          contents: "",
        }).catch(() => {});
      }
    })
    .catch(() => {
      // Silently fall back — no log file
    });
}
