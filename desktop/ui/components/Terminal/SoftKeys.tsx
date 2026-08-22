import { type ReactNode, useEffect, useSyncExternalStore } from "react";
import { clsx } from "clsx";
import { sendKey } from "./registry";
import {
  clearCtrl,
  isCtrlArmed,
  subscribeSoftKeys,
  toggleCtrl,
} from "./soft-keys";

/**
 * The phone's terminal keys: what a software keyboard cannot send.
 *
 * A row rather than a keyboard accessory, because the accessory bar is the
 * system keyboard's and only exists while that keyboard is up — half of these
 * (Esc, the arrows, ⌃C by way of ⌃ and a letter) are exactly what you reach for
 * while *reading* a running agent, with no keyboard on screen at all. Sitting
 * in the panel means they are always there, and the terminal above simply gets
 * one row shorter.
 *
 * Compact only. At desktop width every one of these is a real key on a real
 * keyboard, and a row of buttons restating them would be furniture.
 *
 * Each key keeps focus where it is: `onPointerDown`'s default is what would
 * move focus to the button, and on iOS moving focus out of the terminal's
 * textarea dismisses the keyboard mid-sentence.
 */
export function SoftKeys({ terminalId }: { terminalId: string }): ReactNode {
  const ctrl = useSyncExternalStore(subscribeSoftKeys, isCtrlArmed);

  // A modifier armed for one shell is not armed for the next one: switching
  // tabs (or leaving the terminal half) drops it, rather than applying it to
  // the first thing typed somewhere else.
  useEffect(() => clearCtrl, [terminalId]);

  return (
    <div
      className="flex shrink-0 items-stretch gap-1 border-t border-t-edge/40 px-1 py-1"
      role="group"
      aria-label="Terminal keys"
    >
      <Key label="esc" onPress={() => sendKey(terminalId, "Escape")} />
      <Key
        label="ctrl"
        title="Control — applies to the next key you type"
        pressed={ctrl}
        onPress={toggleCtrl}
      />
      <Key label="⇥" title="Tab" onPress={() => sendKey(terminalId, "Tab")} />
      <Key
        label="⇧⇥"
        title="Shift-Tab"
        onPress={() => sendKey(terminalId, "Tab", { shift: true })}
      />
      <Key label="←" onPress={() => sendKey(terminalId, "left")} />
      <Key label="↓" onPress={() => sendKey(terminalId, "down")} />
      <Key label="↑" onPress={() => sendKey(terminalId, "up")} />
      <Key label="→" onPress={() => sendKey(terminalId, "right")} />
    </div>
  );
}

/**
 * One key. Thumb-sized by the row rather than by its glyph, and repeatable —
 * `onPointerDown` rather than `onClick`, so holding an arrow through a menu
 * feels like a key and not like a form control.
 */
function Key({
  label,
  title,
  pressed,
  onPress,
}: {
  label: string;
  title?: string;
  pressed?: boolean;
  onPress: () => void;
}): ReactNode {
  return (
    <button
      type="button"
      title={title ?? label}
      aria-label={title ?? label}
      aria-pressed={pressed}
      onPointerDown={(e) => {
        // Keep the shell focused: the keyboard must not drop out from under a
        // key that exists to be used alongside it.
        e.preventDefault();
        onPress();
      }}
      // A pointer never gets here — its default was prevented above, so no
      // click follows. This is the keyboard's way in (`detail` is 0 for a
      // click synthesized from Enter or Space).
      onClick={(e) => {
        if (e.detail === 0) onPress();
      }}
      className={clsx(
        `min-h-9 flex-1 rounded-md font-mono text-sm leading-none
         transition-colors select-none`,
        pressed
          ? "bg-fg/20 text-fg"
          : "bg-fg/[0.06] text-fg-muted active:bg-fg/[0.14]",
      )}
    >
      {label}
    </button>
  );
}
