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

- **Classify hunks** with trust patterns and reasoning explaining what each change is
- **Auto-approve** hunks that match user's configured trust patterns
- **Walkthrough** the remaining hunks, explaining what they do without passing judgment

The goal: help humans spend their review time where it counts.

**Key principle: Remove intimidation.** A diff with 50 hunks feels overwhelming. But if you can quickly trust the 30 patterned changes, suddenly you only have 20 reasoned changes to actually think about. Each decision should feel small and safe.

**Key principle: Narrator, not reviewer.** For the hunks that need human attention, the AI helps you understand what you're looking at—ordering changes to tell a story, explaining what code does, pointing out connections. The human decides if it's correct; the AI just makes sure they understand it.

## Trust Patterns

Instead of free-form labels, hunks are classified with **structured trust patterns** — a taxonomy of recognizable, trustable change types. The AI applies patterns it recognizes; empty patterns means the change needs human reasoning.

**Key insight:** We're not categorizing ALL changes. We're identifying changes that fit known trustable patterns. Everything else needs review.

### Per-Hunk Classification

Each hunk gets two fields:

- **label**: Array of recognized trust patterns (can be empty)
- **reasoning**: Free-form explanation of what the change does (always present)

```json
{
  "src/models.py:a1b2c3d4": {
    "label": ["imports:added"],
    "reasoning": "Added import for ChoicesFieldMixin from .mixins module"
  }
}
```

### Trust Logic

A hunk is considered "trusted" (approved) if:

1. `label` is non-empty (patterns were recognized)
2. ALL patterns in the array are in the effective trust list (config + review-level)

Trust is **declarative and computed dynamically**. When you run `trust <pattern>`, it adds the pattern to the review-level trust list. Hunks matching that pattern instantly become trusted without storing approval state.

| label                                        | Effective trust config          | Result                                  |
| -------------------------------------------- | ------------------------------- | --------------------------------------- |
| `["imports:added"]`                          | `["imports:*"]`                 | ✓ Trusted                               |
| `["imports:added", "formatting:whitespace"]` | `["imports:*", "formatting:*"]` | ✓ Trusted                               |
| `["imports:added", "formatting:whitespace"]` | `["imports:*"]`                 | ✗ Needs review (formatting not trusted) |
| `[]`                                         | anything                        | ✗ Needs review (no patterns)            |

### Trust Patterns Taxonomy

Only use patterns from this list. If a change doesn't fit these patterns, leave `label` empty.

**Imports:**

- `imports:added` — Import statements added
- `imports:removed` — Import statements removed
- `imports:reordered` — Imports reordered/reorganized

**Formatting:**

- `formatting:whitespace` — Whitespace changes (spaces, tabs, blank lines)
- `formatting:line-length` — Line wrapping/length changes
- `formatting:style` — Code style (quotes, trailing commas, etc.)

**Comments:**

- `comments:added` — Comments added
- `comments:removed` — Comments removed
- `comments:modified` — Comments changed

**Types & Annotations:**

- `types:added` — Type annotations added (no logic change)
- `types:removed` — Type annotations removed
- `types:modified` — Type annotations changed

**Files:**

- `file:deleted` — File deleted entirely
- `file:renamed` — File renamed (content unchanged)
- `file:moved` — File moved to different directory

**Renames & Reordering:**

- `rename:variable` — Variable/constant renamed
- `rename:function` — Function renamed
- `rename:class` — Class renamed
- `rename:parameter` — Parameter renamed
- `reorder:function` — Function/method moved up or down within same file/class
- `reorder:class` — Class reordered within module

**Generated & Mechanical:**

- `generated:lockfile` — Package lock file (package-lock.json, uv.lock, etc.)
- `generated:config` — Auto-generated configuration
- `generated:migration` — Database migration files
- `version:bumped` — Version number changed

**Removal:**

- `remove:deprecated` — Deprecated code removed

**Custom patterns** can be defined in project config with `custom:` prefix.

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

1. **Classify** — AI examines each hunk, assigns trust patterns (if applicable) and reasoning
2. **Trust** — Hunks with trusted patterns are auto-approved; human can trust additional patterns
3. **Walkthrough** — AI walks human through remaining hunks, explaining without judgment
4. **Finish** — Depending on context: commit, push, merge, or compile feedback for others

**Notes are captured throughout**—when the user has a question or concern during the walkthrough, it gets recorded and the walkthrough continues. At the end, notes inform the next step: fix issues, add TODOs, or draft PR feedback.

**Key insight:** Classification is a _proposal_. The AI suggests trust patterns for mechanical changes and explains what each hunk does. The human decides which patterns to trust. Hunks with no trust patterns always need walkthrough—the AI helps understand what they're looking at, not whether it's good.

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

| Situation                 | Command                                           | What it reviews               |
| ------------------------- | ------------------------------------------------- | ----------------------------- |
| Uncommitted changes       | `start --old <base> --working-tree`               | Working tree vs base          |
| Commits on current branch | `start --old <base>`                              | Current branch vs base        |
| Specific branch           | `start --old <base> --new feature`                | feature branch vs base        |
| Branch + uncommitted      | `start --old <base> --new feature --working-tree` | feature + uncommitted vs base |

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

**Key insight:** Hunks with the same reasoning text automatically group together in the status output. The user will see these grouped when deciding what to trust.

### Classification Format

When classifying hunks, provide both **label patterns** (from the taxonomy) and **reasoning** (free-form explanation):

**For trustable changes** — Apply appropriate patterns:

```json
{
  "src/models.py:abc123": {
    "label": ["imports:added"],
    "reasoning": "Added import for ChoicesFieldMixin"
  }
}
```

**For changes needing review** — Leave label empty:

```json
{
  "src/auth.py:def456": {
    "label": [],
    "reasoning": "New validate_permissions() function that checks user roles"
  }
}
```

**For mixed changes** — If a hunk contains BOTH trustable AND non-trustable changes, leave label empty. The patterns must FULLY describe the change.

### Writing Good Reasoning

Write clear, specific reasoning that describes what the change does:

- ✓ `"Added import for ChoicesFieldMixin from .mixins module"` — specific
- ✓ `"Removed choices parameter from __init__, now using ChoicesFieldMixin"` — explains why
- ✓ `"Renamed src/components directory to src/ui"` — clear source and destination
- ✗ `"Refactoring"` — too vague
- ✗ `"Changes"` — not helpful

**Use `-q` when labeling** to reduce output noise.

**Batch labeling with --stdin** (full format with label patterns):

```bash
echo '{
  "src/auth.py:abc123": {"label": ["imports:added"], "reasoning": "Added typing import"},
  "src/utils.py:def456": {"label": [], "reasoning": "New validation logic"}
}' | git review label --stdin
```

**Simple format** still works (reasoning only, no label patterns):

```bash
echo '{"src/auth.py:abc123": "Remove old import"}' | git review label --stdin
```

Note: `--stdin` requires full `filepath:hash` keys. Command-line args accept bare hashes (resolved automatically).

### Classification Strategy

**Read the diff first, then batch classify.** Look at the whole diff to understand patterns before classifying. This lets you identify groups of similar changes.

**Apply patterns conservatively.** Only apply trust patterns when the pattern FULLY describes the change. If there's any behavioral change mixed in, leave trust empty.

**Batch classification with --stdin:**

```bash
# Classify multiple hunks at once with full label+reasoning format
echo '{
  "src/models.py:abc123": {"label": ["imports:added"], "reasoning": "Added ChoicesFieldMixin import"},
  "src/models.py:def456": {"label": ["imports:added"], "reasoning": "Added ChoicesFieldMixin import"},
  "src/auth.py:ghi789": {"label": [], "reasoning": "New permission validation logic"}
}' | git review label --stdin
```

**Simple labeling still works** for manual review workflows:

```bash
git review label abc123 def456 --as "Added ChoicesFieldMixin import" -q
git review label --status deleted tests/fixtures/old/ --as "Delete old test fixtures" -q
```

### Getting Hunk Counts Right

**CRITICAL: Get counts from status output.** When presenting trust suggestions, always use the exact hunk counts from `git review status` output. Never guess or calculate counts yourself. The status output shows:

```
Unreviewed (50 hunks)
  · Remove choices parameter from field constructors            12 hunks
  · Add ChoicesFieldMixin import                                 2 hunks
```

Use those exact numbers (12, 2) in your presentation. If you labeled hunks and want to know how many matched, run `status` again to see the actual groupings.

## Auto-Approval and Trust Suggestions

**Hunks with trust patterns can be auto-approved** if all their patterns are in the user's trust configuration. Hunks with empty trust always need walkthrough.

### How Auto-Approval Works

1. Check user's trust config (from `~/.config/human-review/settings.json` or `.human-review/settings.json`)
2. For each hunk with trust patterns, check if ALL patterns are trusted
3. Auto-approve matching hunks; walkthrough the rest

### Suggesting Patterns to Trust

When hunks have patterns not yet in the user's trust config, present them as suggestions:

````markdown
## Untrusted Patterns Found

The following patterns were detected but aren't in your trust config:

- `imports:added` (12 hunks) — Example from `fields/__init__.py`:
  ```diff
  +from .mixins import ChoicesFieldMixin
  ```
````

Would you like to trust `imports:added`?

```

**Show sample code** so the user can verify the pattern is correctly applied.

### Hunks Needing Walkthrough

These always need walkthrough (cannot be auto-approved):

1. Hunks with `trust: []` — No trustable pattern recognized
2. Hunks with untrusted patterns — User hasn't added that pattern to config

Present these grouped by reasoning for efficient review.

## Command Reference

### Review Management

| Command                                            | Description                                |
| -------------------------------------------------- | ------------------------------------------ |
| `start --old <ref> [--new <ref>] [--working-tree]` | Start a new review                         |
| `switch <comparison>`                              | Switch to an existing review               |
| `list`                                             | List all stored reviews                    |
| `delete [comparison]`                              | Delete a review (current if not specified) |
| `status`                                           | Show diff scope and review progress        |
| `status --short`                                   | Condensed summary (comparison, progress)   |
| `status --files`                                   | Include per-file breakdown                 |

### Viewing Diffs

| Command                | Description                       |
| ---------------------- | --------------------------------- |
| `diff [path] [--json]` | Show changes with review markers  |
| `diff --name-only`     | List files only (no content)      |
| `diff --status <s>`    | Only show files with git status   |
| `diff --unreviewed`    | Only show unapproved hunks        |
| `diff --unlabeled`     | Only show unlabeled hunks         |
| `diff --label "..."`   | Only show hunks with this label   |

### Labeling (Classification)

| Command                                     | Description                              |
| ------------------------------------------- | ---------------------------------------- |
| `label <spec>... --as "..."`                | Set reasoning for hunks                  |
| `label --stdin`                             | Batch classify from JSON (label+reasoning) |
| `label --status <status> [path] --as "..."` | Label hunks by file status               |
| `label <path> --unlabeled --as "..."`       | Label only unlabeled hunks               |
| `label --list [--json]`                     | List current classifications             |
| `label --clear`                             | Clear all classifications                |

### Trust (Approval)

| Command                    | Description                                    |
| -------------------------- | ---------------------------------------------- |
| `trust <pattern>`          | Add pattern to review-level trust list         |
| `trust "imports:*"`        | Add glob pattern to trust list                 |
| `trust <pattern> --preview`| Preview hunks that would become trusted        |
| `untrust <pattern>`        | Remove pattern from review-level trust list    |
| `approve <spec>`           | Approve hunk(s) after individual review        |
| `unapprove <spec>`         | Remove approval from hunk(s)                   |

### Configuration

| Command                                  | Description                          |
| ---------------------------------------- | ------------------------------------ |
| `config trust list`                      | Show trusted patterns in config      |
| `config trust add <pattern>`             | Add pattern to user config           |
| `config trust add <pattern> --project`   | Add pattern to project config        |
| `config trust remove <pattern>`          | Remove pattern from config           |
| `config trust list --init`               | Initialize with default patterns     |

### Other

| Command                | Description                            |
| ---------------------- | -------------------------------------- |
| `stage [--dry-run]`    | Stage all approved hunks via git apply |
| `notes [--add "..."]`  | View or add review notes               |
```
