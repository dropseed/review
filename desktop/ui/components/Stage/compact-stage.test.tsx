import { vi, describe, it, expect, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

vi.mock("../../api", () => ({
  getApiClient: () => new Proxy({}, { get: () => () => undefined }),
}));
vi.mock("../../platform", () => ({
  getPlatformServices: () => ({
    storage: new Proxy({}, { get: () => () => undefined }),
    window: { getPlatformName: () => "macos" },
  }),
}));

import { CompactStage } from "./CompactStage";
import { TooltipProvider } from "../ui/tooltip";
import { useSpurStore } from "../../stores";

/** jsdom answers no media query on its own, and this tree asks two. */
function stubMatchMedia(reducedMotion = false): void {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: reducedMotion && query.includes("reduced-motion"),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
  });
}

function show(docked = true) {
  render(
    <TooltipProvider>
      <CompactStage docked={docked}>
        <div data-testid="code-half">the diff</div>
      </CompactStage>
    </TooltipProvider>,
  );
}

beforeEach(() => stubMatchMedia());

afterEach(() => {
  cleanup();
  useSpurStore.setState({
    terminalTabs: [],
    terminalSessions: {},
    activeTabId: null,
    contentFocus: "split",
    workspaces: [],
    focusedWorkspaceId: null,
  });
  vi.clearAllMocks();
});

describe("the compact navigation stack", () => {
  /**
   * The whole point of the restructure: the phone's home screen is the
   * terminal, and the code half is a screen you push onto it.
   */
  it("keeps the terminal mounted while the code half is pushed over it", () => {
    useSpurStore.setState({ contentFocus: "code" });
    show();

    // The terminal panel's own strip is proof it is still rendered — an
    // unmounted xterm loses its screen, so a push must never be a swap.
    expect(screen.getByLabelText("New terminal tab")).toBeDefined();
    expect(screen.getByTestId("code-half")).toBeDefined();
  });

  /** Popped, the code screen is off to the right and out of reach. */
  it("makes the popped code screen inert, and the pushed one live", () => {
    useSpurStore.setState({ contentFocus: "split" });
    show();

    const popped = screen.getByTestId("code-half").parentElement;
    expect(popped?.hasAttribute("inert")).toBe(true);

    cleanup();
    useSpurStore.setState({ contentFocus: "code" });
    show();

    const pushed = screen.getByTestId("code-half").parentElement;
    expect(pushed?.hasAttribute("inert")).toBe(false);
  });

  /**
   * With no terminal half there is nothing underneath: the code half is simply
   * the screen, and drawing it as a push would promise a back that goes nowhere.
   */
  it("draws the code half flat when there is no terminal to push over", () => {
    useSpurStore.setState({ contentFocus: "code" });
    show(false);

    expect(screen.queryByLabelText("New terminal tab")).toBeNull();
    expect(
      screen.getByTestId("code-half").parentElement?.className,
    ).not.toMatch(/nav-push/);
  });

  /**
   * Asked for no motion, the screen changes without sliding — and the terminal
   * behind it is left where it is rather than parallaxed a little way off.
   */
  it("crossfades instead of sliding under reduced motion", () => {
    stubMatchMedia(true);
    useSpurStore.setState({ contentFocus: "split" });
    show();

    const popped = screen.getByTestId("code-half").parentElement;
    expect(popped?.className).toMatch(/nav-crossfade/);
    expect(popped?.className).not.toMatch(/nav-push/);
    expect(popped?.className).toMatch(/opacity-0/);
    // No inline transform to slide with, in either direction.
    expect(popped?.style.transform).toBe("");
  });
});
