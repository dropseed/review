import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, render, cleanup } from "@testing-library/react";
import type { DiffHunk } from "../../types";

vi.mock("../../api", () => ({
  getApiClient: () => new Proxy({}, { get: () => () => undefined }),
}));
vi.mock("../../platform", () => ({
  getPlatformServices: () => ({
    storage: new Proxy({}, { get: () => () => undefined }),
    window: { getPlatformName: () => "macos" },
  }),
}));

import {
  FileSelectionProvider,
  FilesPanelProvider,
  useFileSelection,
} from "./FilesPanelContext";
import { useSpurStore } from "../../stores";

function hunk(filePath: string, hash: string): DiffHunk {
  return {
    id: `${filePath}:${hash}`,
    filePath,
    oldStart: 1,
    oldCount: 1,
    newStart: 1,
    newCount: 1,
    content: "",
    lines: [],
    contentHash: hash,
  };
}

function setDiff(files: Record<string, DiffHunk[]>) {
  useSpurStore.setState({
    filesByPath: Object.fromEntries(
      Object.entries(files).map(([path, hunks]) => [
        path,
        { hunks, contentHash: hunks.map((h) => h.id).join("|") },
      ]),
    ),
    flatFileList: Object.keys(files),
  } as never);
}

const ORDER = ["a.ts", "b.ts"];
const CLICK = { shiftKey: false, metaKey: true, ctrlKey: false };

/** Render the provider and hand back its context so a test can click rows. */
function mount() {
  let api!: ReturnType<typeof useFileSelection>;
  function Probe() {
    api = useFileSelection();
    return null;
  }
  render(
    <FilesPanelProvider value={{ handleSelectFile: () => {} } as never}>
      <FileSelectionProvider>
        <Probe />
      </FileSelectionProvider>
    </FilesPanelProvider>,
  );
  return () => api;
}

beforeEach(() => {
  cleanup();
  useSpurStore.setState({
    adhocGroup: null,
    guideContentMode: null,
    comparison: null,
  } as never);
  setDiff({ "a.ts": [hunk("a.ts", "old")], "b.ts": [hunk("b.ts", "1")] });
});

describe("FileSelectionProvider rolling diff", () => {
  it("opens the selection's hunks as a rolling diff", () => {
    const api = mount();
    act(() => {
      api().handleRowClick("a.ts", ORDER, CLICK, "needs-review");
    });
    act(() => {
      api().handleRowClick("b.ts", ORDER, CLICK, "needs-review");
    });

    const state = useSpurStore.getState();
    expect(state.guideContentMode).toBe("adhoc-group");
    expect(state.adhocGroup?.hunkIds).toEqual(["a.ts:old", "b.ts:1"]);
  });

  it("follows the live hunks when a selected file is re-diffed", () => {
    const api = mount();
    act(() => {
      api().handleRowClick("a.ts", ORDER, CLICK, "needs-review");
    });
    act(() => {
      api().handleRowClick("b.ts", ORDER, CLICK, "needs-review");
    });

    // Editing a.ts retires every id it had — a snapshot taken at click time
    // would silently drop the file out of the rolling diff (and out of that
    // diff's "Approve all") while its row stayed selected.
    act(() => {
      setDiff({ "a.ts": [hunk("a.ts", "new")], "b.ts": [hunk("b.ts", "1")] });
    });

    expect(useSpurStore.getState().adhocGroup?.hunkIds).toEqual([
      "a.ts:new",
      "b.ts:1",
    ]);
    // And the two approve paths still agree about what's selected.
    expect(useSpurStore.getState().adhocGroup?.hunkIds).toEqual(
      ["a.ts", "b.ts"].flatMap(
        (p) =>
          useSpurStore.getState().filesByPath[p]?.hunks.map((h) => h.id) ?? [],
      ),
    );
  });

  it("leaves someone else's rolling diff alone", () => {
    const api = mount();
    act(() => {
      api().handleRowClick("a.ts", ORDER, CLICK, "needs-review");
    });
    act(() => {
      api().handleRowClick("b.ts", ORDER, CLICK, "needs-review");
    });

    const other = { title: "Guide group", hunkIds: ["a.ts:old"] };
    act(() => {
      useSpurStore.getState().openAdhocGroup(other);
    });
    act(() => {
      setDiff({ "a.ts": [hunk("a.ts", "new")], "b.ts": [hunk("b.ts", "1")] });
    });

    expect(useSpurStore.getState().adhocGroup).toBe(other);
  });
});
