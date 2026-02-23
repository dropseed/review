import type { Options } from "react-scan";
import { getApiClient } from "../api";
import { isTauriEnvironment } from "../api/client";

type OnRenderFn = NonNullable<Options["onRender"]>;
type Render = Parameters<OnRenderFn>[1][number];

let logFilePath: string | null = null;
const buffer: string[] = [];
let flushTimer: ReturnType<typeof setInterval> | null = null;

const FLUSH_INTERVAL_MS = 2000;

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
  if (!isTauriEnvironment()) return;

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

  for (const render of renders) {
    buffer.push(serializeRender(render));
  }
  ensureFlushTimer();
};

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
