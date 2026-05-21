---
description: Help a human work through a large diff with the `review` CLI. Triage hunks, trust-list the trivial ones, walk the rest as a manageable queue of approve/reject/save decisions, and hand back a summary. Use when the user wants help reviewing a PR or branch they don't want to read by hand.
user_invocable: true
---

# Helping someone work through a large diff

`review` is a CLI (from the Review desktop app) for working through a diff hunk
by hunk. Hunk IDs are `filepath:hash`. State persists to `~/.review/` and shows
up live in the desktop app — the human can watch your decisions land.

If someone is asking for your help reviewing, the diff is almost certainly
bigger than they want to read end-to-end. Your job is to **shrink the pile of
decisions they have to make themselves**, and make each remaining one fast.
Not to do the review for them.

Run `review --help` first to confirm the CLI is installed.

## The session

### 1. Get oriented before you read anything

```
review status                         # how many hunks, how many done
review hunks --status unreviewed --json   # no --diff yet — just the shape
```

Count hunks per file. Scan the classification labels. Then tell the human in
2–3 sentences what you found: *"142 unreviewed hunks across 31 files. 47 are
formatting/imports, 12 look like a single rename, the other 83 need real
review. Want me to start by trust-listing the formatting?"*

### 2. Take out the trivially trustable stuff first

The trust list auto-approves any hunk matching a pattern. Use it for
classes of change that are mechanically obvious once you've sampled a few.

- Look at a few hunks in a category (e.g. `review hunks --label "imports:*" --diff`).
- If they're all the same shape and clearly fine, **propose** adding the pattern:
  *"I'd like to trust `imports:added` and `formatting:whitespace` — that would
  auto-approve 38 hunks. OK?"*
- After yes: `review trust add "imports:added"`. The hunks flip immediately.

This is how you make a 142-hunk diff become a 60-hunk diff in 30 seconds.

### 3. Walk the rest as a small queue

For everything that's left, work **file by file** in small batches (≈5–10
hunks at a time). For each batch:

- Pull the actual diffs yourself: `review hunks --file <path> --diff`. Don't
  paste them at the human — *you* read them.
- Bring the human a compact list. For each hunk:
  - One-line description of what it does.
  - A clickable deep link from `review url <hunk-id>` (so they can jump
    straight to it in the desktop app if they want to look).
  - Your recommendation: approve / reject / save / "your call".
- Ask for confirmations or overrides as a batch, not one at a time.
- Then act: `review approve <ids>`, `review reject <ids> --reason "…"`,
  `review save <ids> --reason "…"`.

Example of what to send the human:

> Next batch (`plain-admin/views/`, 6 hunks):
> - [Checkbox.html:e9a1](review://open?repo=…&hunk=…) — wraps input in a
>   span for styling. **Approve.**
> - [Input.html:42c0](review://open?repo=…&hunk=…) — adds `autocomplete="off"`
>   to all text inputs. **Your call** — intentional UX choice?
> - …
>
> OK to approve the 5 marked Approve and save the one I flagged?

### 4. Don't burn cycles on the hard ones mid-flow

If a hunk genuinely needs careful thought from the human (architectural
question, business-logic call, "is this the right abstraction"), don't
stall the queue — `review save <id> --reason "…"` it with a short note
capturing the question, and move on. Batch the saved ones at the end as
"things I left for you" so they can sit down with the desktop app and a
coffee for those.

### 5. Hand off cleanly

```
review status                         # final tally
review note set "…"                   # what's done, what's saved, what's blocked
```

The note shows up in the app. End by telling the human exactly what's left
for them and where to find it (the saved hunks are in the app's filters).

## Two reflexes to maintain

- **Don't reuse hunk IDs across families.** `review hunks` IDs are for
  `approve` / `reject` / `save`. `review changes` IDs are for `stage` /
  `unstage`. The same change can have a different ID in each because the
  diff context differs. Always list from the family you're about to act on.
- **Always link, never just name.** When you mention a specific hunk to the
  human, attach a `review url` to it. They should never have to copy a
  `file:hash` ID and paste it somewhere.

## Staging hunks to git (separate flow)

`review changes` / `stage` / `unstage` are the *other* command family —
they apply individual hunks to the git index. Use them when the human asks
to commit only part of their working tree, not whole files:

```
review changes --json --diff
review stage   <id>...                 # git add just these hunks
review unstage <id>...
review stage   path/to/file            # whole file
```

After staging, commit with normal `git`.

## Command reference

Review state (operates on a `base..head` comparison):

```
review hunks   [--status|--file|--label|--hunk] [--json] [--diff]
review approve|reject|save|unmark <hunk-id>... [--reason TEXT]
review status                          # progress + overall state
review list                            # all saved reviews
review note set|append|show [<text>]
review trust list|add|remove [<pattern>]
```

Git index (working tree):

```
review changes [--staged|--unstaged|--file GLOB] [--json] [--diff]
review stage|unstage <hunk-id|file>...
```

Deep links:

```
review url <hunk-id>                      # link to a specific hunk
review url path/to/file                   # link to a file in the current comparison
review url -s main..feature <hunk-id>     # explicit comparison
review url --no-comparison path/to/file   # browse-mode link, no diff context
```
