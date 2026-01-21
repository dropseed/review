---
name: pullapprove-review
description: Helps humans review diffs more efficiently by classifying hunks, bulk-marking trivial changes, and focusing attention on what actually needs careful human review.
---

# PullApprove Review - Human-Focused Code Review Assistant

Use this skill to help humans review diffs more efficiently. This is **not** an AI code review tool that replaces human judgment—it's a tool that makes the human reviewer's job easier by handling the tedious parts so they can focus on what matters.

## Philosophy

Human code review is valuable and necessary. But not every line of a diff deserves equal attention—renamed files, deleted code, and formatting changes don't need the same scrutiny as new authentication logic.

This tool applies AI to the *process* of review, not the review itself:
- **Classify hunks** as trivial (agent-reviewable) or requiring human attention
- **Bulk-mark** trivial changes so the human doesn't have to click through them
- **Narrow focus** to the hunks that actually need careful human consideration

The goal: help humans spend their review time where it counts.

## Overview

`pullapprove-review` tracks review progress at the hunk level (individual change blocks in a diff). Your role is to:
1. **Show an overview** of what changed
2. **Auto-classify all hunks** in a background task (saves context)
3. **Present classification results** grouped by reason
4. **User approves by marking** - this IS the review moment
5. **Guide the human** through hunks that need their attention

**Key insight:** Classification is a *proposal*. Marking is *approval*. The user doesn't approve the classification—they approve by marking, which completes the review for those hunks.

## Classification Values

- `suggested: "agent"` - Trivial change, agent can mark it (default)
- `suggested: "human"` - Needs human review (use `--human` flag)

## Workflow

### 1. Check Current State

**Always start with `status`** to see where we are:

```bash
pullapprove-review status
```

This tells you what to do next:
- **"Unclassified (X hunks)"** → needs classification (step 2)
- **"Ready for bulk approval"** → skip to step 3
- **"Needs your review"** → skip to step 4
- **Progress: 100%** → review complete!

### 2. Classify (if needed)

If there are unclassified hunks, first get the diff overview:

```bash
pullapprove-review stats
pullapprove-review files --status renamed
pullapprove-review files --status deleted
```

Understand what's being renamed/deleted before classifying. Then **run classification in a background Task to save context:**

Launch with the Task tool:
```
Use the Task tool to classify all hunks. Instructions:

1. Look at renamed files and classify by path with descriptive reasons:
   - Run: pullapprove-review files --status renamed
   - Group by directory/purpose and classify each group with reasons that explain *what* moved *where*:
     pullapprove-review classify --status renamed src/new-components/ --reason "renamed src/components to src/new-components"
     pullapprove-review classify --status renamed config/v2/ --reason "moved config files to v2 subdirectory"

2. Look at deleted files and classify by path with descriptive reasons:
   - Run: pullapprove-review files --status deleted
   - Group by directory/purpose and classify each group with reasons that explain *what* was removed and *why* it's safe:
     pullapprove-review classify --status deleted old-package/ --reason "removed deprecated old-package (replaced by new-package)"
     pullapprove-review classify --status deleted .vscode/ --reason "removed local .vscode config"

3. For each remaining file (added/modified/untracked):
   - Run: pullapprove-review diff <path> --json
   - Classify each hunk with a descriptive reason (hunks with the same reason will group together)

4. Run: pullapprove-review status --json
5. Return the status summary
```

### 3. Present Status

After classification (or if already classified), show what actions are needed:

```bash
pullapprove-review status
```

This groups hunks by action needed:
```
Progress: ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ 0% (0/69 hunks)

Ready for bulk approval (39 hunks) ← mark --agent
  · renamed src/old to src/new        24 hunks
  · removed deprecated utils          14 hunks
  · package-lock.json update           1 hunk

Needs your review (30 hunks)
  · new authentication module         20 hunks
  · tests for auth module             10 hunks
```

Summarize for the user:
> "39 hunks ready for bulk approval (directory rename, removed deprecated code, lock file).
> 30 hunks need your review (new auth module and its tests).
> Want to preview any group, or mark the trivial ones?"

### 4. User Approves by Marking

The user reviews and approves groups. **Marking IS the review.**

```bash
# User wants to preview a group first
pullapprove-review diff --reason "directory rename"

# User approves the group
pullapprove-review mark --reason "directory rename"
```

Or mark all agent-reviewable at once:
```bash
pullapprove-review mark --agent
```

### 5. Guide Through Human-Required Hunks

Show what's left:

```bash
pullapprove-review diff --unreviewed
```

For each hunk:
1. Show the change
2. Explain what it does
3. Note anything interesting
4. User marks when satisfied: `pullapprove-review mark <path>:<hash>`

### 6. Add Feedback Notes

For specific feedback with file:line references:

```bash
pullapprove-review notes --add "src/auth.py:45 - Consider using a constant"
```

## Classification Guidelines (for the Task)

**Key insight:** Hunks with the same reason string automatically group together in the status output. Use descriptive reasons that make sense for the specific diff—the user will see these when deciding what to bulk-approve.

### Writing Good Reasons

Use your judgment. Be specific and descriptive. Examples:

- `"renamed pullapprove-vscode to pullapprove-review-vscode"` - tells user exactly what moved
- `"removed old .vscode config"` - explains what was deleted and why it's safe
- `"package-lock.json update"` - lock files are usually trivial
- `"new CLI implementation"` - new code needs human review
- `"test coverage for hunks module"` - tests grouped by what they test

Bad reasons (too generic):
- `"renamed files"` - which files? why?
- `"deleted"` - what was deleted?
- `"changes"` - not helpful

### Classification Rules

1. **Renamed/deleted files** → usually agent-reviewable, but classify by path with specific reasons
   - Example: `--status renamed src/old-name/ --reason "renamed to src/new-name"`
2. **Lock files** → agent-reviewable
3. **New source files** → human-required
4. **Modified files** → examine each hunk (whitespace-only → agent, logic changes → human)
5. **When unsure** → mark as human-required

## Command Reference

| Command | Description |
|---------|-------------|
| `compare <base>` | Start review against base branch |
| `stats` | Show diff overview by git status (before classification) |
| `status` | Show review progress and actions needed (after classification) |
| `status --files` | Include per-file breakdown |
| `files [--json]` | List files with hunk counts |
| `files --status <status>` | List only files with this git status |
| `files --reason "..."` | List only files with hunks classified with this reason |
| `files --unreviewed` | List only files with unreviewed hunks |
| `files --unclassified` | List only files with unclassified hunks |
| `diff [path] [--json]` | Show changes with review markers |
| `diff --status <status>` | Only show files with this git status |
| `diff --unreviewed` | Only show unreviewed hunks |
| `diff --unclassified` | Only show unclassified hunks |
| `diff --reason "..."` | Only show hunks with this classification reason |
| `classify --status <status> [path] --reason "..." [--verbose]` | Classify hunks by file status |
| `classify <spec> --reason "..."` | Classify a specific hunk (default: agent) |
| `classify <spec> --human --reason "..."` | Classify as needing human review |
| `classify --stdin` | Batch classify from JSON |
| `classify --list` | List current classifications |
| `mark <spec>` | Mark hunk(s) as reviewed |
| `mark --agent` | Mark all agent-approved hunks |
| `mark --reason "..."` | Mark all hunks with this classification reason |
| `unmark <spec>` | Unmark hunk(s) |
| `unmark --agent` | Unmark all agent-reviewed hunks |
| `unmark --reason "..."` | Unmark all hunks with this classification reason |
| `notes [--add "..."]` | View or add review notes |
| `clear` | Reset review state |

## Example Session

```
AGENT: Let me check where we are.

$ pullapprove-review status
Progress: ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ 0% (0/69 hunks)

Unclassified (69 hunks) ← needs classification

AGENT: Nothing classified yet. Let me see what changed.

$ pullapprove-review stats
69 hunks across 66 files

  A added        14 files,  14 hunks
  M modified      1 file,   1 hunk
  D deleted      14 files,  14 hunks
  R renamed      21 files,  24 hunks
  ? untracked    16 files,  16 hunks

AGENT: 69 hunks - the renames look like a directory rename from
pullapprove-vscode/ to pullapprove-review-vscode/, and the deletions
are old vscode configs. Let me classify everything in the background.

[Agent launches Task tool with path-specific classification:
  - classify --status renamed pullapprove-review-vscode/ --reason "renamed pullapprove-vscode to pullapprove-review-vscode"
  - classify --status deleted .vscode/ --reason "removed old .vscode config"
  - classify --status deleted pullapprove-vscode/ --reason "removed old extension source (now in pullapprove-review-vscode)"
  - classify pyproject.toml --reason "pyproject.toml version bump"
  - etc. for new files, examining each...]

AGENT: Done. Here's the review status:

$ pullapprove-review status
Progress: ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ 0% (0/69 hunks)

Ready for bulk approval (39 hunks) ← mark --agent
  · renamed pullapprove-vscode to pullapprove-review-vscode    24 hunks
  · removed old .vscode config                                   2 hunks
  · removed old extension source                                12 hunks
  · pyproject.toml version bump                                  1 hunk

Needs your review (30 hunks)
  · new CLI implementation                                      15 hunks
  · new state management module                                  5 hunks
  · tests for hunks module                                      10 hunks

AGENT: 39 hunks ready for bulk approval (renames, deletions, version bump).
30 hunks need your review (new CLI, state module, and tests).
Want to preview any group, or mark the trivial ones?

USER: mark the trivial ones

$ pullapprove-review mark --agent
✓ Marked 39 hunk(s) as reviewed.

$ pullapprove-review status
Progress: ████████████████░░░░░░░░░░░░░░ 57% (39/69 hunks)

Needs your review (30 hunks)
  · new CLI implementation                                      15 hunks
  · new state management module                                  5 hunks
  · tests for hunks module                                      10 hunks

Completed (39 hunks)
  · renamed pullapprove-vscode to pullapprove-review-vscode    24 hunks (agent)
  · removed old .vscode config                                   2 hunks (agent)
  · removed old extension source                                12 hunks (agent)
  · pyproject.toml version bump                                  1 hunk (agent)

AGENT: Now let's go through the 30 hunks that need your review.
Starting with the new CLI implementation.

$ pullapprove-review diff --reason "new CLI implementation"
[Shows the hunks...]

AGENT: This is the main CLI - uses Click for argument parsing,
state stored in .pullapprove/ directory. The commands are...

USER: looks fine, mark it

$ pullapprove-review mark --reason "new CLI implementation"

$ pullapprove-review status
Progress: █████████████████████████████░ 78% (54/69 hunks)

Needs your review (15 hunks)
  · new state management module                                  5 hunks
  · tests for hunks module                                      10 hunks
...
```
