import { useEffect, useRef, useState } from "react";

interface HoverOpen {
  open: boolean;
  /** Immediate override — click-toggles and dismissals route through here. */
  setOpen: (open: boolean) => void;
  /** Spread onto the trigger AND the floating content, so moving the pointer
   *  from one to the other doesn't count as leaving. */
  hoverProps: {
    onPointerEnter: () => void;
    onPointerLeave: () => void;
  };
}

/**
 * Popover-on-hover for surfaces that also open on click. Radix's Tooltip can't
 * be used where the floating content is interactive, and its Popover is
 * click-only — this fills the gap: enter opens after a beat (a pointer passing
 * through shouldn't flash panels), leave closes after a shorter one (crossing
 * the gap to the content shouldn't lose it).
 */
export function useHoverOpen(openDelay = 350, closeDelay = 200): HoverOpen {
  const [open, setOpenState] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clear = () => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  };

  useEffect(() => clear, []);

  // Not memoized: `hoverProps` is a fresh object every render regardless, and
  // these land on plain DOM elements, which never observe identity.
  const setOpen = (next: boolean): void => {
    clear();
    setOpenState(next);
  };

  const onPointerEnter = (): void => {
    clear();
    timer.current = setTimeout(() => setOpenState(true), openDelay);
  };

  const onPointerLeave = (): void => {
    clear();
    timer.current = setTimeout(() => setOpenState(false), closeDelay);
  };

  return { open, setOpen, hoverProps: { onPointerEnter, onPointerLeave } };
}
