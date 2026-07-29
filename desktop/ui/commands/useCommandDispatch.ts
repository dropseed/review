import { useEffect } from "react";
import { useReviewStore } from "../stores";
import { focusedTerminalId } from "../components/Terminal/close";
import { getCommandUi } from "./host";
import { getAllCommands } from "./registry";
import { matchesEvent } from "./shortcuts";
import type { CommandContext } from "./types";

/** Build the context a command is evaluated and run against, right now. */
export function buildCommandContext(): CommandContext {
  return {
    store: useReviewStore.getState(),
    terminalFocused: focusedTerminalId() !== null,
    ui: getCommandUi(),
  };
}

/** Whether the event landed in something the user is typing into. */
export function isTextEntry(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

/**
 * Dispatch keyboard shortcuts from the command registry.
 *
 * This is the only place a shortcut is turned into an action. The native menu
 * contributes the same commands' accelerators on desktop, but dispatch happens
 * here in both targets — which is also what makes the shortcuts work in web
 * mode, where there is no native menu to fire them.
 *
 * Precedence, which the previous hand-rolled handler encoded positionally:
 *
 * 1. A focused terminal owns the keystroke unless the command opts in with
 *    `allowInTerminal`. Checked before the text-entry guard because focus
 *    inside a terminal *is* focus inside xterm's textarea.
 * 2. Any other text entry swallows the keystroke unless the command opts in
 *    with `allowInInput`.
 * 3. The command's own visibility and enablement predicates.
 */
export function useCommandDispatch(): void {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Context is built lazily, after a shortcut matches. It costs a DOM
      // ancestor walk for the terminal-focus check plus a fresh action object,
      // and the overwhelming majority of keystrokes are someone typing.
      let ctx: CommandContext | null = null;

      for (const command of getAllCommands()) {
        if (!command.shortcut) continue;
        if (!matchesEvent(command.shortcut, event)) continue;

        ctx ??= buildCommandContext();

        if (ctx.terminalFocused) {
          if (!command.allowInTerminal) continue;
        } else if (isTextEntry(event.target) && !command.allowInInput) {
          continue;
        }

        if (command.isVisible && !command.isVisible(ctx)) continue;
        if (command.isEnabled && !command.isEnabled(ctx)) continue;

        event.preventDefault();
        void command.run(ctx);
        return;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);
}
