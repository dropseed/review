import { useState, useEffect } from "react";

/**
 * Tracks whether the Cmd (Meta) key is currently held down.
 * Handles keydown, keyup, and blur (in case key release happens while window is unfocused).
 */
export function useCmdKeyHeld(): boolean {
  const [held, setHeld] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Meta") setHeld(true);
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === "Meta") setHeld(false);
    };
    const handleBlur = () => setHeld(false);

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", handleBlur);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", handleBlur);
    };
  }, []);

  return held;
}
