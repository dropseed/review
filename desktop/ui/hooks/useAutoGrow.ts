import { useLayoutEffect, type RefObject } from "react";

/**
 * Grow a textarea with its content, up to a cap in pixels.
 *
 * A textarea has no CSS way to size itself to its text, so the height is
 * cleared and re-set from `scrollHeight` — which is only the content's height
 * once the element is back at `auto`. Past `maxPx` it stops growing and starts
 * scrolling, which is the browser's own behaviour for a fixed-height box.
 *
 * `value` is what the measurement is taken *after*: programmatic changes (a
 * streamed commit message, a restored draft) fire no `input` event, so the
 * value the component already re-rendered on is the honest trigger. In a layout
 * effect rather than an ordinary one, so the box is never painted at the wrong
 * height first.
 *
 * A non-positive `maxPx` means "not measured yet" and grows uncapped for that
 * frame — a caller measuring its own cap gets one render before the answer.
 */
export function useAutoGrow(
  ref: RefObject<HTMLTextAreaElement | null>,
  maxPx: number,
  value: string,
): void {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${maxPx > 0 ? Math.min(el.scrollHeight, maxPx) : el.scrollHeight}px`;
  }, [ref, maxPx, value]);
}
