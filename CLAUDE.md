# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Spur is a desktop app (built with Tauri) that helps humans review diffs more efficiently. It classifies hunks (individual change blocks), enables bulk-approval of trivial changes, and focuses attention on what needs careful human review. It is **not** an AI code reviewer—it assists the review process.

## Development Commands

```bash
# Setup
scripts/install          # Install dependencies (npm + cargo + submodule + pre-commit hook)
                         # Requires Zig 0.16+ — see "Terminal VT engine" below
scripts/remote-setup     # Same, for cloud/remote Claude containers (proxy-safe
                         # Zig install + dependency prefetch) — see below

# Desktop Development
scripts/dev              # Run in development mode with hot reload

# Web/Browser Development
scripts/dev-web          # Run UI in browser (Axum backend + Vite) — no Tauri needed

# Testing
scripts/test             # TypeScript type check + Rust tests (no API calls; needs Zig,
                         # and pays a one-time libghostty build on a cold target/)
scripts/test --ts        # Just the TypeScript half — no Rust toolchain, no Zig
scripts/test --rust      # Just the Rust half (what CI's macOS job runs)

# Linting/Formatting
scripts/fix              # Auto-fix: prettier + cargo fmt
scripts/pre-commit       # Check only: prettier --check + cargo fmt --check

# Build
scripts/build            # Build production app (outputs to target/release/)
```

### Remote Claude sessions (cloud containers)

Cloud sessions build everything — `spur-daemon` and libghostty-vt included —
but the container's egress proxy breaks Zig's fetcher twice over: `zig build`
does not honor `$HTTPS_PROXY`, and GitHub _archive_ downloads are refused even
though anonymous `git clone` of any public repo is allowed. Run
`scripts/remote-setup` once per container; it installs Zig, fetches the
`vendor/ghostty` submodule, and pre-fetches every Zig package dependency into
Zig's global cache (curl for plain tarballs; git-clone + `git archive` for
git deps — `git archive` reproduces GitHub's codeload tarball, so the pinned
hashes match). It is idempotent and fetches transitive deps to fixpoint, so
re-run it after any submodule bump.

Browser testing works in the container: headless Chromium is pre-installed
(`PLAYWRIGHT_BROWSERS_PATH` points Playwright at it — never run
`playwright install`). Start the daemon under an isolated home
(`SPUR_HOME=~/.spur-dev target/debug/spur-daemon &`), run
`scripts/dev-web`, and drive `http://localhost:1420` headlessly — screenshots,
mobile-viewport emulation, and real terminal round-trips all work. The `spur`
CLI (`--home ~/.spur-dev`) is handy for poking sessions from the outside.

### Isolated dev instance (`$SPUR_HOME`)

**Agents: always test against an isolated home (`SPUR_HOME=~/.spur-dev`)
unless Dave explicitly says otherwise.** The default home is his live app —
its terminals run his real work, and browser keystrokes, tab clicks, panel
toggles (some persisted), and scratch sessions all land in it.

Everything — state, `workspaces.json`, the daemon socket, the CLI↔app open-request
signal file, dev logs — resolves through the review home (`~/.spur`, or
`$SPUR_HOME`). To run a dev build fully separate from an installed released
app (its own daemon, terminals, and queue; the released app's sessions
untouched):

```bash
SPUR_HOME=~/.spur-dev scripts/dev          # isolated desktop dev app
spur --home ~/.spur-dev terminal list      # CLI against that instance
```

Without isolation, note that the desktop app restarts a daemon whose identity
(version + binary fingerprint) doesn't match its own — killing all live
terminal sessions — so a dev desktop build and the released app fight over the
default home's daemon. Thin clients (the CLI, the web-mode server) attach
without respawning and coexist with anything.

## Architecture

The project is organized as a Cargo workspace with two top-level directories:

- **`core/`** — Core Rust library + CLI. All business logic, no Tauri dependencies.
- **`desktop/`** — Desktop app. Contains `tauri/` (Rust Tauri crate) and `ui/` (React frontend).

Communication: the frontend calls Rust via Tauri's `invoke()`, commands defined in `desktop/tauri/src/desktop/commands.rs`. Data flows: Rust computes diffs/hunks → Zustand stores state → user actions invoke Rust → Rust persists to `~/.spur/`.

### Web Mode

`scripts/dev-web` runs the UI in a regular browser (Chrome) with an Axum HTTP backend instead of Tauri. This is the preferred way to develop and test UI changes — you get full Chrome devtools, fast hot reload, and no Tauri rebuild cycle. The frontend uses an `HttpClient` (fetch-based) instead of `TauriClient` (invoke-based), both implementing the same `ApiClient` interface. Use web mode when working on the UI — open `localhost:1420` in Chrome to test.

The backend defaults to `server::DEFAULT_PORT` (**7787**, `spur` on a phone keypad), overridable with `$SPUR_PORT`. One constant, because the tailnet toggle below hands that number to `tailscale serve`.

### Serve on my tailnet

Settings → Remote access is the phone path: it starts the same Axum server **inside the desktop app** and points Tailscale at it. `desktop/tauri/src/desktop/remote.rs` owns both halves, and their lifetimes are deliberately different:

- The **server** is this process's. It serves the frontend already compiled into the binary — Tauri's asset resolver, reached through `server::AssetSource`, so nothing unpacks a `dist/` to disk — and stops when the app does, restarting on next launch from the `tailnetServeEnabled` setting.
- The **`tailscale serve` config** is tailscaled's. It persists across reboots and outlives the app entirely. Only turning the toggle off clears it.

`core/src/tailnet.rs` is the whole Tailscale interface, shelling out to the CLI (the local API socket is not a public contract). Two things it must keep doing: probing known install paths as well as `PATH`, because a Finder-launched app inherits launchd's environment and never sees `/usr/local/bin`; and checking `CertDomains` before running `serve`, since a tailnet without HTTPS certificates fails in a way whose fix is an admin-console setting the app can only name.

The origin gate needs no configuration for this — `tailscale serve` forwards the `.ts.net` Host, and `origin_allowed` already admits an Origin whose host matches the Host header.

Serving the app over HTTPS on a real name is what makes it **installable**: a service worker needs a secure context, so a plain `http://100.x.x.x:7787` bind would show the site but never install it.

### Push to the phone

Web push rides on the tailnet PWA: the service worker (`desktop/public/sw.js`) subscribes against this instance's VAPID key, and `core/src/push.rs` keeps the key and every subscription in `~/.spur/push.json` (same version-envelope write as `workspaces.json`) and does the delivery. iOS only delivers to a PWA added to the Home Screen. Two senders: the desktop app's attention escalation (`desktop/tauri/src/desktop/notifications.rs`, which pushes only when you are away from the machine) and `spur notify` (always). Both go straight to the file, so the CLI needs no app or server running. The whole thing sits behind the `push` cargo feature — implied by `server`, opt-in for `cli` because it pulls a TLS stack and a vendored OpenSSL into an otherwise light binary; `scripts/cli` and `scripts/build-cli` enable it.

## One PTY grid: owners and viewers

A session's PTY has exactly one cols×rows, shared by every client — there is no
per-viewer size, and rendering its byte stream at any other width draws
garbage. So every surface showing a terminal is one of two things. An **owner**
fits the grid to its container and resizes the PTY (the desktop panel). A
**viewer** renders the grid at its true size, scaled down to fit, and never
resizes — the terminal overview's columns, and everything at phone width
(compact), so glancing at the PWA cannot reflow the session out from under the
desktop. Looking at a terminal never changes it; only deliberate use does.

The daemon enforces the one honest version of this: `Session::resize` is a
no-op for an unchanged size and otherwise fans `Resized` out to every
subscriber (`StreamFrame::Resized`, protocol v2 — the WS forwards it as a
`{"t":"resize"}` text frame, Tauri as `terminal:resized:{id}`). An owner
hearing a size it didn't ask for letterboxes at the remote grid and wears a
"sized elsewhere" badge; clicking or typing in it fits the grid back. Compact
gets the symmetric deliberate act: a phone resizes the grid only when it is
asked to in so many words, which is two buttons and nothing else — "Fit to
screen", shown only while the drawing is scaled, and the text-size steps, which
have to be a fit because a larger font on the same grid is drawn at a smaller
scale and comes out the size it was. Both go through the mounted pane
(`registry`'s `requestFit`), since clearing and restoring the drawing's
transform around the measurement is pane-local work.

## The daemon wire is versioned by name

Protocol 3 adds three things, all additive: an **events channel**
(`{"kind":"events"}`, one connection per client) carrying every session's
lifecycle — started, status, resized, workspace-assigned, exited, removed — so
a client takes one `Op::List` and is told the rest instead of polling for it;
**`scrollback` on `Op::Peek`**, which is what lets a peek reach above the
viewport; and **`Op::PeekMany`**, one round trip for a grid of cards.
`VersionInfo` now carries `features` — `["events", "peek-scrollback",
"peek-many"]` — alongside the integer.

From v3 on the integer stops moving. A client attaches when the protocol
matches exactly, **or** when the daemon is at 3+ and lists every name in that
client's `REQUIRED_FEATURES`. The daemon owns live PTYs, so bumping the integer
for an addition makes every older daemon unattachable — which means killing
sessions nobody asked to lose, over a capability most clients never use. A
breaking change is expressed from here on by _requiring a new feature name_;
the integer is reserved for a genuinely reshaped frame. The `spur` CLI plays
the same rule from the other side: the two commands that need
`peek-scrollback` say so in one line against an older daemon, and every other
command keeps working against a v2 one without even asking.

## PTY writes are chunked

Every byte a client writes to a session — the CLI's `send`, the desktop panel's
keystrokes and pastes, the web client — goes through `Session::write`, which
writes it in 512-byte chunks with a 10ms pause between them. The kernel tty
queue hands a raw-mode reader a 1024-byte burst first and the rest in a second
`read()`, and a TUI with a paste heuristic (Claude Code) takes that first burst
as a paste and shows only the tail as typed — so a 1.5KB `send` looked like it
had lost its head. Back-to-back chunks coalesce into the same read; the pause
is what keeps them apart. A chunk never ends inside an escape sequence or a
multi-byte UTF-8 character, since a bare ESC followed by silence is the Escape
key. The cost scales with the payload and is paid under the session's writer
lock, so a very large paste serializes other writers to that session while it
goes out.

## Terminal VT engine

The embedded terminal's content peek replays PTY bytes into a screen model to answer "what is on screen right now?". That model is **libghostty-vt** — Ghostty's own VT core — so the peek agrees with the visible terminal on wide characters, emoji clusters, and combining marks instead of approximating them.

It is a native library, which puts two requirements on the build:

- **Zig 0.16+** on `PATH` (`brew install zig`). Zig 0.15.x cannot link against the macOS 26 SDK at all, and it fails inside its own build runner — the error names `build_zcu.o`, a file nobody wrote.
- **`vendor/ghostty` submodule**, which `.cargo/config.toml` points `GHOSTTY_SOURCE_DIR` at. The `libghostty-vt-sys` crate would otherwise fetch its own pinned Ghostty commit, which still requires Zig 0.15.2.

Only the `terminal` feature needs this, so only `spur-daemon` (and `cargo test`) pay for it — the desktop app compiles against `terminal-types`, a serde-only wire contract, and needs no Zig.

**When bumping the submodule**, the pin has to satisfy both halves: buildable with the Zig in use, _and_ C headers matching the crate's checked-in bindings. Header drift is silent, not loud — Ghostty's option structs are size-prefixed, so a mismatch reads fields at the wrong offsets and the peek quietly renders scrollback instead of the visible screen. `engine_ghostty.rs`'s `renders_only_the_visible_viewport` test is the tripwire.

## Key Concepts

- **Hunk**: A single block of changes in a diff, identified by `filepath:hash`
- **Trust Pattern**: Label from the taxonomy (e.g., `imports:added`, `formatting:whitespace`)
- **Trust List**: Patterns the user has chosen to auto-approve
- **Comparison**: The base..compare refs being reviewed
- **Workspace**: One thing the user is working on — an optional title and an ordered list of **attachments**. It is a container that becomes whatever is put in it. Everything live (terminals, PRs, review state) is derived and joined against its attachments, or against the workspace id the daemon stamps on a session.
- **Attachment**: `{path, refName?}` — a repository (or a plain directory) the workspace shows, plus an optional view hint. **Not exclusive**: any number of workspaces may attach the same path, and a workspace shows a path at most once. Nothing here conflicts.

## An attachment is a path, not a promise of a repo

A workspace attaches whatever it is pointed at. A repository with no commits is
one (the git layer already names an unborn branch and diffs it against the empty
tree), and so is a directory that is not a repository at all — browsable, and
nothing more. Two derived facts carry the difference, neither of them stored:

- **`isGitRepo`** rides on each attachment in `WorkspaceView` (the wire shape
  every surface reads the queue through) and is read at serialization time, so
  `git init` in an attached directory flips it with no write to `workspaces.json`. It
  is what tells a surface which half of itself to draw: everything built on a
  diff — comparisons, hunks, review state, the branch picker — has nothing to
  say about a plain directory, which gets a file listing
  (`list_directory_plain`) instead.
- **Registration.** The sidebar's tree is built from the _registered_ repos
  (`central::list_registered_repos` → `activity_cache::snapshot_all`), so
  attaching now registers: `workspace::add`, `workspace::attach` and the router's
  auto-attach all call `workspace::register_attachments`, and a repo a card shows
  therefore has an activity row without anyone opening it first. It goes through
  `central::ensure_registered` rather than `register_repo`, because a repo that
  arrived by being attached has not been _used_ and must not reorder the
  recency-sorted list. It is the git registry, so plain directories stay out of
  it — everything reading it needs a `LocalGitSource`, and `is_working_tree` is
  the one predicate the registry, `LocalGitSource::new` and `isGitRepo` all ask.

## Workspaces nest

A workspace may sit under another (`parentId`), to any depth — how one that is
really a subtask of a larger one says so. `workspaces.json` stays a **flat array in
priority order**: `workspace::reflow` keeps each workspace immediately followed by
its own subtree, so the array is literally the order every surface renders and
everything that counts rows (⌘1–9, the rail, the palette, the sidebar's drop
gaps, `reorder`'s 1-based positions) goes on counting rows. `reflow` runs after
every write and on every read, which is also what heals a hand-edited file: a
`parentId` naming nothing is cleared (the child comes up a level, never
disappears) and a cycle is broken at its first member. Nesting cannot bump the
schema version, because an older `workspaces.json` loads as an _empty queue_ — the
field is additive, and an older build reading a newer file loses the nesting and
keeps the workspaces.

Two gestures, because they are asking different things. **Position** is a drag
onto a gap, `spur workspace reorder`, or `workspace_move`: the card lands as a
sibling of the row it displaces, and at the end of the list — where there is no
such row — at the top level, which is the only way _out_ of a group by drag.
The sidebar draws its insertion line at that depth so the line never promises
an indent the drop won't give. `keepParent` is the other question — reorder
among the siblings, leave the nesting alone — and is what the card menu's move
verbs mean. **Nesting in** is a drag of a card onto another card (or
`spur workspace nest <id> --under <id>`, `workspace_nest`), because a vertical
position can say where a card goes but never that it goes one level deeper. The
one impossible nesting is a workspace under itself or under its own descendant.

Removing a parent asks: the app offers "take the sub-workspaces too" or "keep
them and move them up a level" before it asks about terminals, since the answer
decides which shells are at stake. `spur workspace remove` promotes by default
and cascades with `--recursive` — a non-interactive surface has nobody to ask,
and the safe reading is the one that never takes work nobody looked at.

## Titles are derived

A workspace's title is `null` until someone types one. `Workspace::display_title` derives it live, in two rungs: the first attachment's label ("review · feature/x"), else "Untitled". A nested workspace's own title rarely says what it belongs to, so the wire also carries `ancestors` — the named chain above it, derived on every read — and every surface that shows a workspace out of the queue's own order uses it: the palette's rows (searchably, so a parent's name brings its children up), the collapsed rail's tooltips, a card's hover. A terminal's title never stands in — the title is what the workspace is _about_ (its attachments, or the human's words), and a terminal is something running in it, listed on the card as its own row. The wire carries both `title` (raw, nullable) and `displayTitle` (always set), so a rename field prefills with what the human typed rather than what was derived for them; renaming to an empty string clears the stored title and derivation resumes.

The **queue card** renders a derived title in italics — same colour and weight, visibly implicit — and absorbs the one chip that would repeat it (`repo · branch` twice on a two-line card said nothing new), moving that chip's PR and dirty marks up beside the title. Everything else on the card is explicit: every other attachment is a chip, and every terminal is a row with its own phase dot and pane count.

## Cleanup, not endorsement

`autoCreated` is set by the router alone and cleared by **every** mutation in `core/src/workspace/` (rename, move, attach, detach) — so it means, precisely, "nothing but the router has ever touched this". `workspace::cleanup` drops a workspace that is `autoCreated`, has no live terminal, and is past a 60s creation grace. Reviewing a comparison has no effect on the queue at all.

The other way one goes is an **event**, not a sweep, and it is the app's: closing a workspace's last terminal (`desktop/ui/components/Terminal/close.ts`) removes the workspace too, when it has no typed title and at most one attachment. That card says only what its repo already says, so re-opening the repo mints an identical one. It cannot be a `workspace::cleanup` rule — a passive sweep with the same predicate would also reap the branch someone queued up to read later and never ran anything in. Closing the terminal is what says the workspace is spent; a typed title or a second repo says a person built something here, and removing _that_ stays theirs.

Removal runs that event backwards: removing a card kills the terminals in it (`removeWorkspaceAndTerminals`, same file), after a confirmation naming each shell and what it is running. The card is the only place they are reachable from — the strip, the card's rows and the overview all group by the daemon's `workspaceId` — so a removal that spared them would leave them running invisibly, still holding whatever they were doing. Nothing live to lose means no dialog, so a dormant card is still one click. `spur workspace remove` is deliberately unchanged: a non-interactive surface has nobody to ask, and a terminal it orphans is still adoptable with `spur terminal move`.

## Shipped workspaces

The viewer-PR query asks GitHub for `states: OPEN`, so a merged PR does not change in the snapshot — it disappears from it. `service::viewer_prs::refresh_now` diffs each refresh against the previous cached snapshot, hands the departures to `service::shipped::record_departed`, and that asks `gh pr view` once per departure and keeps the answer in `~/.spur/shipped_prs.json` (a merged or closed PR stays that way). Confirmed merges ride back on `ViewerPrSnapshot.shipped`, keyed by repo path and head branch so a workspace card can find its own attachment. No `gh` means no answer, which shows as nothing new.

A truncated snapshot on either side of the diff reports no departures at all: above the query's page of 100 open PRs a PR can leave the _window_ without leaving the open set, and treating those as departed would spend a `gh` call each on an answer of "still open". A viewer with more than a page of open PRs simply gets no shipped detection. `record_departed` is also capped per refresh, because each unsettled departure is a serial `gh` call under the refresh lock.

A workspace whose every attached branch has landed wears a **shipped** state — a tick on the card, `#N shipped` in place of the status phrase, and a "Remove" prompt on the card itself. Removal stays the user's alone.

## The `spur` CLI

The `spur` binary (built with `--features cli`, source in `core/src/cli/`) is the terminal- and Claude-driven interface to a review. Two command families share `filepath:hash` hunk IDs.

**Review state** — reads/writes `~/.spur/`; the desktop app's file watcher picks up CLI changes live, no reopen needed.

- `spur hunks [-s base..head] [--status|--file|--label|--hunk] [--json] [--diff]`
- `spur approve|reject|save|unmark <hunk-id>... [--reason TEXT]`
- `spur status` · `spur list [--all]` · `spur delete` · `spur change-base <new-base>`
- `spur history [--json]` · `spur undo [--to N]` — every save moves the version it supersedes into `reviews/history/<review>/v<N>.json` (newest 50 kept); `history` lists them newest first with a terse diff of each, `undo` restores one as a **new** version, so an undo is itself undoable
- `spur use [<spec>] [--clear]` — set/show the repo's default comparison. Every data command resolves its spec as `-s` flag → `$SPUR_SPEC` → this default → auto-detect. `-s`/`--repo` are global (accepted in any position within a command).
- `spur trust list|add|remove [<pattern>]`
- `spur note show|set|append [<text>]`
- `spur comments [--file GLOB] [--unresolved|--resolved] [--author NAME] [--json]`
- `spur comments submit [FILE] [--author NAME] [--source ...] [--example]` — add many comments from a JSON array (stdin or FILE) in one write
- `spur comment add <file>:<line>[:<end>] "<text>" [--side new|old|file] [--author NAME] [--source ui|cli|agent|github|gitlab]`
- `spur comment edit|resolve|unresolve|delete <comment-id>`
- `spur guide show [--json]` · `spur guide add "<title>" <hunk-id>... [--desc TEXT]` · `spur guide clear`

The **guide** is an agent-authored grouping of a comparison's hunks into a themed walkthrough. The desktop app renders it but no longer generates it — agents compose it via `spur guide add` (each add lands live through the file watcher); `guide show` reconciles the stored groups against the current diff and reports any unplaced hunks as `ungrouped`.

**Workspaces** — the sidebar's user-ordered "Working on" list, a priority queue of **workspaces**. The CLI says `workspace` throughout: the queue is the list, the workspace is the thing in it, and the storage (`workspaces.json`) says so too. The old `work` alias is gone. Global (cross-repo), stored at `~/.spur/workspaces.json`; array order is the priority order. A workspace stores an optional title and its attachments; everything live (terminals, PRs, review state) is derived. Agents may read priorities and add/attach workspaces, but the ordering belongs to the user; only the user removes them in the UI (removal is their acknowledgment moment).

- `spur workspace [list] [--json]` — numbered list; `--json` is global to the subcommand
- `spur workspace add ["title"]` — the title is optional; adds always append
- `spur workspace reorder <id> <position>` (1-based, `--keep-parent` to stay in the group) · `spur workspace rename <id> ["title"]` (no title clears it) · `spur workspace remove <id> [--recursive]`
- `spur workspace nest <id> --under <id>` · `spur workspace unnest <id>` — a workspace may sit under another, to any depth; `list` indents to show it and `--json` carries `parentId`, `depth` and `ancestors`
- `spur workspace attach <id> [PATH] [--ref REF]` · `spur workspace detach <id> [PATH]` — PATH defaults to the current directory; a repository is registered on attach, and a plain directory attaches just the same (`--json` carries `isGitRepo` per attachment)
- `spur workspace resolve [DIR]` — preview a route without writing
- `<id>` accepts unique prefixes

`core/src/workspace/router.rs` resolves any cwd to a workspace: the first one in queue order attached to that repo root (or plain directory when outside a repo), else a fresh one it mints (`autoCreated: true`) attached to it — so nothing the app shows is ever unattached. Because attachments are not exclusive, that tie-break is a heuristic: a wrong guess costs one drag of a terminal onto the right card. Naming a workspace explicitly (⌘T, `spur terminal start --workspace`, ⌘K) lands there and **writes nothing** — what a workspace is about is answered by `attach`, not by where a shell happened to open.

A workspace's terminals are the daemon's record, not the queue's: each session carries a `workspaceId`, set by whoever started it (`spur terminal start`, the app's `terminal_start` — both route first). That is what every surface groups by, what `DaemonClient::reassign_sessions` moves when a terminal is dragged to another card, and what keeps a router-made workspace alive. `workspace::cleanup` is lazy — it runs on the two reads that hold both the queue and the daemon's liveness answer, `spur workspace list` and the app's `workspace_list` — so the daemon never writes `workspaces.json`. **With no daemon reachable, neither read cleans anything up**: an empty liveness set means "nothing is running", never "I don't know".

**Git index** — stage individual hunks (the thing `git add` can't do non-interactively):

- `spur changes [--staged|--unstaged|--file GLOB|--label PATTERN|--hunk ID] [--json] [--diff]`
- `spur stage|unstage <hunk-id|file>...`

**Terminal sessions** — drive the daemon-backed terminals the desktop app shows. Thin clients of the `spur-daemon` control socket (`~/.spur/daemon.sock`); the daemon must already be running (the app spawns it). Ids accept unique prefixes.

- `spur terminal list [--repo PATH|--all] [--json]` — one line per session: `id  phase  workspace  activity  cwd`, the workspace column falling back to the raw id (or `-`) when the queue doesn't know it · `spur terminal start [--id NAME] [--cwd DIR] [--cols N] [--rows N] [--shell SH] [--workspace ID] [--json]` — `start` routes its cwd to a workspace and reports where it landed (`--json` carries the landing as `workspace: {id, title, created}`); `--workspace ID` names one instead, which attaches nothing. The daemon carries the id and never reads `workspaces.json`
- `spur terminal whoami [ID] [--json]` — which session this is and what workspace it is in. `ID` defaults to `$SPUR_TERMINAL_ID`, which every session's shell inherits from `Session::spawn`. The workspace is **not** exported, because `AssignWorkspace` can move a session under a running shell — it is resolved live against `workspaces.json` on every call, and an id that has left the queue says so rather than erroring
- `spur terminal move <ID>... --workspace <WORKSPACE>` — the CLI's drag-to-card: resolves the workspace read-only and sends `AssignWorkspace` per session, writing nothing to `workspaces.json`
- `spur terminal send <id> [TEXT|--file PATH] [--paste] [--key KEY]... [--enter|--submit [--settle-ms N]]` — write to the PTY; named keys: enter, tab, esc, backspace, space, arrows, home/end, ctrl-\<letter\>. `--enter` appends `\r` to the same write; `--submit` sends it as a _second_ write after a settle delay (500ms), which is what a TUI with an autocomplete popup open needs — Claude Code reads a newline arriving with the text as accepting the highlighted entry rather than submitting what was typed. `--settle-ms` delays only that Enter, never the text. A `--submit` of text spanning lines goes out as a bracketed paste, because a bare newline is itself a submit — the whole shape (bracket, settle, separate Enter) is `terminal::submit_message`, shared with the web server's `/api/terminal/submit`. `--file PATH` (`-` for stdin) reads the text from a file, bytes unmodified (a trailing newline is an Enter); `--paste` wraps it in bracketed-paste markers (`\e[200~ … \e[201~`, Enter outside them) so a TUI takes a multi-line prompt as one paste — no per-line submit, no autoindent — rather than as keystrokes. Only for a program that has enabled paste mode; a plain shell would see the markers as text
- `spur terminal peek <id> [--scrollback N]` — the whole visible screen (the libghostty-vt render), trimmed only of its trailing blank rows: the grid's height is the bound, and a line cap on top of it hid the top of any tall window drawing a short transcript. This is the truth about what is on screen right now. `--scrollback N` prepends N rows of what has already scrolled past it, and needs a daemon serving `peek-scrollback`
- `spur terminal log <id> [-n N]` — the same render at full depth: every row the VT engine still holds, history and current screen alike, `-n` tailing it like `docker logs`. Because it is the engine's render and not the byte stream that fed it, a TUI drawing itself with cursor moves comes out as what it drew. Needs `peek-scrollback`; against an older daemon it says so and names the fix
- `spur terminal wait <id> [--until <phase|exit>] [--match REGEX] [--new-only] [--timeout SECS]` — block until a status transition, output matching the regex, or exit; built client-side on the stream connection. Bare `wait <id>` means `--until waiting-for-input` ("what I sent has finished"), which is the call agents actually make; `prompt` is an accepted alias for that phase. `--match` tests the current screen first and then the stream, so a line printed a moment _before_ the wait started still answers — the failure mode that used to be a timeout. `--new-only` (only meaningful with `--match`) skips the screen for the rarer "wait for the _next_ occurrence". The screen and the phase snapshot are both taken after subscribing, so a line landing in between is matched twice at worst and never missed
- `spur terminal resize <id> --cols N --rows M` · `spur terminal kill <id>...`

**Push notifications** — `spur notify "<title>" [--body TEXT] [--url URL] [--tag TAG] [--json]` sends a web push to every device subscribed through Settings → Push notifications. Unlike the app's own attention escalation, which only pushes once the human is away from the machine, a CLI send is an explicit act and always goes out. Exits non-zero when nothing was delivered; `--json` prints the `SendReport` (`subscriptions`, `sent`, `failed`, `pruned`). Only present in a CLI built with the `push` feature (see "Push to the phone").

**Skills**: one bundled skill, `spur-app`, covering all three surfaces an agent touches — reviewing a diff (hunks, trust, guide, comments), driving the app's terminals, and reading/feeding the workspace queue. The canonical source is `core/resources/skills/spur-app/SKILL.md`, `include_str!`-embedded into the binary so the shipped CLI carries it. `spur skill install` writes it into `~/.claude/skills/` and `$CODEX_HOME/skills/` (defaulting to `~/.codex/skills/`), and deletes the superseded `review-guide` / `review-terminals` skills it previously installed.

Source layout: `mod.rs` (Cli, Commands enum, dispatch, comparison resolution shared with `spur start`, `spur use`); `common.rs` (`EffectiveStatus`, `mutate_review` retry, hunk-target parsing, spec-resolution precedence, `sync_classification`); `staging.rs`; `review_state.rs`; `comments.rs` (line-level comments / annotations + batch `comments submit`); `guide.rs` (guide grouping); `history.rs` (version history + undo); `notify.rs` (`spur notify` web push); `skill.rs`; `terminal.rs` (daemon-backed terminal control); `workspace.rs` (the `spur workspace` queue commands). Mutations use optimistic version-conflict retry against `~/.spur/.../*.json`.

## Debugging / Traces

In dev mode (`scripts/dev`), Rust backend logs are written to `~/.spur/app.log` via `tauri-plugin-log`. Frontend `console.*` calls are also written to this same file. This is disabled in release builds.

- `scripts/traces` — Print the full log file
- `scripts/traces -f` — Tail logs live while the app is running
- `scripts/traces -n 100` — Show last 100 lines

Key commands that include timing in their log output (look for `in <duration>`):

- `list_files` / `list_all_files` — Git file listing
- `get_all_hunks` — Git diff + hunk parsing (includes sub-timings for diff vs parse)
- `get_file_content` — Single file content + diff retrieval
- `get_file_symbol_diffs` / `get_repo_symbols` — Tree-sitter symbol extraction
- `classify_hunks_static` — Static hunk classification
- `detect_hunks_move_pairs` — Move pair detection
- `generate_hunk_grouping` — Claude API grouping call (slowest, typically 5-30s)
- `search_file_contents` — Git grep search

When adding new commands, include timing with `Instant::now()` / `t0.elapsed()` in the success log line to keep this pattern consistent.

## Conventions

- **Error handling**: Rust uses `anyhow::Result`, Tauri commands return `Result<T, String>`, frontend uses try/catch on `invoke()`
- **Tauri IPC**: Commands defined in `commands.rs` as `#[tauri::command]` fns, called from frontend via `invoke("command_name", { args })`
- **API abstraction**: `desktop/ui/api/` provides an `ApiClient` interface; `tauri-client.ts` wraps `invoke()` calls
- **Platform abstraction**: `desktop/ui/platform/` abstracts Tauri vs web (storage, file paths)
- **Diff sources**: the `DiffSource` trait abstracts over where a diff comes from. `LocalGitSource` is the only implementation
