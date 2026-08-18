import type { ReviewStore } from "../stores/types";
import type { ContextKeys } from "./contextKeys";
import type { OverlayId } from "../stores/slices/overlaySlice";
import type { PaletteMode } from "../components/palette/modes";
import type { Shortcut } from "./shortcuts";

/**
 * Everything a command needs to decide whether it applies and to do its work.
 *
 * This is the app's answer to VS Code's "when clause" context keys, minus the
 * expression language: predicates are plain functions closing over this
 * object, so the existing store selectors *are* the query language.
 */
export interface CommandContext {
  /** Live store state, read at evaluation time. */
  store: ReviewStore;
  /** Facts contributed by whichever components own them. */
  keys: ContextKeys;
  /** Imperative UI affordances the store does not own. */
  ui: CommandUi;
}

/**
 * Actions a mounted component has to contribute, because they close over
 * routing or native-window concerns the store does not own.
 */
export interface ProvidedCommandUi {
  openRepo(): void;
  navigate(to: string): void;
  closeTab(): void;
  refresh(): void;
  /**
   * Switch the app to the review row identified by repo + ref, the same way
   * clicking its sidebar row would. What terminal jumps use to land on a shell
   * that lives under a row other than the one being viewed.
   */
  activateReviewKey(repoPath: string, ref: string): void;
}

/**
 * Actions that need nothing but the store, so they are always available.
 */
export interface StoreCommandUi {
  /** Raise one of the app's overlays; opening one closes any other. */
  openOverlay(id: OverlayId): void;
  /** Raise the palette in a given search mode. */
  openPalette(mode: PaletteMode): void;
  restartLsp(): void;
  zoom(direction: "in" | "out" | "reset"): void;
}

/**
 * The two halves together.
 *
 * Split structurally rather than by naming the provider-backed keys in an
 * `Omit`: with a literal key list, a new store-backed method that nobody
 * remembers to exclude silently becomes provider-only and no-ops forever.
 */
export type CommandUi = ProvidedCommandUi & StoreCommandUi;

export interface Command {
  /** Stable identifier, also the key the native menu is built against. */
  id: string;
  title: string;
  /** Section heading in the palette, e.g. "Review", "Go", "View". */
  category: string;
  /**
   * Alternate words a user might type. Superhuman's observation: people search
   * "archive" for a command called "Mark Done".
   */
  keywords?: string[];
  shortcut?: Shortcut;
  /**
   * Hidden entirely when this returns false. Use for commands that make no
   * sense in the current context at all.
   */
  isVisible?: (ctx: CommandContext) => boolean;
  /**
   * Listed but inert when this returns false. Use when the command is worth
   * knowing about even where it cannot run right now — hiding it makes the
   * palette feel like it forgot the feature exists.
   */
  isEnabled?: (ctx: CommandContext) => boolean;
  /**
   * Whether this command's keyboard shortcut should fire while a text input
   * has focus. Defaults to false, which is right for the single-key bindings.
   */
  allowInInput?: boolean;
  /**
   * Whether the shortcut should fire while a terminal pane has focus.
   * Defaults to false — the terminal owns most keystrokes.
   */
  allowInTerminal?: boolean;
  run: (ctx: CommandContext) => void | Promise<void>;
}

/** A command paired with its evaluated availability. */
export interface ResolvedCommand {
  command: Command;
  enabled: boolean;
}
