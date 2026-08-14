import { useEffect, useState } from "react";
import { IS_MAC } from "../commands/shortcuts";

/**
 * Whether the `mod` key is being held right now — ⌘ on Apple platforms, Ctrl
 * everywhere else.
 *
 * `mod`, not `metaKey`, because that is what the shortcuts this answers for are
 * written in (`{ code: "Digit1", mod: true }`) and what `matchesEvent` resolves
 * them against. Reading `metaKey` directly inverted the affordance off macOS:
 * the digits stayed hidden under the key that fires them and appeared under
 * Super, which fires nothing.
 *
 * For surfaces that can answer "what would ⌘3 do" while the finger is already
 * on the key — the queue reveals each card's number, so the digits are read at
 * the moment they are useful and are absent the rest of the time.
 *
 * One listener at the window for however many consumers, because the thing
 * being watched is a global: dozens of cards each subscribing to the same key
 * would be dozens of handlers run on every keystroke typed anywhere in the app.
 * Consumers take the boolean as a prop instead.
 *
 * Held is read off the modifier flag rather than by matching the key name, so a
 * chord that starts with mod and goes on to press something else keeps the
 * state up. Every way the key can stop being held without a `keyup` arriving is
 * covered: ⌘Tab moves the window out from under the release, and a chord that
 * opens a native menu can swallow it too — so window blur and a hidden document
 * both clear, on the principle that "not sure" must resolve to "not held".
 */
export function useModHeld(): boolean {
  const [held, setHeld] = useState(false);

  useEffect(() => {
    // React bails out on an identical value, so the keystrokes that don't
    // change the answer — every character typed while nothing is held — cost a
    // comparison rather than a render.
    const sync = (event: KeyboardEvent) =>
      setHeld(IS_MAC ? event.metaKey : event.ctrlKey);
    const clear = () => setHeld(false);

    window.addEventListener("keydown", sync);
    window.addEventListener("keyup", sync);
    window.addEventListener("blur", clear);
    document.addEventListener("visibilitychange", clear);
    return () => {
      window.removeEventListener("keydown", sync);
      window.removeEventListener("keyup", sync);
      window.removeEventListener("blur", clear);
      document.removeEventListener("visibilitychange", clear);
    };
  }, []);

  return held;
}
