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

describe("useMouseNavigation", () => {
  it("does not navigate while a dialog is open, but does once it closes", () => {
    useReviewStore.getState().recordFileVisit("a.ts");
    useReviewStore.getState().recordFileVisit("b.ts");
    renderHook(() => useMouseNavigation());

    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    document.body.appendChild(dialog);

    navigate(3);

    expect(useReviewStore.getState().fileNavIndex).toBe(1);

    dialog.remove();
    navigate(3);

    expect(useReviewStore.getState().selectedFile).toBe("a.ts");
  });
});
