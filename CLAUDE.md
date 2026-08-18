# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Review is a desktop app (built with Tauri) that helps humans review diffs more efficiently. It classifies hunks (individual change blocks), enables bulk-approval of trivial changes, and focuses attention on what needs careful human review. It is **not** an AI code reviewer—it assists the review process.

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

# Linting/Formatting
scripts/fix              # Auto-fix: prettier + cargo fmt
scripts/pre-commit       # Check only: prettier --check + cargo fmt --check

# Build
scripts/build            # Build production app (outputs to target/release/)
```

### Remote Claude sessions (cloud containers)

Cloud sessions build everything — `review-daemon` and libghostty-vt included —
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
(`REVIEW_HOME=~/.review-dev target/debug/review-daemon &`), run
`scripts/dev-web`, and drive `http://localhost:1420` headlessly — screenshots,
mobile-viewport emulation, and real terminal round-trips all work. The `review`
CLI (`--home ~/.review-dev`) is handy for poking sessions from the outside.

### Isolated dev instance (`$REVIEW_HOME`)

**Agents: always test against an isolated home (`REVIEW_HOME=~/.review-dev`)
unless Dave explicitly says otherwise.** The default home is his live app —
its terminals run his real work, and browser keystrokes, tab clicks, panel
toggles (some persisted), and scratch sessions all land in it.

Everything — state, `work.json`, the daemon socket, the CLI↔app open-request
signal file, dev logs — resolves through the review home (`~/.review`, or
`$REVIEW_HOME`). To run a dev build fully separate from an installed released
app (its own daemon, terminals, and queue; the released app's sessions
untouched):

```bash
REVIEW_HOME=~/.review-dev scripts/dev          # isolated desktop dev app
review --home ~/.review-dev terminal list      # CLI against that instance
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

Communication: the frontend calls Rust via Tauri's `invoke()`, commands defined in `desktop/tauri/src/desktop/commands.rs`. Data flows: Rust computes diffs/hunks → Zustand stores state → user actions invoke Rust → Rust persists to `~/.review/`.

### Web Mode

`scripts/dev-web` runs the UI in a regular browser (Chrome) with an Axum HTTP backend instead of Tauri. This is the preferred way to develop and test UI changes — you get full Chrome devtools, fast hot reload, and no Tauri rebuild cycle. The frontend uses an `HttpClient` (fetch-based) instead of `TauriClient` (invoke-based), both implementing the same `ApiClient` interface. Use web mode when working on the UI — open `localhost:1420` in Chrome to test.

The backend defaults to `server::DEFAULT_PORT` (**7787**, `spur` on a phone keypad), overridable with `$REVIEW_PORT`. One constant, because the tailnet toggle below hands that number to `tailscale serve`.

### Serve on my tailnet

Settings → Remote access is the phone path: it starts the same Axum server **inside the desktop app** and points Tailscale at it. `desktop/tauri/src/desktop/remote.rs` owns both halves, and their lifetimes are deliberately different:

- The **server** is this process's. It serves the frontend already compiled into the binary — Tauri's asset resolver, reached through `server::AssetSource`, so nothing unpacks a `dist/` to disk — and stops when the app does, restarting on next launch from the `tailnetServeEnabled` setting.
- The **`tailscale serve` config** is tailscaled's. It persists across reboots and outlives the app entirely. Only turning the toggle off clears it.

`core/src/tailnet.rs` is the whole Tailscale interface, shelling out to the CLI (the local API socket is not a public contract). Two things it must keep doing: probing known install paths as well as `PATH`, because a Finder-launched app inherits launchd's environment and never sees `/usr/local/bin`; and checking `CertDomains` before running `serve`, since a tailnet without HTTPS certificates fails in a way whose fix is an admin-console setting the app can only name.

The origin gate needs no configuration for this — `tailscale serve` forwards the `.ts.net` Host, and `origin_allowed` already admits an Origin whose host matches the Host header.

Serving the app over HTTPS on a real name is what makes it **installable**: a service worker needs a secure context, so a plain `http://100.x.x.x:7787` bind would show the site but never install it.

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
gets the symmetric deliberate act — a "Fit to screen" button, shown only while
the drawing is scaled — which is the only way a phone resizes anything.

## Terminal VT engine

The embedded terminal's content peek replays PTY bytes into a screen model to answer "what is on screen right now?". That model is **libghostty-vt** — Ghostty's own VT core — so the peek agrees with the visible terminal on wide characters, emoji clusters, and combining marks instead of approximating them.

It is a native library, which puts two requirements on the build:

- **Zig 0.16+** on `PATH` (`brew install zig`). Zig 0.15.x cannot link against the macOS 26 SDK at all, and it fails inside its own build runner — the error names `build_zcu.o`, a file nobody wrote.
- **`vendor/ghostty` submodule**, which `.cargo/config.toml` points `GHOSTTY_SOURCE_DIR` at. The `libghostty-vt-sys` crate would otherwise fetch its own pinned Ghostty commit, which still requires Zig 0.15.2.

Only the `terminal` feature needs this, so only `review-daemon` (and `cargo test`) pay for it — the desktop app compiles against `terminal-types`, a serde-only wire contract, and needs no Zig.

**When bumping the submodule**, the pin has to satisfy both halves: buildable with the Zig in use, _and_ C headers matching the crate's checked-in bindings. Header drift is silent, not loud — Ghostty's option structs are size-prefixed, so a mismatch reads fields at the wrong offsets and the peek quietly renders scrollback instead of the visible screen. `engine_ghostty.rs`'s `renders_only_the_visible_viewport` test is the tripwire.

## Key Concepts

- **Hunk**: A single block of changes in a diff, identified by `filepath:hash`
- **Trust Pattern**: Label from the taxonomy (e.g., `imports:added`, `formatting:whitespace`)
- **Trust List**: Patterns the user has chosen to auto-approve
- **Comparison**: The base..compare refs being reviewed
- **Workspace**: One thing the user is working on — an optional title and an ordered list of **attachments**. It is a container that becomes whatever is put in it. Everything live (terminals, PRs, review state) is derived and joined against its attachments, or against the workspace id the daemon stamps on a session.
- **Attachment**: `{path, refName?}` — a repository (or a plain directory) the workspace shows, plus an optional view hint. **Not exclusive**: any number of workspaces may attach the same path, and a workspace shows a path at most once. Nothing here conflicts.

## Titles are derived

A workspace's title is `null` until someone types one. `Workspace::display_title` derives it live, in two rungs: the first attachment's label ("review · feature/x"), else "Untitled". A terminal's title never stands in — the title is what the workspace is _about_ (its attachments, or the human's words), and a terminal is something running in it, listed on the card as its own row. The wire carries both `title` (raw, nullable) and `displayTitle` (always set), so a rename field prefills with what the human typed rather than what was derived for them; renaming to an empty string clears the stored title and derivation resumes.

The **queue card** renders a derived title in italics — same colour and weight, visibly implicit — and absorbs the one chip that would repeat it (`repo · branch` twice on a two-line card said nothing new), moving that chip's PR and dirty marks up beside the title. Everything else on the card is explicit: every other attachment is a chip, and every terminal is a row with its own phase dot and pane count.

## Cleanup, not endorsement

`autoCreated` is set by the router alone and cleared by **every** mutation in `core/src/work/` (rename, move, attach, detach) — so it means, precisely, "nothing but the router has ever touched this". `work::cleanup` drops a workspace that is `autoCreated`, has no live terminal, and is past a 60s creation grace. Reviewing a comparison has no effect on the queue at all.

The other way one goes is an **event**, not a sweep, and it is the app's: closing a workspace's last terminal (`desktop/ui/components/Terminal/close.ts`) removes the workspace too, when it has no typed title and at most one attachment. That card says only what its repo already says, so re-opening the repo mints an identical one. It cannot be a `work::cleanup` rule — a passive sweep with the same predicate would also reap the branch someone queued up to read later and never ran anything in. Closing the terminal is what says the workspace is spent; a typed title or a second repo says a person built something here, and removing _that_ stays theirs.

## Shipped workspaces

The viewer-PR query asks GitHub for `states: OPEN`, so a merged PR does not change in the snapshot — it disappears from it. `service::viewer_prs::refresh_now` diffs each refresh against the previous cached snapshot, hands the departures to `service::shipped::record_departed`, and that asks `gh pr view` once per departure and keeps the answer in `~/.review/shipped_prs.json` (a merged or closed PR stays that way). Confirmed merges ride back on `ViewerPrSnapshot.shipped`, keyed by repo path and head branch so a workspace card can find its own attachment. No `gh` means no answer, which shows as nothing new.

A truncated snapshot on either side of the diff reports no departures at all: above the query's page of 100 open PRs a PR can leave the _window_ without leaving the open set, and treating those as departed would spend a `gh` call each on an answer of "still open". A viewer with more than a page of open PRs simply gets no shipped detection. `record_departed` is also capped per refresh, because each unsettled departure is a serial `gh` call under the refresh lock.

A workspace whose every attached branch has landed wears a **shipped** state — a tick on the card, `#N shipped` in place of the status phrase, and a "Remove" prompt on the card itself. Removal stays the user's alone.

## The `review` CLI

The `review` binary (built with `--features cli`, source in `core/src/cli/`) is the terminal- and Claude-driven interface to a review. Two command families share `filepath:hash` hunk IDs.

**Review state** — reads/writes `~/.review/`; the desktop app's file watcher picks up CLI changes live, no reopen needed.

- `review hunks [-s base..head] [--status|--file|--label|--hunk] [--json] [--diff]`
- `review approve|reject|save|unmark <hunk-id>... [--reason TEXT]`
- `review status` · `review list [--all]` · `review delete` · `review change-base <new-base>`
- `review history [--json]` · `review undo [--to N]` — every save moves the version it supersedes into `reviews/history/<review>/v<N>.json` (newest 50 kept); `history` lists them newest first with a terse diff of each, `undo` restores one as a **new** version, so an undo is itself undoable
- `review use [<spec>] [--clear]` — set/show the repo's default comparison. Every data command resolves its spec as `-s` flag → `$REVIEW_SPEC` → this default → auto-detect. `-s`/`--repo` are global (accepted in any position within a command).
- `review trust list|add|remove [<pattern>]`
- `review note show|set|append [<text>]`
- `review comments [--file GLOB] [--unresolved|--resolved] [--author NAME] [--json]`
- `review comments submit [FILE] [--author NAME] [--source ...] [--example]` — add many comments from a JSON array (stdin or FILE) in one write
- `review comment add <file>:<line>[:<end>] "<text>" [--side new|old|file] [--author NAME] [--source ui|cli|agent|github|gitlab]`
- `review comment edit|resolve|unresolve|delete <comment-id>`
- `review guide show [--json]` · `review guide add "<title>" <hunk-id>... [--desc TEXT]` · `review guide clear`

The **guide** is an agent-authored grouping of a comparison's hunks into a themed walkthrough. The desktop app renders it but no longer generates it — agents compose it via `review guide add` (each add lands live through the file watcher); `guide show` reconciles the stored groups against the current diff and reports any unplaced hunks as `ungrouped`.

**Work queue** — the sidebar's user-ordered "Working on" list, a priority queue of **workspaces**. Global (cross-repo), stored at `~/.review/work.json`; array order is the priority order. A workspace stores an optional title and its attachments; everything live (terminals, PRs, review state) is derived. Agents may read priorities and add/attach workspaces, but the ordering belongs to the user; only the user removes them in the UI (removal is their acknowledgment moment).

- `review work [list] [--json]` — numbered list; `--json` is global to the subcommand
- `review work add ["title"]` — the title is optional; adds always append
- `review work reorder <id> <position>` (1-based) · `review work rename <id> ["title"]` (no title clears it) · `review work remove <id>`
- `review work attach <id> [PATH] [--ref REF]` · `review work detach <id> [PATH]` — PATH defaults to the current directory
- `review work resolve [DIR]` — preview a route without writing
- `<id>` accepts unique prefixes

`core/src/work/router.rs` resolves any cwd to a workspace: the first one in queue order attached to that repo root (or plain directory when outside a repo), else a fresh one it mints (`autoCreated: true`) attached to it — so nothing the app shows is ever unattached. Because attachments are not exclusive, that tie-break is a heuristic: a wrong guess costs one drag of a terminal onto the right card. Naming a workspace explicitly (⌘T, `review terminal start --workspace`, ⌘K) lands there and **writes nothing** — what a workspace is about is answered by `attach`, not by where a shell happened to open.

A workspace's terminals are the daemon's record, not the queue's: each session carries a `workspaceId`, set by whoever started it (`review terminal start`, the app's `terminal_start` — both route first). That is what every surface groups by, what `DaemonClient::reassign_sessions` moves when a terminal is dragged to another card, and what keeps a router-made workspace alive. `work::cleanup` is lazy — it runs on the two reads that hold both the queue and the daemon's liveness answer, `review work list` and the app's `work_list` — so the daemon never writes `work.json`. **With no daemon reachable, neither read cleans anything up**: an empty liveness set means "nothing is running", never "I don't know".

**Git index** — stage individual hunks (the thing `git add` can't do non-interactively):

- `review changes [--staged|--unstaged|--file GLOB|--label PATTERN|--hunk ID] [--json] [--diff]`
- `review stage|unstage <hunk-id|file>...`

**Terminal sessions** — drive the daemon-backed terminals the desktop app shows. Thin clients of the `review-daemon` control socket (`~/.review/daemon.sock`); the daemon must already be running (the app spawns it). Ids accept unique prefixes.

- `review terminal list [--repo PATH|--all] [--json]` — one line per session: `id  phase  workspace  activity  cwd`, the workspace column falling back to the raw id (or `-`) when the queue doesn't know it · `review terminal start [--id NAME] [--cwd DIR] [--cols N] [--rows N] [--shell SH] [--workspace ID] [--json]` — `start` routes its cwd to a workspace and reports where it landed (`--json` carries the landing as `workspace: {id, title, created}`); `--workspace ID` names one instead, which attaches nothing. The daemon carries the id and never reads `work.json`
- `review terminal whoami [ID] [--json]` — which session this is and what workspace it is in. `ID` defaults to `$REVIEW_TERMINAL_ID`, which every session's shell inherits from `Session::spawn`. The workspace is **not** exported, because `AssignWorkspace` can move a session under a running shell — it is resolved live against `work.json` on every call, and an id that has left the queue says so rather than erroring
- `review terminal move <ID>... --workspace <WORKSPACE>` — the CLI's drag-to-card: resolves the workspace read-only and sends `AssignWorkspace` per session, writing nothing to `work.json`
- `review terminal send <id> [TEXT] [--key KEY]... [--enter|--submit [--settle-ms N]]` — write to the PTY; named keys: enter, tab, esc, backspace, space, arrows, home/end, ctrl-\<letter\>. `--enter` appends `\r` to the same write; `--submit` sends it as a _second_ write after a settle delay (500ms), which is what a TUI with an autocomplete popup open needs — Claude Code reads a newline arriving with the text as accepting the highlighted entry rather than submitting what was typed
- `review terminal peek <id>` — the whole visible screen (the libghostty-vt render), trimmed only of its trailing blank rows: the grid's height is the bound, and a line cap on top of it hid the top of any tall window drawing a short transcript. This is the truth about what is on screen right now
- `review terminal log <id> [-n N]` — a different question from a different source: the session's whole output history (the scrollback ring `Op::Replay` carries — the bytes a cold reattach replays — plus the current screen), cooked line-by-line with `wait --match`'s terminal semantics, `-n` tailing it like `docker logs`. It reaches past the screen but only approximates anything drawn with cursor moves
- `review terminal wait <id> [--until <phase|exit>] [--match REGEX] [--new-only] [--timeout SECS]` — block until a status transition, output matching the regex, or exit; built client-side on the stream connection. Bare `wait <id>` means `--until waiting-for-input` ("what I sent has finished"), which is the call agents actually make; `prompt` is an accepted alias for that phase. `--match` tests the current screen first and then the stream, so a line printed a moment _before_ the wait started still answers — the failure mode that used to be a timeout. `--new-only` (only meaningful with `--match`) skips the screen for the rarer "wait for the _next_ occurrence". The screen and the phase snapshot are both taken after subscribing, so a line landing in between is matched twice at worst and never missed
- `review terminal resize <id> --cols N --rows M` · `review terminal kill <id>...`

**Skills**: one bundled skill, `review-app`, covering all three surfaces an agent touches — reviewing a diff (hunks, trust, guide, comments), driving the app's terminals, and reading/feeding the work queue. The canonical source is `core/resources/skills/review-app/SKILL.md`, `include_str!`-embedded into the binary so the shipped CLI carries it. `review skill install` writes it into `~/.claude/skills/` and `$CODEX_HOME/skills/` (defaulting to `~/.codex/skills/`), and deletes the superseded `review-guide` / `review-terminals` skills it previously installed.

Source layout: `mod.rs` (Cli, Commands enum, dispatch, comparison resolution shared with `review start`, `review use`); `common.rs` (`EffectiveStatus`, `mutate_review` retry, hunk-target parsing, spec-resolution precedence, `sync_classification`); `staging.rs`; `review_state.rs`; `comments.rs` (line-level comments / annotations + batch `comments submit`); `guide.rs` (guide grouping); `history.rs` (version history + undo); `skill.rs`; `terminal.rs` (daemon-backed terminal control). Mutations use optimistic version-conflict retry against `~/.review/.../*.json`.

## Debugging / Traces

In dev mode (`scripts/dev`), Rust backend logs are written to `~/.review/app.log` via `tauri-plugin-log`. Frontend `console.*` calls are also written to this same file. This is disabled in release builds.

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
