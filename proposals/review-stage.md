# `review stage` — stage reviewed hunks

## Problem

After reviewing a diff in the GUI (approving hunks, trusting patterns), there's no way to translate that into `git add`. Users must manually re-stage the same changes they just reviewed.

## Proposal

A `review stage` CLI command that stages all approved/trusted hunks from the working tree.

```
review stage           # stage reviewed hunks
review stage --dry-run # preview what would be staged
```

## How it works

1. Validate the current comparison has `working_tree: true`
2. Run `git diff` (unstaged only, not `git diff HEAD`) and parse into hunks
3. Match each hunk ID against the review state — include if explicitly approved or labels match trust list
4. For each file:
   - **All hunks approved** → `git add <file>`
   - **Some hunks approved** → construct a patch with only those hunks, apply via `git apply --cached`
5. Report what was staged

Using the unstaged diff (rather than the comparison diff) means already-staged and committed changes are naturally skipped.

## Files changed

| File | Change |
|------|--------|
| `review/src/cli/commands/stage.rs` | New command implementation |
| `review/src/cli/commands/mod.rs` | Add `pub mod stage;` |
| `review/src/cli/mod.rs` | Add `Stage` variant + dispatch |
| `review/src/sources/local_git.rs` | Add `get_unstaged_diff()`, `stage_file()`, `apply_patch_to_index()` |

## Edge cases

- Non-working-tree comparison → error message
- No reviewed unstaged hunks → informational message
- Binary/deleted files → whole-file `git add`
- Partial `git apply` failure → report per-file, continue with others
- Untracked files → skipped (not in `git diff` output)
