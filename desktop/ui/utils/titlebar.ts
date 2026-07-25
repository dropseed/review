import { isTauriEnvironment } from "../api/client";
import { getPlatformServices } from "../platform";

/**
 * On macOS the app draws its own header inside the window's title bar (the
 * window is built with `titleBarStyle: "Overlay"`), so content starts at y=0
 * and the traffic lights float over the top-left corner.
 *
 * That is a fact about the window, not about any one component, so it is
 * published once as CSS custom properties: any surface that reaches the top of
 * the window keeps clear of the title bar with a plain `var()`, and gets it
 * right by default instead of having to know the mode exists. Both properties
 * are `0px` everywhere else (web mode, non-macOS), so the same styles collapse
 * to no offset with no branching.
 */

/** Height of the overlay title bar strip, in px. */
const TITLE_BAR_HEIGHT = 28;

/** Width to keep clear on the left for the traffic lights, in px. */
const TRAFFIC_LIGHT_WIDTH = 78;

/** Whether this window has the overlay title bar (macOS desktop only). */
function hasOverlayTitleBar(): boolean {
  return (
    isTauriEnvironment() &&
    getPlatformServices().window.getPlatformName() === "macos"
  );
}

/**
 * Publish the title-bar geometry on `<html>`. Call once at boot, before first
 * paint — the values never change for the life of a window.
 */
export function applyTitleBarLayout(): void {
  const overlay = hasOverlayTitleBar();
  const root = document.documentElement;
  root.style.setProperty(
    "--title-bar-height",
    overlay ? `${TITLE_BAR_HEIGHT}px` : "0px",
  );
  root.style.setProperty(
    "--traffic-light-inset",
    overlay ? `${TRAFFIC_LIGHT_WIDTH}px` : "0px",
  );
}
