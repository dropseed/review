import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { renderHook, cleanup, act } from "@testing-library/react";

vi.mock("../api", () => ({
  getApiClient: () =>
    new Proxy({}, { get: () => () => Promise.resolve(undefined) }),
}));
vi.mock("../platform", () => ({
  getPlatformServices: () => ({
    storage: new Proxy({}, { get: () => () => undefined }),
  }),
}));

import { useReviewStore } from "../stores";
import { useMouseNavigation } from "./useMouseNavigation";

function fireButton(type: "mousedown" | "mouseup", button: number) {
  window.dispatchEvent(new MouseEvent(type, { button }));
}

function navigate(button: number) {
  act(() => {
    fireButton("mousedown", button);
    fireButton("mouseup", button);
  });
}

beforeEach(() => {
  useReviewStore.setState({
    fileNavHistory: [],
    fileNavIndex: -1,
    selectedFile: null,
    filesByPath: {},
    repoPath: null,
    comparison: null,
  });
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

function appendNode(attrs: Record<string, string>) {
  const node = document.createElement("div");
  for (const [key, value] of Object.entries(attrs))
    node.setAttribute(key, value);
  document.body.appendChild(node);
  return node;
}

describe("useMouseNavigation", () => {
  it("does not navigate while an open modal dialog is present, but does once it closes", () => {
    useReviewStore.getState().recordFileVisit("a.ts");
    useReviewStore.getState().recordFileVisit("b.ts");
    renderHook(() => useMouseNavigation());

    const dialog = appendNode({
      role: "dialog",
      "aria-modal": "true",
      "data-state": "open",
    });

    navigate(3);

    expect(useReviewStore.getState().fileNavIndex).toBe(1);

    dialog.remove();
    navigate(3);

    expect(useReviewStore.getState().selectedFile).toBe("a.ts");
  });

  it("still navigates while a non-modal popover is open (shares role=dialog but no aria-modal)", () => {
    useReviewStore.getState().recordFileVisit("a.ts");
    useReviewStore.getState().recordFileVisit("b.ts");
    renderHook(() => useMouseNavigation());

    appendNode({ role: "dialog", "data-state": "open" });

    navigate(3);

    expect(useReviewStore.getState().selectedFile).toBe("a.ts");
  });

  it("still navigates once a dialog's close animation finishes (data-state=closed)", () => {
    useReviewStore.getState().recordFileVisit("a.ts");
    useReviewStore.getState().recordFileVisit("b.ts");
    renderHook(() => useMouseNavigation());

    appendNode({
      role: "dialog",
      "aria-modal": "true",
      "data-state": "closed",
    });

    navigate(3);

    expect(useReviewStore.getState().selectedFile).toBe("a.ts");
  });
});
