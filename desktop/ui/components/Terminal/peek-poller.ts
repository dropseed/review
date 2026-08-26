import { getApiClient } from "../../api";

const PEEK_INTERVAL_MS = 2000;

/**
 * One poll for every terminal on screen, instead of one per card.
 *
 * A peek is a round trip to the daemon and a full VT screen render, and the
 * overview draws a card per running terminal — so per-card polling made the
 * steady-state cost of *looking at* the overview proportional to how many
 * terminals a person has, twice a second's worth of it. The daemon answers a
 * list of ids in one call, so the poll asks once for everything mounted and
 * hands each card its own screen back.
 *
 * The subscriber set is the poll's subject: it starts with the first card and
 * stops with the last, and a card mounting mid-interval is asked for
 * immediately rather than waiting out a tick it wasn't part of.
 */

export interface PeekPollerOptions {
  /** The batched peek. Defaults to the live API client. */
  peekMany?: (ids: string[]) => Promise<Record<string, string>>;
  /** Poll period while at least one card is mounted. */
  intervalMs?: number;
  /**
   * Whether anyone can see the result. A backgrounded window stops asking
   * entirely rather than paying for screens nobody can look at.
   */
  isVisible?: () => boolean;
}

type PeekListener = (peek: string) => void;

export class TerminalPeekPoller {
  private readonly listeners = new Map<string, Set<PeekListener>>();
  /**
   * The last screen delivered per id, kept only while that id has a listener.
   * It is what a second card for the same session gets on mount, and it is what
   * makes "the daemon didn't answer for this id" distinguishable from "we have
   * never had a screen for it".
   */
  private readonly latest = new Map<string, string>();

  private readonly peekMany: (ids: string[]) => Promise<Record<string, string>>;
  private readonly intervalMs: number;
  private readonly isVisible: () => boolean;

  private interval: ReturnType<typeof setInterval> | null = null;
  private immediate: ReturnType<typeof setTimeout> | null = null;
  private pending = false;
  private watchingVisibility = false;

  constructor(options: PeekPollerOptions = {}) {
    this.peekMany =
      options.peekMany ?? ((ids) => getApiClient().terminalPeekMany(ids));
    this.intervalMs = options.intervalMs ?? PEEK_INTERVAL_MS;
    this.isVisible =
      options.isVisible ?? (() => document.visibilityState === "visible");
  }

  /**
   * Watch `id`'s screen. `listener` is called with each new screen and with the
   * cached one right away when another card already has it — never with the
   * same string twice, so a terminal that isn't moving costs no re-renders.
   * Returns an unsubscribe.
   */
  subscribe(id: string, listener: PeekListener): () => void {
    let set = this.listeners.get(id);
    const isNewId = !set;
    if (!set) {
      set = new Set();
      this.listeners.set(id, set);
    }
    set.add(listener);

    const cached = this.latest.get(id);
    if (cached !== undefined) listener(cached);
    else if (isNewId) this.scheduleImmediate();

    this.sync();

    return () => {
      const current = this.listeners.get(id);
      if (!current) return;
      current.delete(listener);
      if (current.size > 0) return;
      // Nobody is showing this session any more. Dropping the cache with the
      // last listener is what keeps a hit on it fresh: the only way to read a
      // cached screen is for a second card to mount while a first one is
      // already being polled.
      this.listeners.delete(id);
      this.latest.delete(id);
      this.sync();
    };
  }

  /** Stop everything (tests; nothing in the app tears the shared one down). */
  dispose(): void {
    this.listeners.clear();
    this.latest.clear();
    this.stopInterval();
    if (this.immediate !== null) {
      clearTimeout(this.immediate);
      this.immediate = null;
    }
    if (this.watchingVisibility) {
      document.removeEventListener("visibilitychange", this.handleVisibility);
      this.watchingVisibility = false;
    }
  }

  // ----- Internals -----

  private handleVisibility = (): void => this.sync();

  /** Start, stop, or leave the timer alone, per what is mounted and visible. */
  private sync(): void {
    const mounted = this.listeners.size > 0;
    // Watching is gated on *mounted*, not on visible: a card that mounts into a
    // backgrounded window has to be told when the window comes back, and this
    // is the only listener that could tell it.
    if (mounted !== this.watchingVisibility) {
      if (mounted) {
        document.addEventListener("visibilitychange", this.handleVisibility);
      } else {
        document.removeEventListener("visibilitychange", this.handleVisibility);
      }
      this.watchingVisibility = mounted;
    }
    if (mounted && this.isVisible()) {
      if (this.interval === null) {
        this.interval = setInterval(() => this.pull(), this.intervalMs);
        // Coming back is the moment the screens on show are most stale, so the
        // first tick is now rather than an interval away.
        this.scheduleImmediate();
      }
      return;
    }
    this.stopInterval();
  }

  private stopInterval(): void {
    if (this.interval !== null) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  /**
   * Pull on the next macrotask rather than now, so the overview mounting twenty
   * cards at once asks once instead of twenty times.
   */
  private scheduleImmediate(): void {
    if (this.immediate !== null) return;
    this.immediate = setTimeout(() => {
      this.immediate = null;
      this.pull();
    }, 0);
  }

  private pull(): void {
    // In flight at most once — a slow peek must not stack behind the interval.
    if (this.pending) return;
    if (!this.isVisible()) return;
    const ids = [...this.listeners.keys()];
    if (ids.length === 0) return;
    this.pending = true;
    this.peekMany(ids)
      .then((screens) => this.deliver(ids, screens))
      .catch(() => this.deliver(ids, {}))
      .finally(() => {
        this.pending = false;
      });
  }

  /**
   * Hand each asked-for id its screen.
   *
   * Ids that came back are delivered when the string actually changed. Ids the
   * answer omits — a session that died between the ask and the answer, or a
   * whole request that failed — settle on "" only if they have never had a
   * screen; a card that has one keeps showing it rather than blanking on a
   * blip. Ids whose last card unmounted while the request was in flight are
   * dropped: caching them would be a leak, and there is nobody to tell.
   */
  private deliver(asked: string[], screens: Record<string, string>): void {
    for (const id of asked) {
      const listeners = this.listeners.get(id);
      if (!listeners) continue;
      const screen = screens[id] ?? (this.latest.has(id) ? undefined : "");
      if (screen === undefined) continue;
      if (this.latest.get(id) === screen) continue;
      this.latest.set(id, screen);
      for (const listener of listeners) listener(screen);
    }
  }
}

let shared: TerminalPeekPoller | null = null;

/** The app's one poller. Created on first use; never torn down. */
export function sharedTerminalPeekPoller(): TerminalPeekPoller {
  shared ??= new TerminalPeekPoller();
  return shared;
}
