import { vi, describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import type { RepoChoice } from "./repo-choices";

const { choices } = vi.hoisted(() => ({ choices: { current: [] as never[] } }));

// The picker's job is the search, the ordering and the keyboard; where the
// repos come from is the sidebar tree's, and it has its own tests.
vi.mock("./repo-choices", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./repo-choices")>()),
  useRepoChoices: () => choices.current,
}));

import { RepoPicker } from "./RepoPicker";

function seed(next: RepoChoice[]): void {
  choices.current = next as never[];
}

function repo(path: string, name: string, refName: string | null): RepoChoice {
  return { path, name, refName };
}

/** The rows, as `basename` + whatever second column they chose to show. */
function rows(): string[] {
  return screen
    .getAllByRole("button")
    .map((button) => button.textContent ?? "");
}

function input(): HTMLInputElement {
  return screen.getByLabelText("Find a repo") as HTMLInputElement;
}

afterEach(() => {
  cleanup();
  choices.current = [];
  vi.clearAllMocks();
});

describe("finding a repo", () => {
  it("filters as you type", () => {
    seed([
      repo("/src/review", "review", "main"),
      repo("/src/plain", "plain", "dev"),
    ]);
    render(<RepoPicker attached={new Set()} onPick={() => {}} />);

    fireEvent.change(input(), { target: { value: "pla" } });

    expect(rows()).toEqual(["plaindev"]);
  });

  /**
   * The branch is the useful second column only while the name already
   * identifies the repo. Two rows sharing a name have to be told apart by
   * where they are.
   */
  it("shows paths instead of branches when two rows share a name", () => {
    seed([
      repo("/Users/dave/Developer/github/django", "django", "main"),
      repo("/Users/dave/Developer/forks/django", "django", "fix-thing"),
      repo("/Users/dave/src/review", "review", "main"),
    ]);
    render(<RepoPicker attached={new Set()} onPick={() => {}} />);

    expect(rows()).toEqual([
      "django~/Developer/github/django",
      "django~/Developer/forks/django",
      "reviewmain",
    ]);
  });
});

describe("picking one by keyboard", () => {
  const listed = [
    repo("/src/review", "review", "main"),
    repo("/src/plain", "plain", "dev"),
    repo("/src/pullapprove", "pullapprove", "next"),
  ];

  it("opens the first row on Enter, with nothing highlighted yet", () => {
    seed(listed);
    const onPick = vi.fn();
    render(<RepoPicker attached={new Set()} onPick={onPick} />);

    fireEvent.keyDown(input(), { key: "Enter" });

    expect(onPick).toHaveBeenCalledWith(listed[0]);
  });

  it("walks the rows with the arrows", () => {
    seed(listed);
    const onPick = vi.fn();
    render(<RepoPicker attached={new Set()} onPick={onPick} />);

    fireEvent.keyDown(input(), { key: "ArrowDown" });
    fireEvent.keyDown(input(), { key: "ArrowDown" });
    fireEvent.keyDown(input(), { key: "ArrowUp" });
    fireEvent.keyDown(input(), { key: "Enter" });

    expect(onPick).toHaveBeenCalledWith(listed[1]);
  });

  /** The ends hold rather than wrap: ↑ at the top is not a jump to the bottom. */
  it("stops at the ends of the list", () => {
    seed(listed);
    const onPick = vi.fn();
    render(<RepoPicker attached={new Set()} onPick={onPick} />);

    fireEvent.keyDown(input(), { key: "ArrowUp" });
    fireEvent.keyDown(input(), { key: "Enter" });

    expect(onPick).toHaveBeenCalledWith(listed[0]);
  });

  /** A filtered list is a new list, so the highlight starts over on it. */
  it("re-highlights the top row when the query changes", () => {
    seed(listed);
    const onPick = vi.fn();
    render(<RepoPicker attached={new Set()} onPick={onPick} />);

    fireEvent.keyDown(input(), { key: "ArrowDown" });
    fireEvent.change(input(), { target: { value: "p" } });
    fireEvent.keyDown(input(), { key: "Enter" });

    expect(onPick).toHaveBeenCalledWith(listed[1]);
  });

  it("clears the query on Escape before giving up the focus", () => {
    seed(listed);
    render(<RepoPicker autoFocus attached={new Set()} onPick={() => {}} />);

    fireEvent.change(input(), { target: { value: "plain" } });
    fireEvent.keyDown(input(), { key: "Escape" });

    expect(input().value).toBe("");
    expect(document.activeElement).toBe(input());

    fireEvent.keyDown(input(), { key: "Escape" });
    expect(document.activeElement).not.toBe(input());
  });
});
