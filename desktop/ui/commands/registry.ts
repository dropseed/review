import { useEffect, useSyncExternalStore } from "react";
import type { Command, CommandContext, ResolvedCommand } from "./types";

/**
 * The app's command registry.
 *
 * Deliberately a standalone module rather than another Zustand slice: a
 * command's predicates take the store as input, so putting the registry
 * *inside* the store would make its type refer to itself. Keeping it beside
 * the store avoids that and leaves the 18-slice store untouched.
 *
 * Contribution is open — anything can add commands, including a panel that
 * registers its own only while it is mounted (see `useRegisterCommands`).
 */
/**
 * A fixed list, or a function producing one from current state.
 *
 * The dynamic form is what lets things that are really *data* be commands —
 * one per open review, say — so they are findable by typing rather than
 * reachable only through a positional shortcut.
 */
export type CommandSource = readonly Command[] | (() => readonly Command[]);

const sources = new Set<CommandSource>();
const listeners = new Set<() => void>();

/** Bumped whenever the set of registrations changes, for React subscribers. */
let version = 0;

function notify(): void {
  version++;
  for (const listener of listeners) listener();
}

/** Add commands to the registry. Returns a disposer. */
export function registerCommands(commands: CommandSource): () => void {
  sources.add(commands);
  notify();
  return () => {
    sources.delete(commands);
    notify();
  };
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Every registered command, expanded from current state.
 *
 * Returns a fresh array — dynamic sources are evaluated on each call, which is
 * the point. Callers that render must therefore re-render on their own signal
 * ({@link useCommandRegistryVersion} for registrations, store subscription for
 * everything else) rather than relying on this to be referentially stable.
 */
export function getAllCommands(): Command[] {
  const byId = new Map<string, Command>();
  for (const source of sources) {
    for (const command of typeof source === "function" ? source() : source) {
      // Last registration wins, so a mounted panel can specialize a command
      // the base set defines.
      byId.set(command.id, command);
    }
  }
  return [...byId.values()];
}

function getVersion(): number {
  return version;
}

/** Re-render when commands are registered or unregistered. */
export function useCommandRegistryVersion(): number {
  return useSyncExternalStore(subscribe, getVersion, getVersion);
}

/**
 * Register commands for as long as the calling component is mounted.
 *
 * `commands` must be stable (a module constant, or memoized) — it is the
 * registry key.
 */
export function useRegisterCommands(commands: CommandSource): void {
  useEffect(() => registerCommands(commands), [commands]);
}

/**
 * Filter and annotate the registry for the current context.
 *
 * Visibility removes a command from the list; enablement leaves it listed but
 * inert. The distinction is VS Code's, and it is load-bearing: hiding a
 * command the user knows exists reads as the feature having disappeared.
 */
export function resolveCommands(
  commands: readonly Command[],
  ctx: CommandContext,
): ResolvedCommand[] {
  const resolved: ResolvedCommand[] = [];
  for (const command of commands) {
    if (command.isVisible && !command.isVisible(ctx)) continue;
    resolved.push({
      command,
      enabled: command.isEnabled ? command.isEnabled(ctx) : true,
    });
  }
  return resolved;
}

/** Look up a single command by id. */
export function findCommand(id: string): Command | undefined {
  return getAllCommands().find((command) => command.id === id);
}

/** Test seam: drop every registration. */
export function resetRegistry(): void {
  sources.clear();
  notify();
}
