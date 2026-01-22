---
name: human-review
description: Helps humans review diffs more efficiently by labeling hunks, bulk-marking trivial changes, and focusing attention on what actually needs careful human review.
argument-hint: ""
---

# Human Review - Human-Focused Code Review Assistant

Use this skill to help humans review diffs more efficiently. This is **not** an AI code review tool that replaces human judgment—it separates the signal from the noise so the human reviewer can spend their time on the hunks that actually need their brain.

## Philosophy

Human code review is valuable and necessary. But not every line of a diff deserves equal attention—renamed files, deleted code, and formatting changes don't need the same scrutiny as new authentication logic.

This tool applies AI to the _process_ of review, not the review itself:

- **Label hunks** with descriptions explaining what each change is
- **Trust labels** to approve categories of changes one at a time
- **Walkthrough** the remaining hunks, explaining what they do without passing judgment

The goal: help humans spend their review time where it counts.

**Key principle: Remove intimidation.** A diff with 50 hunks feels overwhelming. But if you can quickly trust the 30 patterned changes, suddenly you only have 20 reasoned changes to actually think about. Each decision should feel small and safe.

**Key principle: Narrator, not reviewer.** For the hunks that need human attention, the AI helps you understand what you're looking at—ordering changes to tell a story, explaining what code does, pointing out connections. The human decides if it's correct; the AI just makes sure they understand it.

## Interaction Principle

**Always use `AskUserQuestion` when you need user input.** Never end with open-ended "What would you like to do?" text. Instead, use the AskUserQuestion tool with clear options the user can select.

Adapt options to the current state:

- If hunks need labeling → offer to label by status, path, or show unlabeled
- If trust is suggested → offer to trust, preview, or review manually
- If review is in progress → offer to continue, show specific label, or finish up

This makes the interaction faster and clearer than free-form text responses.

## Setup

For the best experience, add this permission to your Claude settings JSON (`~/.claude/settings.json`):

```json
{
  "permissions": {
    "allow": ["Bash(git review:*)"]
  }
}
```

This allows the skill to run `git review` commands without requiring approval for each one.

## Overview

`git review` tracks review progress at the hunk level (individual change blocks in a diff). The workflow:

1. **Label** — AI examines each hunk and assigns a label explaining what it is
2. **Trust** — Human bulk-approves patterned and mechanical changes
3. **Walkthrough** — AI walks the human through reasoned changes in story order, explaining without judgment
4. **Finish** — Depending on context: commit, push, merge, or compile feedback for others

**Notes are captured throughout**—when the user has a question or concern during the walkthrough, it gets recorded and the walkthrough continues. At the end, notes inform the next step: fix issues, add TODOs, or draft PR feedback.

**Key insight:** Labeling is a _proposal_. The AI suggests what each hunk is. The human decides which labels to trust (bulk approve). For the hunks that need real attention, the AI walks through them—helping the human understand what they're looking at, not telling them whether it's good.

## Starting a Review

When the user invokes `/human-review`, first check the current state by running these commands:

```bash
git review status --short
git review list
git status
git branch
```

This tells you: (1) if there's a current review and its progress, (2) all stored reviews, (3) current branch and what changes exist to review, and (4) available branches (to determine if `main` or `master` is the default).

**Note:** Don't add `|| echo` fallbacks or `2>/dev/null` - the CLI provides clear output for all states including "no review" and "no reviews stored".

**If a review exists**, use AskUserQuestion to ask what to do. Adapt options based on what `list` shows:

```
Question: "Found an existing review. What would you like to do?"
Options:
- "Continue" (description: "Resume the current review")
- "Switch to <other-review>" (description: "Switch to a different stored review")  # only if list shows other reviews
- "Start fresh" (description: "Delete this review and start new")
```

If they choose to switch, use `git review switch <comparison>` with the review key from the list.

If they choose "Start fresh", run `git review delete` to remove the current review, then proceed to start a new one.

**If no current review exists** but `list` shows stored reviews, offer to resume one or start fresh.

**If no reviews exist at all**, present the review options using AskUserQuestion:

```
Question: "What would you like to review?"
Options:
- "Uncommitted changes" (description: "Review working tree against <base>")
- "This branch vs base" (description: "Review all commits on current branch")
- "Another branch or PR" (description: "Review a different branch or pull request")
```

**Important:** Omit "This branch vs base" when the user is already on the default branch (main/master)—there's nothing to compare.

For "Another branch or PR", ask which branch to review, then start with `git review start --old <base> --new <branch>`.

**Detecting `<base>`:** Run `git branch` to see available branches—most repos have either `main` or `master` as the default, not both. Use whichever exists.

The user can always type a custom comparison (e.g., a specific commit) via the "Other" option.

### Review Types

The `start` command uses `--old`, `--new`, and `--working-tree` options (where `<base>` is `main` or `master`):

| Situation                   | Command                                       | What it reviews              |
| --------------------------- | --------------------------------------------- | ---------------------------- |
| Uncommitted changes         | `start --old <base> --working-tree`           | Working tree vs base         |
| Commits on current branch   | `start --old <base>`                          | Current branch vs base       |
| Specific branch             | `start --old <base> --new feature`            | feature branch vs base       |
| Branch + uncommitted        | `start --old <base> --new feature --working-tree` | feature + uncommitted vs base |

#### 1. Uncommitted Changes (pre-commit review)

Review uncommitted changes in the working tree:

```bash
git review start --old <base> --working-tree
```

#### 2. Branch vs Base (PR Style)

Review commits on your current branch vs base:

```bash
git review start --old <base>
```

#### 3. Another Branch or PR

```bash
# Review a specific branch
git review start --old <base> --new feature-branch

# If the user provides a PR number, use gh to get the branch
gh pr view 123 --json headRefName -q .headRefName
# Then: git review start --old <base> --new <branch-from-pr>

# Review branch + any uncommitted changes
git review start --old <base> --new feature-branch --working-tree
```

### Efficient Startup

When invoked, run **2 commands** to understand the state:

```bash
# 1. Quick check: is there a review? what's the progress?
human-review status --short
# Output: "master..master[working-tree] — 2% (1/50 hunks)"
#         "  0 unlabeled, 49 to approve"

# 2. If review exists, get the full breakdown by label
human-review status
```

The `--short` output tells you exactly what phase you're in:

- `N unlabeled` → need to label first
- `0 unlabeled, N to approve` → ready for trust suggestions

Then immediately present trust suggestions and use AskUserQuestion. Don't run extra commands to verify—the status output has everything you need.

## Workflow Files

The labeling, trust, and walkthrough phases are the same regardless of whether you're reviewing your own work or someone else's. The difference is what happens at the **finish** phase—what to do with notes.

**Read both workflow files** for complete guidance:

- **[own-work.md](own-work.md)** — Finish options: commit, push, fix issues from notes
- **[give-feedback.md](give-feedback.md)** — Finish options: draft PR comments from notes, submit review

**At finish time**, if there are notes, ask what to do:

```
Question: "Review complete. What would you like to do with your notes?"
Options:
- "Fix the issues" (description: "Address concerns before committing/pushing")
- "Draft PR feedback" (description: "Turn notes into comments for the author")
- "Just finish" (description: "Keep notes for reference, no action needed")
```

## Labeling Guidelines

**Key insight:** Hunks with the same label automatically group together in the status output. The user will see these labels when deciding what to trust.

### Writing Good Labels

Write clear, specific labels that describe what the change is. Hunks with identical labels get grouped together, so use the same label for hunks that are "the same kind of change."

**Good labels are specific:**

- ✓ `"Delete old test fixtures from tests/old/"` — clear what's being deleted
- ✓ `"Remove choices parameter from field constructors"` — specific about what's removed
- ✓ `"Add ChoicesFieldMixin to field classes"` — describes the change
- ✓ `"Rename src/components to src/ui"` — clear source and destination

**Bad labels are vague:**

- ✗ `"Refactoring"` — refactoring what?
- ✗ `"Cleanup"` — cleanup of what?
- ✗ `"Updates"` — what kind of updates?
- ✗ `"Changes"` — not helpful at all

**Group similar changes with identical labels.** If you have 8 hunks that all add the same import to different files, label them all in one command:

```bash
# Multiple hashes in one command (fastest)
git review label abc123 def456 ghi789 --as "Add ChoicesFieldMixin import" -q

# Or by file path (labels all hunks in the file)
git review label src/models.py --as "Add ChoicesFieldMixin import" -q
```

This way they'll show as one group: `"Add ChoicesFieldMixin import" — 8 hunks`

**Use `-q` when labeling** to reduce output noise. The label command confirms success with verbose hints that aren't needed when you're running multiple commands.

**For hunks needing different labels**, use `--stdin` to batch them in one call:

```bash
echo '{"src/auth.py:abc123": "Remove old import", "src/utils.py:def456": "Add new import"}' | git review label --stdin
```

Note: `--stdin` requires full `filepath:hash` keys. Command-line args accept bare hashes (resolved automatically).

### Labeling Strategy

**Read the diff first, then batch label.** Look at the whole diff to understand patterns before labeling. This lets you identify groups of similar changes and label them efficiently.

**Batch hunks that are genuinely the same change.** The goal is fewer commands, not broader labels. If 12 hunks all remove the same parameter, label them together. If 12 hunks do different things, they need different labels.

Batch techniques:

- **By file status** — when all deleted/renamed files share a reason:
  ```bash
  git review label --status deleted tests/fixtures/old/ --as "Delete old test fixtures" -q
  ```

- **Multiple hashes** — when scattered hunks are the same change:
  ```bash
  git review label abc123 def456 ghi789 --as "Add ChoicesFieldMixin import" -q
  ```

- **By file path** — when all hunks in a file share a label:
  ```bash
  git review label src/auth.py --as "Refactor auth module" -q
  ```

- **Catch stragglers** — use `--unlabeled` to skip already-labeled hunks:
  ```bash
  git review label src/models/ --unlabeled --as "Remaining model changes" -q
  ```

### Getting Hunk Counts Right

**CRITICAL: Get counts from status output.** When presenting trust suggestions, always use the exact hunk counts from `git review status` output. Never guess or calculate counts yourself. The status output shows:

```
Unreviewed (50 hunks)
  · Remove choices parameter from field constructors            12 hunks
  · Add ChoicesFieldMixin import                                 2 hunks
```

Use those exact numbers (12, 2) in your presentation. If you labeled hunks and want to know how many matched, run `status` again to see the actual groupings.

## Presenting Trust Suggestions

**Always show sample code when suggesting trust.** The user needs to see actual code to decide whether to bulk-approve a category. Don't just list labels and counts—show what the hunks look like.

**Only suggest trust for patterned or mechanical changes.**

- **Patterned** = identical, interchangeable hunks. Test: look at one, know exactly what all others look like.
- **Mechanical** = generated/automated, no judgment needed (lock files, version bumps).

| Label | Hunks | Type | Trust? |
|-------|-------|------|--------|
| "Add import X" | 12 | Patterned | ✓ Yes |
| "Update package-lock.json" | 1 | Mechanical | ✓ Yes |
| "Update forms.py dynamically" | 2 | Reasoned | ✗ Walkthrough |
| "Add new Mixin class" | 1 | Reasoned | ✗ Walkthrough |

**Labels with 1-2 hunks are usually reasoned** unless they're clearly mechanical (lock files, configs). Small counts + logic changes = walkthrough.

After labeling is complete:

1. Run `git review status` to get **exact** label names and counts
2. Get sample hunks for each label. Two approaches:
   - **From full diff:** Run `git review diff --json` once and extract examples by label from the JSON
   - **Per-label:** Run `git review diff --label "<exact label>" --json` for each — label must match exactly as shown in status
3. Present the trust suggestions with inline code snippets

**Example presentation:**

```markdown
## Ready to trust

### "Remove choices parameter from field constructors" (12 hunks)

Example from `fields/__init__.py`:
```diff
-    def __init__(self, choices=None, db_column=None, ...):
+    def __init__(self, db_column=None, ...):
```

### "Add ChoicesFieldMixin import" (8 hunks)

Example from `fields/text.py`:
```diff
+from .mixins import ChoicesFieldMixin
```

[Then use AskUserQuestion with multiSelect: true]
```

**Keep samples brief.** Show just enough context to recognize the pattern—usually 2-6 lines of diff. If a hunk is longer, show the key part with `...` to indicate truncation.

**Show 3-4 labels at a time.** Present the most trustable labels first (by trustability order, not just count). After the user trusts some, show the next batch. Include a "Show all labels" option for users who want to see everything.

**Prioritize by trustability, then by count.** Deletions, renames, and lockfiles first. Within each tier, larger groups save more time.

## Command Reference

| Command                                     | Description                                   |
| ------------------------------------------- | --------------------------------------------- |
| `start --old <ref> [--new <ref>] [--working-tree]` | Start a new review                     |
| `switch <comparison>`                       | Switch to an existing review                  |
| `list`                                      | List all stored reviews                       |
| `delete [comparison]`                       | Delete a review (current if not specified)    |
| `status`                                    | Show diff scope and review progress           |
| `status --short`                            | Condensed summary (comparison type, progress) |
| `status --files`                            | Include per-file breakdown                    |
| `diff [path] [--json]`                      | Show changes with review markers              |
| `diff --name-only`                          | List files only (no content)                  |
| `diff --status <status>`                    | Only show files with this git status          |
| `diff --unreviewed`                         | Only show unapproved hunks                    |
| `diff --unlabeled`                          | Only show unlabeled hunks                     |
| `diff --label "..."`                        | Only show hunks with this label               |
| `label --status <status> [path] --as "..."` | Label hunks by file status                    |
| `label <path> --unlabeled --as "..."`       | Label only hunks without existing labels      |
| `label <spec>... --as "..."`                | Label hunks (multiple specs allowed)          |
| `label --stdin`                             | Batch label from JSON (filepath:hash keys)    |
| `label --list`                              | List current labels                           |
| `label --clear`                             | Clear all labels                              |
| `trust "label"`                             | Approve all hunks with this exact label       |
| `trust "label" --preview`                   | Preview hunks before trusting                 |
| `untrust "label"`                           | Remove trust from a label                     |
| `approve <spec>`                            | Approve hunk(s) after individual review       |
| `unapprove <spec>`                          | Remove approval from hunk(s)                  |
| `stage [--dry-run] [--force]`               | Stage all approved hunks via git apply        |
| `notes [--add "..."]`                       | View or add review notes                      |
