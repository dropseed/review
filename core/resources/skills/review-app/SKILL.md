---
description: Work with the Review desktop app through its `review` CLI — help a human get through a large diff or PR (triage hunks, trust-list the trivial ones, walk the rest as approve/reject/save decisions, leave comments, build a guide), drive the app's terminal sessions (start, send, peek, wait), and read or feed their work queue. Use whenever asked to help review a branch or PR, run something in a Review terminal, check what an agent in the app is doing, or see what the human is working on next.
user_invocable: true
---

# Working with the Review app

`review` is the CLI side of the Review desktop app. Everything it writes lands
live in the app — state goes to `~/.review/`, a file watcher picks it up, and
the human watches your decisions appear without reopening anything.

Three surfaces, one binary:

- **The review** — a diff broken into hunks the human approves, rejects, or
  saves for later. Hunk IDs are `filepath:hash`.
- **The terminals** — daemon-backed sessions the app embeds, which you can
  start, type into, and read.
- **The workspaces** — the user-ordered "Working on" queue in the sidebar.

Run `review --help` first to confirm the CLI is installed.

---

# Part 1 — Helping someone work through a large diff

If someone is asking for your help reviewing, the diff is almost certainly
bigger than they want to read end-to-end. Your job is to **shrink the pile of
decisions they have to make themselves**, and make each remaining one fast.
Not to do the review for them.

## 1. Get oriented before you read anything

```
review use                            # what comparison am I on?
review status                         # how many hunks, how many done
review hunks --status unreviewed --json   # no --diff yet — just the shape
```

Need a different comparison than the stored default? Scope it to yourself
first: `export REVIEW_SPEC=<spec>` (or `-s <spec>` per command). Both are
session-local and persist **nothing** — the human's app is unaffected.

`review use <spec>` and `review change-base <base>` are different animals:
durable repo settings that decide what the *human* lands on when they open the
app — today and weeks from now. A base pinned to a commit keeps accumulating
every change since, so a stale pin quietly becomes a giant rolling diff.
Set them only when the human asked to work against that comparison, tell them
it stays until cleared, and clear it yourself (`review use --clear`,
`review change-base --clear`) once its purpose is done. **Never pin a base
just so the app shows your own work** — that's what `$REVIEW_SPEC` is for, or
ask the human to open the comparison.

Count hunks per file. Scan the classification labels. Then tell the human in
2–3 sentences what you found: *"142 unreviewed hunks across 31 files. 47 are
formatting/imports, 12 look like a single rename, the other 83 need real
review. Want me to start by trust-listing the formatting?"*

## 2. Take out the trivially trustable stuff first

The trust list auto-approves any hunk matching a pattern. Use it for classes of
change that are mechanically obvious once you've sampled a few.

- Look at a few hunks in a category (e.g. `review hunks --label "imports:*" --diff`).
- If they're all the same shape and clearly fine, **propose** adding the pattern:
  *"I'd like to trust `imports:added` and `formatting:whitespace` — that would
  auto-approve 38 hunks. OK?"*
- After yes: `review trust add "imports:added"`. The hunks flip immediately.

This is how you make a 142-hunk diff become a 60-hunk diff in 30 seconds.

## 3. For a tangled diff, lay out a guide

Most diffs decompose cleanly by file, and the file-by-file walk below is enough.
But when the changes are *interleaved* — one concern smeared across many files,
or several unrelated concerns mixed together — a **guide** is worth building. It
groups hunks by theme so the human walks the change the way it was actually
made, not the way the filesystem happens to lay it out. The desktop app renders
the guide and lets them step through it group by group.

You build the guide; the app only displays it. Compose it from the hunk IDs you
already pulled with `review hunks`:

```
review guide clear                              # start fresh
review guide add "Refactor the auth module" auth.rs:1a2b core/session.rs:9f3c
review guide add "Wire the new flag through callers" cli.rs:4d5e api.rs:77a0
review guide show                               # what's grouped, what's left
```

Each `add` lands live in the app — the human watches the guide fill in. `show`
reports any hunks you haven't placed yet as `ungrouped`, so you can tell when
the layout is complete. Skip this for small or cleanly-per-file diffs; it's
overhead that only pays off when the structure is genuinely hard to follow.

## 4. Walk the rest as a small queue

For everything that's left, work **file by file** in small batches (≈5–10 hunks
at a time). For each batch:

- Pull the actual diffs yourself: `review hunks --file <path> --diff`. Don't
  paste them at the human — *you* read them.
- Bring the human a compact list. For each hunk:
  - One-line description of what it does.
  - A clickable deep link from `review url <hunk-id>` (so they can jump straight
    to it in the desktop app if they want to look).
  - Your recommendation: approve / reject / save / "your call".
- Ask for confirmations or overrides as a batch, not one at a time.
- Then act: `review approve <ids>`, `review reject <ids> --reason "…"`,
  `review save <ids> --reason "…"`. A mark you got wrong is recoverable —
  `review history` shows the versions and `review undo` puts one back.

Example of what to send the human:

> Next batch (`plain-admin/views/`, 6 hunks):
> - [Checkbox.html:e9a1](review://open?repo=…&hunk=…) — wraps input in a
>   span for styling. **Approve.**
> - [Input.html:42c0](review://open?repo=…&hunk=…) — adds `autocomplete="off"`
>   to all text inputs. **Your call** — intentional UX choice?
> - …
>
> OK to approve the 5 marked Approve and save the one I flagged?

## 5. Don't burn cycles on the hard ones mid-flow

If a hunk genuinely needs careful thought from the human (architectural
question, business-logic call, "is this the right abstraction"), don't stall the
queue — `review save <id> --reason "…"` it with a short note capturing the
question, and move on. Batch the saved ones at the end as "things I left for
you" so they can sit down with the desktop app and a coffee for those.

## 6. Leaving comments on specific lines

If you want the human to look at one specific line later — *not* a whole-hunk
question, but "look at line 42, this name is misleading" — drop a comment:

```
review comment add path/to/file.rs:42 "this name is misleading — `cache` suggests memoization"
review comment add path/to/file.rs:10-15 "consider extracting; same shape repeats 3x in this file"
```

Leaving more than one or two? Batch them instead — `review comments submit`
takes a JSON array (a file, or stdin) and lands them all in a single mutation:

```
review comments submit --example      # the JSON shape, written nowhere
review comments submit comments.json  # or pipe the array on stdin
```

Comments show up live on the lines in the desktop app, attributed to you
(`author` defaults to the repo's git user, or whatever the agent harness has set
via `$REVIEW_AUTHOR`). Use them sparingly — comments are for line-specific notes
the human will want context on, not for general review decisions, and not for
restating the obvious. If the question is "should this whole hunk land?", use
`save --reason` instead; that keeps it in the decision queue.

To check what's outstanding (yours or anyone else's):

```
review comments --unresolved
review comments --author claude       # just yours
review comment resolve <comment-id>   # when an issue is addressed
```

A few rules the CLI enforces strictly, so a script doesn't fail silently:

- Line numbers are **1-based** — `path:0` is rejected.
- `$REVIEW_SOURCE`, if set, must be one of `ui`, `cli`, `agent`, `github`,
  `gitlab` — a typo is a hard error, not a silent fallback.
- `resolve` / `unresolve` / `delete` are idempotent: re-running one prints
  `Already resolved` / `Already unresolved` / `Already deleted` and exits 0
  without touching the file. Acting on a missing comment ID is an error.

## 7. Hand off cleanly

```
review status                         # final tally
```

End by telling the human exactly what's left for them and where to find it (the
saved hunks are in the app's filters). The review note is the human's own space
— read it for context (`review note show`) but never write it. Anything you need
to persist belongs in agent-attributed surfaces: comments or `save --reason`.

## Two reflexes to maintain

- **Don't reuse hunk IDs across families.** `review hunks` IDs are for
  `approve` / `reject` / `save`. `review changes` IDs are for `stage` /
  `unstage`. The same change can have a different ID in each because the diff
  context differs. Always list from the family you're about to act on.
- **Always link, never just name.** When you mention a specific hunk to the
  human, attach a `review url` to it. They should never have to copy a
  `file:hash` ID and paste it somewhere.

## Staging hunks to git (separate flow)

`review changes` / `stage` / `unstage` are the *other* hunk family — they apply
individual hunks to the git index. Use them when the human asks to commit only
part of their working tree, not whole files:

```
review changes --json --diff
review stage   <id>...                 # git add just these hunks
review unstage <id>...
review stage   path/to/file            # whole file
```

After staging, commit with normal `git`.

---

# Part 2 — Driving the app's terminals

The Review desktop app embeds terminal sessions that live in a `review-daemon`
process (they survive the app quitting). `review terminal` talks to that same
daemon, so everything you do here shows up live in the app — and everything the
human sees in the app, you can see too.

Run `review terminal list --all` first. If it errors with "daemon is not
running", the Review app isn't open — ask the human to open it; you can't start
the daemon yourself.

```
review terminal list [--all|--repo PATH] [--json]     # sessions + phase + workspace + cwd
review terminal start [--id NAME] [--cwd DIR] [--workspace ID] [--json]
review terminal whoami [ID] [--json]                  # which session am I in?
review terminal move <id>... --workspace <ID>         # reattribute sessions
review terminal send <id> [TEXT] [--key KEY]... [--enter|--submit]
review terminal peek <id>                             # what's on screen right now
review terminal log <id> [-n N]                       # everything it has printed
review terminal wait <id> [--until <phase|exit>] [--match REGEX] [--new-only] [--timeout SECS]
review terminal resize <id> --cols N --rows M
review terminal kill <id>...
```

Ids accept any unique prefix and resolve across all repos. `--json` on
`list`/`start`/`wait` gives you the wire shapes. Named keys: `enter`, `tab`,
`esc`, `backspace`, `space`, `up`/`down`/`left`/`right`, `home`, `end`,
`ctrl-<letter>`.

Every session belongs to a workspace from birth. `start` routes its working
directory to one — joining the first workspace attached to that directory, or
creating one for it — and says which in its output (`--json` carries it as
`workspace: {id, title, created}`). `--workspace <id>` names one explicitly
instead, which lands the session there and attaches nothing. See Part 3 for the
queue those ids come from.

**If you are running inside a Review terminal, you can name yourself.** Every
session's shell carries `$REVIEW_TERMINAL_ID`, and `review terminal whoami`
turns that into the answer to "what workspace am I in?" — the session's id,
phase, cwd, and its workspace's id and title:

```
review terminal whoami            # this session
review terminal whoami --json     # the summary plus workspace: {id, title}
```

Ask rather than remember: a session's workspace can change under you (the human
dragging your terminal onto another card), which is why the id is exported and
the workspace is not. `review terminal move <id>... --workspace <id>` does that
same move from the CLI; it only reattributes sessions and writes nothing to the
queue.

The human's equivalents, if they ask: **⌘T** starts a terminal in whichever
workspace is focused, no questions asked, and **⌘K** then **⌘Enter** on a branch
row goes to that branch *and* starts a terminal there in one gesture.

## Ground rules

- **Don't type into a session you didn't start** unless the human asked you to.
  Sessions in `list` include the human's own shells and running agents; `peek`
  is always safe, `send` is not.
- **Start your own session for your own work** — `review terminal start --id
  <task-name>` — and `kill` it when you're done. Naming it makes the app's
  sidebar legible for the human.

## Phases, and when to trust them

Every session has a phase: `working` (command running), `waiting_for_input` (at
a prompt), `needs_attention` (bell/notification), `idle`. Phases come from
OSC 133 shell integration plus process polling. Check `shellIntegrationActive`
in `list --json` — when it's `false`, phase transitions are best-effort. Every
phase wait rests on them, bare `wait` included (it *is* `--until
waiting-for-input`), so for such a session prefer an explicit `--match` on
something the command itself prints, or `peek`.

## Patterns

**Run a command and wait for it to finish** — send, then wait. Bare `wait`
means "back at a prompt", which is exactly "the thing I sent has finished", so
it needs no flags beyond a `--timeout` when the default 60s is too short. The
phase check is race-free (a snapshot is taken after subscribing), so it's fine
if the command finishes before the wait starts:

```
review terminal send my-task 'cargo test' --enter
review terminal wait my-task --timeout 600
review terminal peek my-task            # read the result / exit status
```

`list --json` also carries `lastExitCode` per session.

**Wait for a long-running process to say something** — start it, then wait for
its startup line:

```
review terminal send dev-server 'npm run dev' --enter
review terminal wait dev-server --match 'Listening on|ready in' --timeout 120
```

`--match` tests the current screen first and then watches for new output, so it
still answers when the line landed a moment before you asked — checking on
something that was already running, or a command that finished faster than you
expected. Output is matched with terminal semantics applied (escape sequences
stripped, `\r` progress lines overwritten), so write regexes against what a
human sees, not raw bytes. Add `--new-only` for the opposite intent: ignore the
screen and wait for the *next* occurrence, e.g. a dev server printing "ready"
again after you triggered a restart.

**Read what's on screen, or everything it has printed:**

```
review terminal peek my-task            # the whole visible screen
review terminal log my-task             # the session's full output history
review terminal log my-task -n 100      # just the last 100 lines
```

`peek` is the terminal's grid rendered as text, exactly as the human sees it —
the answer to "what is it showing right now?". `log` is a different thing: the
session's byte stream cooked into lines, `docker logs` for a terminal, so it
reaches back past the screen — but a full-screen TUI, which draws itself with
cursor moves, only comes out approximately. Reach for it when a command printed
more than the window holds.

**Check on an agent or long task the human asked about** — read-only, any
session:

```
review terminal list --all
review terminal peek 7e0d               # prefix of the id from list
```

**Drive an interactive prompt** — send keys without text:

```
review terminal send my-task --key down --key enter
review terminal send my-task --key ctrl-c          # interrupt
```

**Type into a TUI (Claude Code, an agent, anything with autocomplete)** — use
`--submit` instead of `--enter`. It sends the text, waits for the UI to settle,
then presses Enter as a separate write; an Enter arriving in the same write as a
slash command is read as *accepting the popup's highlighted entry* rather than
submitting what you typed:

```
review terminal send agent-1 'summarize what you just did' --submit
review terminal send agent-1 '/compact' --submit --settle-ms 1000
review terminal peek agent-1                       # confirm it took the input
```

**Wait for a session to end** (you sent `exit`, or a one-shot command shell):

```
review terminal wait my-task --until exit
```

## Wrap up

Kill the sessions you started (`review terminal kill <id>`), leave everyone
else's alone, and tell the human what ran where — session ids included, so they
can peek at the scrollback in the app.

---

# Part 3 — Workspaces

`review workspace` is the global, cross-repo list of what the human intends to
work on, in their order. It's the "Working on" section at the top of the app's
sidebar, stored at `~/.review/work.json`; every change lands live through the
file watcher.

An item — a **workspace** — is a container that becomes whatever is put in it:
an optional title and an ordered list of **attachments** (`{path, refName?}` —
the repos it shows). Everything live (terminals, PRs, review state) is derived
by joining against those attachments, so the queue stays stable while the world
underneath it moves.

```
review workspace [list] [--json]                   # priority order, top first
review workspace add ["title"]                     # title optional
review workspace attach <id> [PATH] [--ref REF]    # show a repo in a workspace
review workspace detach <id> [PATH]
review workspace rename <id> ["title"]             # no title = derive one
review workspace resolve [DIR] [--json]            # what DIR routes to
```

`--json` is global to the subcommand (either side of it) and gives you
`{id, title, displayTitle, attachments: [{path, refName}], createdAt}` per
workspace. Ids accept unique prefixes. `PATH` defaults to the directory you're
running in.

**Titles are derived unless someone typed one.** `title` is null until a rename
sets it; `displayTitle` is what to show — the first attachment ("review ·
feature/x"), else "Untitled". A terminal's title never stands in: the title is
what the workspace is about, not what happens to be running in it. Use
`displayTitle` when you talk about a workspace.

**Attachments are not exclusive.** Two workspaces may show the same repo, so
`attach` never conflicts and never takes anything from anyone. Within one
workspace a path appears once; re-attaching it just updates the ref hint.

Some workspaces are the app's own: it makes one so a terminal opened in an
unattached directory has somewhere to live. Those are disposable — one with no
live terminal disappears from the list on its own a minute after it was made —
so don't treat one as a statement of the human's intent, and don't expect an id
you saw in a listing to still be there. Any edit you make to a workspace
(renaming, moving, attaching, detaching) makes it durable. Reviewing a
comparison does not: the queue and review state are independent now.

A workspace whose PRs have all merged shows as **shipped** in the app, with a
prompt to remove it. Removing is the human's — see below.

## Read priorities before you pick up work

**Array order is priority order** — item 1 is what the human wants worked on
next. When someone asks "what should I work on?", or when you're about to start
something on your own initiative, read the queue first:

```
review workspace list --json
```

Act on the top item that isn't already handled, and say which one you took. If
the thing you're about to do isn't in the queue at all, that's worth flagging —
it may be a detour from what they actually prioritized.

## Put your own work on the queue

Work you start should be visible to the human instead of running untracked. Add
an item, and attach the repo so the app can join terminals, PRs, and review
state onto it:

```
review workspace add "Fix the flaky terminal wait test"
review workspace attach 3f9a ~/code/other-repo --ref fix/flaky-wait
```

`add` **always appends to the end** — the newest thing is the least prioritized
until the human moves it. That's deliberate; don't work around it.

Before adding, check whether the work is already on the queue (`review
workspace list`) — nothing stops two workspaces covering the same repo, so duplicates are
yours to avoid. If one is already there, use it and tell the human you found
it.

## What is the human's, not yours

- **Never reorder.** `review workspace reorder` exists for the human (they drag
  the list in the app). Their ordering is their prioritization; silently promoting your
  own item steals that decision.
- **Never remove.** `review workspace remove` is the human's acknowledgment moment —
  taking something off the queue is how they register that it's done or
  abandoned. An agent deleting it means they never see it land.
- **Rename only what you added**, to sharpen a title you wrote yourself.

If you believe something should move up or come off the queue, say so and let
them do it.

---

# Command reference

Review state (operates on a review of a ref; the base is derived automatically,
override with a `base..ref` spec — transient — or `review change-base`, which
persists until cleared). `-s`/`--repo` are global — accepted anywhere within a
command:

```
review hunks   [--status|--file|--label|--hunk] [--json] [--diff]
review approve|reject|save|unmark <hunk-id>... [--reason TEXT] [--source ui|cli|agent|github|gitlab]
review status                          # progress + overall state
review list                            # all saved reviews
review history [--json]                # this review's saved versions + what each changed
review undo [--to N]                   # restore one as a new version — the safety net
                                       # under any bulk mark; undo is itself undoable
review use [<spec>] [--clear]          # show/set the repo's default comparison
                                       # — durable; prefer $REVIEW_SPEC / -s
                                       # for your own session
review change-base <new-base> [--clear]  # pin/unpin the review's base — durable,
                                       # decides what the app shows the human
review note show                       # the human's note — read-only for agents
review trust list|add|remove [<pattern>]
review comments [--file GLOB] [--unresolved|--resolved] [--author NAME]
review comments submit [FILE|-] [--author NAME] [--source ...] [--example]
review comment add <file>:<line>[-<end>] "<text>" [--side new|old|file]
review comment edit|resolve|unresolve|delete <comment-id>
review guide show [--json]             # the guided-review grouping + ungrouped hunks
review guide add "<title>" <hunk-id>... [--desc TEXT]
review guide clear                     # drop the guide
```

Git index (working tree):

```
review changes [--staged|--unstaged|--file GLOB|--label PATTERN|--hunk ID] [--json] [--diff]
review stage|unstage <hunk-id|file>...
```

Deep links:

```
review url <hunk-id>                      # link to a specific hunk
review url path/to/file                   # link to a file in the current comparison
review url -s main..feature <hunk-id>     # explicit comparison
review url --no-comparison path/to/file   # browse-mode link, no diff context
```
