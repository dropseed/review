import { APP_COMMANDS } from "./appCommands";
import { WORKSPACE_COMMANDS } from "./workspaceCommands";
import { TERMINAL_COMMANDS } from "../components/Terminal/commands";
import type { Command } from "./types";

/**
 * Every command that exists without asking the store — the app's own, the
 * terminal's, and the queue's ⌘N.
 *
 * Enumerated once because two things must agree on it and neither can see the
 * other: the shell registers this list, and `menuParity.test.ts` resolves the
 * native menu against it. A fourth list registered but forgotten in the test
 * would fail *open* — its accelerators free to drift from the Rust menu with
 * nothing turning red.
 *
 * The per-workspace ⌘1–9 commands are deliberately absent: they are built from
 * the live queue by `workspaceCommands()`, so no menu can ever name one.
 */
export const STATIC_COMMANDS: readonly Command[] = [
  ...APP_COMMANDS,
  ...TERMINAL_COMMANDS,
  ...WORKSPACE_COMMANDS,
];
