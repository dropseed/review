import { vi, describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

const { renameWorkspace } = vi.hoisted(() => ({
  renameWorkspace: vi.fn().mockResolvedValue([]),
}));

vi.mock("../../api", () => ({
  getApiClient: () => ({
    listWorkspaces: vi.fn().mockResolvedValue([]),
    renameWorkspace,
  }),
}));

import { WorkspaceTitleInput } from "./WorkspaceTitleInput";
import { useSpurStore } from "../../stores";
import { attachment, workspace } from "../../test/fixtures";

function show(title: string | null) {
  useSpurStore.setState({
    workspaces: [
      workspace("w", { title, attachments: [attachment("/repo", "main")] }),
    ],
  });
  render(
    <WorkspaceTitleInput workspaceId="w" title={title} onDone={() => {}} />,
  );
  return screen.getByRole("textbox") as HTMLInputElement;
}

afterEach(() => {
  cleanup();
  useSpurStore.setState({ workspaces: [] });
  vi.clearAllMocks();
});

describe("renaming a workspace", () => {
  /**
   * A derived title is not something the human typed, so the box starts empty
   * — prefilling it would turn every rename into a commitment to whatever the
   * title happens to derive from today.
   */
  it("prefills from the raw title, not the derived one", () => {
    expect(show(null).value).toBe("");
    cleanup();
    expect(show("Ship the thing").value).toBe("Ship the thing");
  });

  it("saves what was typed", async () => {
    const input = show(null);
    fireEvent.change(input, { target: { value: "  Ship it  " } });
    fireEvent.keyDown(input, { key: "Enter" });

    await vi.waitFor(() =>
      expect(renameWorkspace).toHaveBeenCalledWith("w", "Ship it"),
    );
  });

  /** Clearing the box is the way back to a title that follows the work. */
  it("clears to a derived title when emptied", async () => {
    const input = show("Ship the thing");
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.keyDown(input, { key: "Enter" });

    await vi.waitFor(() =>
      expect(renameWorkspace).toHaveBeenCalledWith("w", null),
    );
  });

  it("writes nothing when a derived title is left alone", () => {
    const input = show(null);
    fireEvent.keyDown(input, { key: "Enter" });
    expect(renameWorkspace).not.toHaveBeenCalled();
  });

  it("restores on Escape", () => {
    const input = show("Ship the thing");
    fireEvent.change(input, { target: { value: "something else" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(renameWorkspace).not.toHaveBeenCalled();
  });
});
