/**
 * Facts about the current UI that commands ask about, contributed by whoever
 * owns them.
 *
 * This inverts a dependency that would otherwise point the wrong way: knowing
 * whether a terminal has focus means asking the terminal, and `commands/` is
 * infrastructure that should not import a leaf component to find out. The
 * terminal registers the answer instead.
 *
 * Adding a key means adding a field here and registering a getter — the shape
 * stays typed, so a command reading `ctx.keys.somethingNew` still fails to
 * compile if nobody declared it.
 */
export interface ContextKeys {
  /**
   * Focus is inside a terminal pane.
   *
   * Tracked because focus inside a terminal *is* focus inside xterm's
   * textarea, which the generic "typing in an input" guard would swallow.
   */
  terminalFocused: boolean;
}

const DEFAULTS: ContextKeys = {
  terminalFocused: false,
};

type Getters = { [K in keyof ContextKeys]?: () => ContextKeys[K] };

const getters: Getters = {};

/** Publish the current value of one context key. Returns a disposer. */
export function registerContextKey<K extends keyof ContextKeys>(
  key: K,
  get: () => ContextKeys[K],
): () => void {
  getters[key] = get;
  return () => {
    if (getters[key] === get) delete getters[key];
  };
}

/** Read every context key, falling back to its default if unregistered. */
export function readContextKeys(): ContextKeys {
  const keys = { ...DEFAULTS };
  for (const key of Object.keys(DEFAULTS) as (keyof ContextKeys)[]) {
    const get = getters[key];
    if (get) keys[key] = get() as never;
  }
  return keys;
}
