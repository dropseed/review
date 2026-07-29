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
const sources = new Set<readonly Command[]>();
const listeners = new Set<() => void>();

let snapshot: Command[] = [];

function rebuild(): void {
  const byId = new Map<string, Command>();
  for (const source of sources) {
    for (const command of source) {
      // Last registration wins, so a mounted panel can specialize a command
      // the base set defines.
      byId.set(command.id, command);
    }
  }
  snapshot = [...byId.values()];
  for (const listener of listeners) listener();
}

/** Add commands to the registry. Returns a disposer. */
export function registerCommands(commands: readonly Command[]): () => void {
  sources.add(commands);
  rebuild();
  return () => {
    sources.delete(commands);
    rebuild();
  };
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Every registered command, regardless of context. Safe outside React. */
export function getAllCommands(): Command[] {
  return snapshot;
}

/** Every registered command, re-rendering when the registry changes. */
export function useAllCommands(): Command[] {
  return useSyncExternalStore(subscribe, getAllCommands, getAllCommands);
}

/**
 * Register commands for as long as the calling component is mounted.
 *
 * `commands` must be stable (a module constant, or memoized) — it is the
 * registry key.
 */
export function useRegisterCommands(commands: readonly Command[]): void {
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
  return snapshot.find((command) => command.id === id);
}

/** Test seam: drop every registration. */
export function resetRegistry(): void {
  sources.clear();
  rebuild();
}
