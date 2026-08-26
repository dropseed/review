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
 *
 * Exported because the compose box's Send sits in the same thumb zone and has
 * to make the same bargain with focus; `variant: "accent"` is the one that
 * commits something rather than sending a keystroke, and is sized by its label
 * instead of sharing the row's width.
 */
export function Key({
  label,
  title,
  ariaLabel,
  pressed,
  disabled,
  variant = "key",
  onPress,
}: {
  label: string;
  title?: string;
  /** When the accessible name differs from the tooltip. Defaults to the tooltip. */
  ariaLabel?: string;
  pressed?: boolean;
  disabled?: boolean;
  variant?: "key" | "accent";
  onPress: () => void;
}): ReactNode {
  const press = () => {
    if (!disabled) onPress();
  };
  return (
    <button
      type="button"
      title={title ?? label}
      aria-label={ariaLabel ?? title ?? label}
      aria-pressed={pressed}
      disabled={disabled}
      onPointerDown={(e) => {
        // Keep the shell focused: the keyboard must not drop out from under a
        // key that exists to be used alongside it.
        e.preventDefault();
        press();
      }}
      // A pointer never gets here — its default was prevented above, so no
      // click follows. This is the keyboard's way in (`detail` is 0 for a
      // click synthesized from Enter or Space).
      onClick={(e) => {
        if (e.detail === 0) press();
      }}
      className={clsx(
        // 44px tall outright rather than bought with slop: these sit in a row
        // whose keys are each other's neighbours, so there is nowhere to spill.
        "tap min-h-11 rounded-md text-sm leading-none select-none",
        variant === "accent"
          ? "shrink-0 px-3 font-semibold"
          : "flex-1 font-mono",
        disabled
          ? "bg-fg/[0.06] text-fg-faint"
          : variant === "accent"
            ? "bg-sage-500 text-surface active:bg-sage-600"
            : pressed
              ? "bg-fg/20 text-fg"
              : "bg-fg/[0.06] text-fg-muted active:bg-fg/[0.14]",
      )}
    >
      {label}
    </button>
  );
}
