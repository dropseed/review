/**
 * Mock Tauri API that proxies to the companion HTTP server.
 * This allows the app to run in a regular browser for testing.
 *
 * Only active when window.__TAURI_INTERNALS__ is not defined.
 */

const COMPANION_SERVER = "http://localhost:3333";

// Check if we're in a real Tauri environment
export const isTauri = () => {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
};

// In-memory state for things that would normally persist via Tauri
const mockState = {
  reviewStates: new Map<string, unknown>(),
  currentComparison: null as unknown,
};

/**
 * Mock invoke function that proxies commands to the HTTP companion server
 */
export async function mockInvoke<T>(cmd: string, args?: unknown): Promise<T> {
  console.log(`[tauriMock] invoke: ${cmd}`, args);

  const params = (args || {}) as Record<string, unknown>;

  switch (cmd) {
    case "get_current_repo":
      return fetchJson("/repo").then((r) => r.path);

    case "list_branches":
      return fetchJson(`/branches?${buildRepoQuery(params)}`);

    case "get_current_branch":
      // Not directly exposed, but we can get it from status
      return fetchJson(`/status?${buildRepoQuery(params)}`).then(
        (s) => s.branch || "main",
      );

    case "get_default_branch":
      // Default to "main" for now
      return "main" as T;

    case "get_git_status":
      return fetchJson(`/status?${buildRepoQuery(params)}`);

    case "list_files":
      return fetchJson(
        `/files?${buildRepoQuery(params)}&${buildComparisonQuery(params.comparison)}`,
      );

    case "list_all_files":
      return fetchJson(
        `/files?${buildRepoQuery(params)}&${buildComparisonQuery(params.comparison)}&all=true`,
      );

    case "get_file_content":
      return fetchJson(
        `/file?${buildRepoQuery(params)}&path=${encodeURIComponent(params.file_path as string)}&${buildComparisonQuery(params.comparison)}`,
      );

    case "load_review_state": {
      const key = buildComparisonKey(params.comparison);
      if (mockState.reviewStates.has(key)) {
        return mockState.reviewStates.get(key) as T;
      }
      // Try to load from server
      try {
        const state = await fetchJson(
          `/state?${buildRepoQuery(params)}&${buildComparisonQuery(params.comparison)}`,
        );
        mockState.reviewStates.set(key, state);
        return state;
      } catch {
        // Return empty state
        return {
          comparison: params.comparison,
          hunks: {},
          trust_labels: [],
          notes: "",
        } as T;
      }
    }

    case "save_review_state": {
      const state = params.state as { comparison: unknown };
      const key = buildComparisonKey(state.comparison);
      mockState.reviewStates.set(key, state);
      console.log(`[tauriMock] Saved review state for ${key}`);
      return undefined as T;
    }

    case "get_current_comparison":
      return mockState.currentComparison as T;

    case "set_current_comparison":
      mockState.currentComparison = params.comparison;
      return undefined as T;

    case "check_claude_available":
      return false as T; // Claude CLI not available in browser mock

    case "get_trust_taxonomy":
    case "get_trust_taxonomy_with_custom":
      return fetchJson("/taxonomy").catch(() => []);

    case "start_file_watcher":
    case "stop_file_watcher":
      // No-op in browser
      return undefined as T;

    case "match_trust_pattern":
      // Simple pattern matching in browser
      const label = params.label as string;
      const pattern = params.pattern as string;
      if (pattern.endsWith(":*")) {
        const category = pattern.slice(0, -2);
        return label.startsWith(category + ":") as T;
      }
      return (label === pattern) as T;

    case "is_dev_mode":
      return true as T;

    case "update_menu_state":
    case "set_sentry_consent":
      return undefined as T;

    default:
      console.warn(`[tauriMock] Unhandled command: ${cmd}`);
      throw new Error(`Mock not implemented for command: ${cmd}`);
  }
}

// Helper to build repo query param
function buildRepoQuery(params: Record<string, unknown>): string {
  if (params.repo_path) {
    return `repo=${encodeURIComponent(params.repo_path as string)}`;
  }
  return "";
}

// Helper to build comparison query params
function buildComparisonQuery(comparison: unknown): string {
  if (!comparison) return "";
  const c = comparison as {
    old: string;
    new: string;
    working_tree?: boolean;
    workingTree?: boolean;
  };
  const parts = [
    `old=${encodeURIComponent(c.old)}`,
    `new=${encodeURIComponent(c.new)}`,
  ];
  if (c.working_tree || c.workingTree) {
    parts.push("workingTree=true");
  }
  return parts.join("&");
}

// Helper to build comparison key for storage
function buildComparisonKey(comparison: unknown): string {
  if (!comparison) return "default";
  const c = comparison as { old: string; new: string; key?: string };
  return c.key || `${c.old}..${c.new}`;
}

// Fetch JSON from companion server
async function fetchJson(path: string): Promise<any> {
  const url = `${COMPANION_SERVER}${path}`;
  console.log(`[tauriMock] fetch: ${url}`);

  const response = await fetch(url);
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`HTTP ${response.status}: ${error}`);
  }
  return response.json();
}

/**
 * Mock event listener - stores callbacks but events won't fire in browser
 */
const eventListeners = new Map<string, Set<(event: unknown) => void>>();

export function mockListen(
  event: string,
  callback: (event: unknown) => void,
): () => void {
  if (!eventListeners.has(event)) {
    eventListeners.set(event, new Set());
  }
  eventListeners.get(event)!.add(callback);

  // Return unlisten function
  return () => {
    eventListeners.get(event)?.delete(callback);
  };
}

/**
 * Install mock Tauri APIs on window if not in Tauri environment
 */
export function installMockTauri(): void {
  if (isTauri()) {
    console.log("[tauriMock] Real Tauri detected, not installing mock");
    return;
  }

  console.log("[tauriMock] Installing mock Tauri APIs");

  // Track callback IDs
  let callbackId = 0;
  const callbacks = new Map<number, unknown>();

  // Create mock __TAURI_INTERNALS__
  (window as any).__TAURI_INTERNALS__ = {
    invoke: mockInvoke,
    transformCallback: (callback: unknown, _once?: boolean) => {
      const id = callbackId++;
      callbacks.set(id, callback);
      return id;
    },
    convertFileSrc: (path: string) => path,
    metadata: {
      currentWindow: { label: "main" },
      currentWebview: { label: "main" },
    },
    __isMock: true, // Flag to distinguish from real Tauri
  };

  // Mock plugin:event for listen()
  (window as any).__TAURI_INTERNALS__.invoke = async (
    cmd: string,
    args?: unknown,
  ) => {
    // Handle plugin commands
    if (cmd === "plugin:event|listen") {
      console.log("[tauriMock] listen:", args);
      // Return a handler ID that can be used to unlisten
      return callbackId++;
    }
    if (cmd === "plugin:event|unlisten") {
      console.log("[tauriMock] unlisten:", args);
      return;
    }
    if (cmd === "plugin:window|current") {
      return { label: "main" };
    }
    if (cmd.startsWith("plugin:global-shortcut|")) {
      console.log("[tauriMock] global-shortcut:", cmd, args);
      return; // No-op for shortcuts in browser
    }
    if (cmd.startsWith("plugin:dialog|")) {
      console.log("[tauriMock] dialog:", cmd, args);
      return null; // User cancelled
    }
    if (cmd.startsWith("plugin:clipboard-manager|")) {
      console.log("[tauriMock] clipboard:", cmd, args);
      return;
    }
    if (cmd.startsWith("plugin:notification|")) {
      console.log("[tauriMock] notification:", cmd, args);
      return { id: 1 };
    }
    if (cmd === "plugin:app|version") {
      return "0.0.1-dev";
    }
    if (cmd.startsWith("plugin:store|")) {
      console.log("[tauriMock] store:", cmd, args);
      // Return empty for get, no-op for set
      if (cmd === "plugin:store|get") return null;
      return;
    }

    // Fall back to our command handler
    return mockInvoke(cmd, args);
  };
}
