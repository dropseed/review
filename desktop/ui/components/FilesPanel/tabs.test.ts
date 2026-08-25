import { describe, it, expect } from "vitest";
import { makeComparison } from "../../types";
import { visibleFilesPanelTabs } from "./tabs";

const ids = (tabs: { id: string }[]) => tabs.map((t) => t.id);

describe("the files panel's tabs", () => {
  it("keeps Git in the row and greys it out instead of dropping it", () => {
    // A tab that comes and goes with the head moves the row of tabs under the
    // cursor and leaves no way to tell "nothing to stage" from "gone".
    const tabs = visibleFilesPanelTabs(
      makeComparison("main", "refs/review/pr/7"),
      false,
    );
    expect(ids(tabs)).toEqual(["git", "changes", "browse"]);

    const git = tabs.find((t) => t.id === "git")!;
    expect(git.disabled).toBe(true);
    // The reason is one hover away, said in the words of what is on screen —
    // nobody calls a PR `refs/review/pr/7` out loud.
    expect(git.disabledReason).toBe("#7 isn't checked out");
  });

  it("enables Git when the head on screen is the working tree", () => {
    const git = visibleFilesPanelTabs(
      makeComparison("main", "feature"),
      true,
    ).find((t) => t.id === "git")!;
    expect(git.disabled).toBe(false);
    expect(git.disabledReason).toBeUndefined();
  });

  /** Review is the one still withheld: with nothing to compare it isn't
   *  empty, it is meaningless. */
  it("withholds Review only when there is no comparison at all", () => {
    expect(ids(visibleFilesPanelTabs(null, false))).toEqual(["git", "browse"]);
  });
});
