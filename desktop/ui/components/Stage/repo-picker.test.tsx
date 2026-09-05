import { vi, describe, it, expect, afterEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import { repoChoiceKey, type RepoChoice } from "./repo-choices";

const { choices, status, inUse, removeWorktreeAt, chooseFolder } = vi.hoisted(
  () => ({
    choices: { current: [] as never[] },
    status: { current: new Map<string, unknown>() },
    inUse: { current: false },
    removeWorktreeAt: vi.fn(async () => true),
    chooseFolder: vi.fn(),
  }),
);

// The picker's job is the search, the ordering and the keyboard; where the
// repos come from is the sidebar tree's, and it has its own tests. The folder
// dialog is the OS's, and there is none in jsdom.
vi.mock("./repo-choices", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./repo-choices")>()),
  useRepoChoices: () => choices.current,
  chooseFolder: () => chooseFolder(),
}));

// The two halves of a worktree row's facts: what git says about the checkout,
// and whether anything in the app is pointed at it. Both are joins with their
// own homes; the picker only draws them.
vi.mock("./worktree-facts", () => ({
  useWorktreeStatus: () => ({ byPath: status.current, refresh: vi.fn() }),
  useWorktreeInUse: () => () => inUse.current,
}));

vi.mock("./worktree-actions", () => ({ removeWorktreeAt }));

// The create form suggests branches; where they come from is not this file's
// subject, and an unstubbed client reaches for a server no test is running.
vi.mock("../../api", () => ({
  getApiClient: () => ({
    listBranches: async () => ({ local: [], remote: [], stashes: [] }),
  }),
}));

import { RepoPicker } from "./RepoPicker";
import type { WorktreeStatus } from "../../types";

function seed(next: RepoChoice[]): void {
  choices.current = next as never[];
}

function repo(path: string, name: string, refName: string | null): RepoChoice {
  return {
    path,
    repoRoot: path,
    name,
    refName,
  };
}

/** The same repo, as the row one of its checked-out branches contributes. */
function worktree(
  repoRoot: string,
  name: string,
  refName: string,
  path: string,
): RepoChoice {
  return {
    path,
    repoRoot,
    name,
    refName,
  };
}

/** What `list_worktree_status` said about a checkout on disk. */
function seedStatus(...worktrees: WorktreeStatus[]): void {
  status.current = new Map(worktrees.map((wt) => [wt.path, wt]));
}

function statusOf(
  path: string,
  branch: string,
  extra: Partial<WorktreeStatus> = {},
): WorktreeStatus {
  return {
    path,
    branch,
    isMain: false,
    commitHash: "abc123",
    isDetached: false,
    isReviewManaged: true,
    hasChanges: false,
    ...extra,
  };
}

/**
 * The rows, as `basename` + whatever second column they chose to show.
 *
 * The row's own button, not every button in the list: a row also carries the
 * verb at its end, which is a control on the row rather than part of it.
 */
function rows(): string[] {
  return screen
    .getAllByRole("listitem")
    .map((item) => item.querySelector("button")?.textContent ?? "");
}

function input(): HTMLInputElement {
  return screen.getByLabelText("Find a repo") as HTMLInputElement;
}

function folderRow(): HTMLElement {
  return screen.getByText("Open folder…").closest("button") as HTMLElement;
}

afterEach(() => {
  cleanup();
  choices.current = [];
  status.current = new Map();
  inUse.current = false;
  chooseFolder.mockReset();
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
   * Two rows sharing a name also have to say where they are. The branch stays:
   * a repo now contributes a row per worktree, and those differ by ref alone —
   * trading it for the path would leave two identical-looking rows.
   */
  it("adds paths when two rows share a name", () => {
    seed([
      repo("/Users/dave/Developer/github/django", "django", "main"),
      repo("/Users/dave/Developer/forks/django", "django", "fix-thing"),
      repo("/Users/dave/src/review", "review", "main"),
    ]);
    render(<RepoPicker attached={new Set()} onPick={() => {}} />);

    expect(rows()).toEqual([
      "djangomain~/Developer/github/django",
      "djangofix-thing~/Developer/forks/django",
      "reviewmain",
    ]);
  });

  /** A worktree is reached for by its branch, not by the repo's name. */
  it("finds a worktree by the branch it holds", () => {
    seed([
      repo("/src/review", "review", "main"),
      worktree("/src/review", "review", "fix-the-parser", "/wt/fix-the-parser"),
    ]);
    render(<RepoPicker attached={new Set()} onPick={() => {}} />);

    fireEvent.change(input(), { target: { value: "parser" } });

    expect(rows()).toEqual(["reviewfix-the-parser"]);
  });

  /**
   * "open" is the tab you are already on, and a repo's tab is pointed at one
   * ref — so its other worktrees are still somewhere to go.
   */
  it("marks only the attached ref as open", () => {
    seed([
      repo("/src/review", "review", "main"),
      worktree("/src/review", "review", "fix-the-parser", "/wt/fix-the-parser"),
    ]);
    render(
      <RepoPicker
        attached={new Set([repoChoiceKey("/src/review", "main")])}
        onPick={() => {}}
      />,
    );

    expect(rows()).toEqual(["reviewmainopen", "reviewfix-the-parser"]);
  });

  /**
   * A repo's own checkout and its worktrees are the same noun — this repo, at
   * this branch — so nothing marks one out as a worktree. Which of them happens
   * to have its own directory is the app's problem, not a distinction to make
   * someone read past on every row.
   */
  it("draws a worktree row exactly like the repo's own", () => {
    seed([
      repo("/src/review", "review", "main"),
      worktree("/src/review", "review", "fix-the-parser", "/wt/fix-the-parser"),
    ]);
    render(<RepoPicker attached={new Set()} onPick={() => {}} />);

    expect(rows()).toEqual(["reviewmain", "reviewfix-the-parser"]);
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

describe("opening a folder the app has never seen", () => {
  const picked: RepoChoice = {
    path: "/tmp/brand-new",
    repoRoot: "/tmp/brand-new",
    name: "brand-new",
    refName: null,
  };

  /** A folder arrives as an ordinary choice, so both front doors open it the
   * same way they open a row. */
  it("hands the pick to onPick like any other row", async () => {
    seed([repo("/src/review", "review", "main")]);
    chooseFolder.mockResolvedValue(picked);
    const onPick = vi.fn();
    render(<RepoPicker attached={new Set()} onPick={onPick} />);

    fireEvent.click(folderRow());

    await waitFor(() => expect(onPick).toHaveBeenCalledWith(picked));
  });

  it("does nothing when the dialog is cancelled", async () => {
    seed([repo("/src/review", "review", "main")]);
    chooseFolder.mockResolvedValue(null);
    const onPick = vi.fn();
    render(<RepoPicker attached={new Set()} onPick={onPick} />);

    fireEvent.click(folderRow());

    await waitFor(() => expect(chooseFolder).toHaveBeenCalled());
    expect(onPick).not.toHaveBeenCalled();
  });

  /**
   * "No repos yet." was a dead end — the one state where the only thing worth
   * offering is the folder dialog is the state with nothing to list.
   */
  it("is what Enter does with an empty list", async () => {
    seed([]);
    chooseFolder.mockResolvedValue(picked);
    render(<RepoPicker attached={new Set()} onPick={() => {}} />);

    fireEvent.keyDown(input(), { key: "Enter" });

    await waitFor(() => expect(chooseFolder).toHaveBeenCalled());
  });

  /** It is the last row, so ↓ past the repos reaches it. */
  it("sits below the rows in the arrow order", async () => {
    seed([repo("/src/review", "review", "main")]);
    chooseFolder.mockResolvedValue(picked);
    const onPick = vi.fn();
    render(<RepoPicker attached={new Set()} onPick={onPick} />);

    fireEvent.keyDown(input(), { key: "ArrowDown" });
    fireEvent.keyDown(input(), { key: "Enter" });

    // One ArrowDown past the single repo row is the folder row, so Enter opened
    // the dialog rather than the repo.
    await waitFor(() => expect(onPick).toHaveBeenCalledWith(picked));
  });

  /** It is not one of the repos, so it is not one of the listed rows. */
  it("stays out of the list itself", () => {
    seed([repo("/src/review", "review", "main")]);
    render(<RepoPicker attached={new Set()} onPick={() => {}} />);

    expect(rows()).toEqual(["reviewmain"]);
  });
});

describe("managing worktrees", () => {
  const repoRow = repo("/src/review", "review", "main");
  const worktreeRow = worktree(
    "/src/review",
    "review",
    "fix-the-parser",
    "/wt/fix-the-parser",
  );

  /** Every repo can be given one; only a checkout on disk can be removed. */
  it("offers create on a repo row and remove on a worktree row", () => {
    seed([repoRow, worktreeRow]);
    seedStatus(statusOf("/wt/fix-the-parser", "fix-the-parser"));
    render(<RepoPicker attached={new Set()} onPick={() => {}} />);

    expect(screen.getByLabelText("New worktree in review")).toBeTruthy();
    expect(
      screen.getByLabelText("Remove worktree fix-the-parser"),
    ).toBeTruthy();
  });

  /**
   * A row whose repo the status read couldn't answer for is still somewhere to
   * go — but nothing offers to delete a checkout it never managed to look at.
   */
  it("offers no remove when the status read said nothing", () => {
    seed([repoRow, worktreeRow]);
    render(<RepoPicker attached={new Set()} onPick={() => {}} />);

    expect(screen.queryByLabelText(/^Remove worktree/)).toBeNull();
    expect(rows()).toEqual(["reviewmain", "reviewfix-the-parser"]);
  });

  it("reports uncommitted work, who made it, and that nobody is in it", () => {
    seed([repoRow, worktreeRow]);
    seedStatus(
      statusOf("/wt/fix-the-parser", "fix-the-parser", { hasChanges: true }),
    );
    render(<RepoPicker attached={new Set()} onPick={() => {}} />);

    expect(rows()[1]).toContain("review");
    expect(rows()[1]).toContain("unused");
    expect(screen.getByTitle("Uncommitted changes")).toBeTruthy();
  });

  /** "Unused" is a fact about the queue, so a workspace showing it silences it. */
  it("drops the unused hint once something is pointed at it", () => {
    seed([repoRow, worktreeRow]);
    seedStatus(
      statusOf("/wt/fix-the-parser", "fix-the-parser", {
        isReviewManaged: false,
      }),
    );
    inUse.current = true;
    render(<RepoPicker attached={new Set()} onPick={() => {}} />);

    expect(rows()[1]).not.toContain("unused");
    // A worktree the user made themselves says nothing about who made it.
    expect(rows()[1]).toBe("reviewfix-the-parser");
  });

  it("hands the remove to the one place that asks first", () => {
    seed([repoRow, worktreeRow]);
    const wt = statusOf("/wt/fix-the-parser", "fix-the-parser");
    seedStatus(wt);
    render(<RepoPicker attached={new Set()} onPick={() => {}} />);

    fireEvent.click(screen.getByLabelText("Remove worktree fix-the-parser"));

    expect(removeWorktreeAt).toHaveBeenCalledWith("/src/review", wt);
  });

  /** The create form replaces the list: one popover, one question at a time. */
  it("swaps the list for the branch field, and back on Cancel", () => {
    seed([repoRow, worktreeRow]);
    render(<RepoPicker attached={new Set()} onPick={() => {}} />);

    fireEvent.click(screen.getByLabelText("New worktree in review"));

    expect(screen.getByLabelText("Branch for the new worktree")).toBeTruthy();
    expect(screen.queryByLabelText("Find a repo")).toBeNull();

    fireEvent.click(screen.getByText("Cancel"));
    expect(screen.getByLabelText("Find a repo")).toBeTruthy();
  });
});
