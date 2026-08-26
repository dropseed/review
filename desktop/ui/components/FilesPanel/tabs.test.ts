import { describe, it, expect } from "vitest";
import { makeComparison } from "../../types";
import { visibleFilesPanelTabs } from "./tabs";
import type { GitTab } from "./hooks/useFilePanelNavigation";

const ids = (tabs: { id: string }[]) => tabs.map((t) => t.id);

/**
 * What `useGitTab` would have answered. Which condition failed — and so which
 * words the tooltip gets — is decided there; this file only checks that the
 * table renders the answer it is handed.
 */
function git(gitEnabled: boolean, disabledReason?: string): GitTab {
  return { gitEnabled, gitChangeCount: 0, disabledReason };
}

describe("the files panel's tabs", () => {
  it("keeps Git in the row and greys it out instead of dropping it", () => {
    // A tab that comes and goes with the head moves the row of tabs under the
    // cursor and leaves no way to tell "nothing to stage" from "gone".
    const tabs = visibleFilesPanelTabs(
      makeComparison("main", "refs/review/pr/7"),
      git(false, "#7 isn't checked out"),
    );
    expect(ids(tabs)).toEqual(["git", "changes", "browse"]);

    const tab = tabs.find((t) => t.id === "git")!;
    expect(tab.disabled).toBe(true);
    // Whatever `useGitTab` decided, verbatim — the words are its business, and
    // `git-tab.test.tsx` is where each of them is checked.
    expect(tab.disabledReason).toBe("#7 isn't checked out");
  });

  it("enables Git when the head on screen is the working tree", () => {
    const tab = visibleFilesPanelTabs(
      makeComparison("main", "feature"),
      git(true),
    ).find((t) => t.id === "git")!;
    expect(tab.disabled).toBe(false);
    expect(tab.disabledReason).toBeUndefined();
  });

  /** Review is the one still withheld: with nothing to compare it isn't
   *  empty, it is meaningless. */
  it("withholds Review only when there is no comparison at all", () => {
    expect(ids(visibleFilesPanelTabs(null, git(false)))).toEqual([
      "git",
      "browse",
    ]);
  });
});
