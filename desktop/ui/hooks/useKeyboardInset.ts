import { useEffect } from "react";

/**
 * Anything below this is the browser's own chrome moving, not a keyboard.
 *
 * iOS shrinks and grows its toolbars as you scroll, which moves the visual
 * viewport by tens of pixels; a software keyboard is hundreds. Treating the
 * former as a keyboard would resize the layout on every flick.
 */
const KEYBOARD_MIN_PX = 120;

/** The property the shell and the bottom bars read. */
const PROPERTY = "--keyboard-inset";

/**
 * Publish how much of the window a software keyboard is covering, as
 * `--keyboard-inset` on the root element.
 *
 * iOS does not resize the layout viewport when its keyboard opens — it leaves
 * the page the same height and scrolls the focused element into view. A
 * full-height app therefore keeps drawing its bottom rows underneath the
 * keyboard, which on this app is exactly the row of terminal keys you opened
 * the keyboard to use, plus the bar that switches halves. The visual viewport
 * is the only thing that knows, so it is asked.
 *
 * A custom property rather than React state, the way the UI scale and the theme
 * publish their measured pixels: the answer changes many times through a
 * keyboard's open and close animation, and every one of those would otherwise
 * re-render the whole app shell to move one number that only CSS consumes.
 * Reads are coalesced into a frame for the same reason.
 *
 * Silent everywhere the question doesn't arise — no `visualViewport` (jsdom,
 * old browsers), or nothing covering anything, in which case the property is
 * `0px` and every `calc` against it is the layout that was there before.
 */
export function useKeyboardInset(): void {
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;

    let frame: number | null = null;
    let published = -1;

    const publish = () => {
      frame = null;
      // `offsetTop` counts the part iOS has scrolled the visual viewport down
      // by, which is covered from the layout's point of view just as surely.
      const covered = window.innerHeight - viewport.height - viewport.offsetTop;
      const inset = covered > KEYBOARD_MIN_PX ? Math.round(covered) : 0;
      if (inset === published) return;
      published = inset;
      document.documentElement.style.setProperty(PROPERTY, `${inset}px`);
      // The same fact as a boolean, for the CSS that can't do arithmetic with
      // it: `--safe-bottom` collapses to zero while the keyboard is up, because
      // the home indicator it clears is not on screen then and its inset would
      // be a strip of dead surface floating above the keys. See index.css.
      if (inset > 0) document.documentElement.dataset.keyboard = "open";
      else delete document.documentElement.dataset.keyboard;
    };

    const schedule = () => {
      if (frame === null) frame = requestAnimationFrame(publish);
    };

    viewport.addEventListener("resize", schedule);
    viewport.addEventListener("scroll", schedule);
    publish();
    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
      viewport.removeEventListener("resize", schedule);
      viewport.removeEventListener("scroll", schedule);
      document.documentElement.style.removeProperty(PROPERTY);
      delete document.documentElement.dataset.keyboard;
    };
  }, []);
}
