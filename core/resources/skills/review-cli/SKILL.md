---
description: Triage and stage code-review hunks with the `review` CLI — list hunks, bulk-approve trivial changes, record review status, and stage individual hunks to git. Use when the user wants help reviewing a diff, marking hunks reviewed/approved, or staging specific hunks (not whole files).
user_invocable: true
---

# Reviewing diffs with the `review` CLI

`review` is a CLI (from the Review desktop app) for working through a diff hunk
by hunk. It has two independent command families that both address hunks by an
ID of the form `filepath:hash`:

- **Review state** — record what you've reviewed. Persists to `~/.review/` and
  drives the desktop app. Operates on a *comparison* (`base..head`).
- **Git index** — stage/unstage individual hunks (not whole files).

Run `review --help` first to confirm it's installed and on PATH.

## Reviewing a comparison

`review hunks` lists every hunk in a comparison with its status — one of
`unreviewed`, `trusted`, `approved`, `rejected`, `saved`:

```
review hunks --json --diff           # every hunk + its diff, machine-readable
review hunks --status unreviewed      # just what's left to look at
review hunks --label "imports:*"      # filter by classification label
review hunks -s main..feature         # a specific comparison (default: auto-detected)
```

Mark hunks — IDs come from `review hunks`:

```
review approve <id>...                # looks good
review reject  <id>... --reason "…"   # needs changes
review save    <id>...                # decide later
review unmark  <id>...                # clear the status
```

Scale past one-at-a-time with the trust list: a trusted pattern auto-reviews
every hunk classified with that label, so you don't approve them by hand.

```
review trust list
review trust add "formatting:*"
```

Progress and hand-off:

```
review status                         # reviewed/total + overall state
review list                           # every saved review in the repo
review note set "…"                   # leave a summary the human sees in the app
```

## Staging hunks to git

`review changes` lists working-tree hunks; `stage` / `unstage` apply individual
hunks — or whole files — to the git index. This is the thing `git add` can't do
non-interactively: stage one hunk, not the whole file.

```
review changes --json --diff
review stage   <id>...                 # git add just these hunks
review unstage <id>...
review stage   path/to/file            # whole file
```

After staging, commit with normal `git`.

## Deep-linking hunks back to the desktop app

When you reference a hunk or file in your reply, hand the user a `review://`
deep link they can click to jump straight to it in the Review desktop app.
Generate one with `review url`:

```
review url <hunk-id>                      # link to a specific hunk
review url path/to/file.rs                # link to a file in the current comparison
review url --no-comparison path/to/file   # browse-mode link (no diff context)
review url -s main..feature <hunk-id>     # explicit comparison
```

The output is a single URL like `review://open?repo=…&compare=…&file=…&hunk=…`.
Paste it inline next to the hunk you're talking about — clicking it opens the
app focused on that hunk. Prefer one link per hunk reference rather than a list
of bare `file:hash` IDs.

## Working with the user

- **Read before acting.** Run `review hunks --json --diff` (or `review changes
  --json --diff`) and judge each hunk from its actual diff — don't mark blind.
- **Scope large diffs.** For a big PR, `--json --diff` of every hunk is a lot of
  context. Narrow with `--file 'src/**/*.rs'` or `--status unreviewed` and work
  file-by-file rather than reading the whole diff at once.
- **Propose, then act.** For bulk operations, first list the hunk IDs you intend
  to approve/stage and why, get a yes, *then* run the command. Never bulk-mutate
  unprompted.
- **Don't reuse IDs across families.** `review hunks` IDs are for
  `approve`/`reject`/`save`; `review changes` IDs are for `stage`/`unstage`. The
  same change can have a different ID in each — always list from the family
  you're about to act on.
- **Link, don't just name.** When pointing the user at a specific hunk or file,
  pair the human-readable label with a `review url` so they can jump to it.
- **Report back.** After triaging, `review note set` a short summary and tell
  the user what you left for them.
- The desktop app picks up CLI changes live; there's no need to reopen it.
