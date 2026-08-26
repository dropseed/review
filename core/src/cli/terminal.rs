//! `review terminal` — inspect and drive the app's terminal sessions.
//!
//! These commands are thin clients of the `review-daemon` control socket — the
//! same protocol the desktop app speaks — so an agent can list, start, read,
//! and write the very sessions the app shows. The daemon owns the PTYs;
//! nothing here bypasses it, and a session started here appears in the app
//! like any other.
//!
//! The agent-facing surface mirrors what terminal multiplexers expose to
//! scripts: raw input (`send`), a screen snapshot (`peek`, the libghostty-vt
//! render), the output history behind it (`log`, the same bytes a cold reattach
//! replays), and blocking waits (`wait --until <phase>` / `wait --match
//! <regex>`). The waits are built entirely client-side on the daemon's stream
//! connection — status transitions and raw output frames — so the daemon
//! needed no new ops.

use std::sync::LazyLock;
use std::time::Duration;

use base64::Engine as _;
use clap::{Args, Subcommand, ValueEnum};
use regex::Regex;
use serde_json::json;

use crate::daemon::{socket_path, DaemonClient, Op, ReplayPayload, StreamFrame, B64};
use crate::terminal::{
    trim_trailing_blank_lines, Phase, SessionStatus, TerminalSummary, TERMINAL_ID_ENV,
};
use crate::work::{self, router};

use super::common::{new_id_suffix, print_json, resolve_cwd_arg};

/// Message shown when the control socket can't be reached. The daemon is
/// spawned by the desktop app (and outlives it); the CLI only ever attaches.
const DAEMON_UNAVAILABLE: &str =
    "The terminal daemon is not running. Open the Review app to start it.";

#[derive(Debug, Args)]
pub struct TerminalArgs {
    #[command(subcommand)]
    pub action: TerminalAction,
}

#[derive(Debug, Subcommand)]
pub enum TerminalAction {
    /// List live terminal sessions
    List(ListArgs),
    /// Start a new terminal session
    Start(StartArgs),
    /// Report which session (and workspace) you are running in
    Whoami(WhoamiArgs),
    /// Move sessions to another workspace
    Move(MoveArgs),
    /// Print a plain-text snapshot of a session's visible screen
    Peek(TargetArgs),
    /// Print a session's output history (scrollback plus the current screen)
    Log(LogArgs),
    /// Send text and/or named keys to a session's stdin
    Send(SendArgs),
    /// Block until a session reaches a phase, prints matching output, or exits
    Wait(WaitArgs),
    /// Resize a session's PTY
    Resize(ResizeArgs),
    /// Terminate sessions
    Kill(KillArgs),
}

#[derive(Debug, Args)]
pub struct ListArgs {
    /// Repository path (defaults to the current directory's repo)
    #[arg(short, long)]
    pub repo: Option<String>,
    /// List sessions across every repo
    #[arg(long, conflicts_with = "repo")]
    pub all: bool,
    /// Output as JSON
    #[arg(long)]
    pub json: bool,
}

#[derive(Debug, Args)]
pub struct StartArgs {
    /// Repository path (defaults to the current directory's repo)
    #[arg(short, long)]
    pub repo: Option<String>,
    /// Working directory for the shell (defaults to the repo root)
    #[arg(long)]
    pub cwd: Option<String>,
    /// Terminal id (defaults to a generated one; pick a name agents can reuse)
    #[arg(long)]
    pub id: Option<String>,
    #[arg(long, default_value_t = 120)]
    pub cols: u16,
    #[arg(long, default_value_t = 40)]
    pub rows: u16,
    /// Shell to run (defaults to the daemon's default shell)
    #[arg(long)]
    pub shell: Option<String>,
    /// Workspace to start the session in (a unique id prefix); defaults to
    /// whatever the working directory routes to
    #[arg(long, value_name = "ID")]
    pub workspace: Option<String>,
    /// Output the session summary as JSON
    #[arg(long)]
    pub json: bool,
}

#[derive(Debug, Args)]
pub struct WhoamiArgs {
    /// Terminal id (a unique prefix is accepted); defaults to
    /// `$REVIEW_TERMINAL_ID`, the session this command is running in
    pub id: Option<String>,
    /// Output as JSON
    #[arg(long)]
    pub json: bool,
}

#[derive(Debug, Args)]
pub struct MoveArgs {
    /// Terminal ids (unique prefixes are accepted)
    #[arg(required = true)]
    pub ids: Vec<String>,
    /// Workspace to move them to (a unique id prefix)
    #[arg(long, value_name = "WORKSPACE")]
    pub workspace: String,
}

/// The `<id>` argument shared by every command that targets one session.
#[derive(Debug, Args)]
pub struct TargetArgs {
    /// Terminal id (a unique prefix is accepted; ids resolve across all repos)
    pub id: String,
}

#[derive(Debug, Args)]
pub struct LogArgs {
    #[command(flatten)]
    pub target: TargetArgs,
    /// Print only the last N lines (default: the whole history). This is a
    /// line-oriented rendering of the session's byte stream, not a grid render,
    /// so anything drawn with cursor moves comes out approximate — `peek` is
    /// the truth about what is on screen right now
    #[arg(short = 'n', long = "lines", value_name = "N")]
    pub lines: Option<usize>,
}

#[derive(Debug, Args)]
pub struct SendArgs {
    #[command(flatten)]
    pub target: TargetArgs,
    /// Text to type into the session, sent verbatim (no newline)
    pub text: Option<String>,
    /// Named keys to send after the text: enter, tab, esc, backspace, space,
    /// up/down/left/right, home, end, ctrl-<letter>
    #[arg(long = "key", value_name = "KEY")]
    pub keys: Vec<String>,
    /// Press Enter at the end (sugar for a trailing `--key enter`)
    #[arg(short, long)]
    pub enter: bool,
    /// Press Enter as a *separate* write, after letting the session settle —
    /// for TUIs whose autocomplete popup would read a newline arriving with
    /// the text as "accept the highlighted entry"
    #[arg(long, conflicts_with = "enter")]
    pub submit: bool,
    /// How long `--submit` waits before pressing Enter
    #[arg(long, value_name = "MS", default_value_t = 500, requires = "submit")]
    pub settle_ms: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, ValueEnum)]
pub enum UntilArg {
    Working,
    /// Back at a prompt — the default, and what "my command finished" means
    #[value(alias = "prompt")]
    WaitingForInput,
    NeedsAttention,
    Idle,
    /// The session's child process exits
    Exit,
}

impl UntilArg {
    /// The phase this waits for; `Exit` waits for process exit instead.
    fn phase(self) -> Option<Phase> {
        match self {
            UntilArg::Working => Some(Phase::Working),
            UntilArg::WaitingForInput => Some(Phase::WaitingForInput),
            UntilArg::NeedsAttention => Some(Phase::NeedsAttention),
            UntilArg::Idle => Some(Phase::Idle),
            UntilArg::Exit => None,
        }
    }
}

#[derive(Debug, Args)]
pub struct WaitArgs {
    #[command(flatten)]
    pub target: TargetArgs,
    /// Phase to wait for, or `exit`. Defaults to waiting-for-input, which
    /// `prompt` also spells
    #[arg(long, value_enum)]
    pub until: Option<UntilArg>,
    /// Wait until the session's output matches REGEX — the current screen
    /// first, then anything printed while this command runs
    #[arg(long = "match", value_name = "REGEX")]
    pub match_output: Option<String>,
    /// Skip the screen check, so only output printed *after* this command
    /// starts can satisfy --match: waiting for the next occurrence
    #[arg(long, requires = "match_output")]
    pub new_only: bool,
    /// Give up after this many seconds
    #[arg(long, default_value_t = 60)]
    pub timeout: u64,
    /// Output the result as JSON
    #[arg(long)]
    pub json: bool,
}

impl WaitArgs {
    /// The phase this wait is actually watching for.
    ///
    /// Bare `wait <id>` is "the command I just sent has finished" — the call
    /// that gets made constantly, so it gets the zero-flag spelling. Asking for
    /// anything at all (a phase, or a pattern) means that is what was wanted
    /// instead.
    fn effective_until(&self) -> Option<UntilArg> {
        self.until.or_else(|| {
            self.match_output
                .is_none()
                .then_some(UntilArg::WaitingForInput)
        })
    }
}

#[derive(Debug, Args)]
pub struct ResizeArgs {
    #[command(flatten)]
    pub target: TargetArgs,
    #[arg(long)]
    pub cols: u16,
    #[arg(long)]
    pub rows: u16,
}

#[derive(Debug, Args)]
pub struct KillArgs {
    /// Terminal ids (unique prefixes are accepted)
    #[arg(required = true)]
    pub ids: Vec<String>,
}

/// Entry point: bridge the synchronous CLI onto the async daemon client.
pub fn run_terminal(args: TerminalArgs) -> Result<(), String> {
    super::common::block_on(dispatch(args.action))?
}

async fn dispatch(action: TerminalAction) -> Result<(), String> {
    let socket = socket_path().map_err(|e| e.to_string())?;
    let client = DaemonClient::connect(&socket)
        .await
        .map_err(|_| DAEMON_UNAVAILABLE.to_owned())?;

    match action {
        TerminalAction::List(args) => run_list(&client, args).await,
        TerminalAction::Start(args) => run_start(&client, args).await,
        TerminalAction::Whoami(args) => run_whoami(&client, args).await,
        TerminalAction::Move(args) => run_move(&client, args).await,
        TerminalAction::Peek(args) => run_peek(&client, args).await,
        TerminalAction::Log(args) => run_log(&client, args).await,
        TerminalAction::Send(args) => run_send(&client, args).await,
        TerminalAction::Wait(args) => run_wait(&client, args).await,
        TerminalAction::Resize(args) => run_resize(&client, args).await,
        TerminalAction::Kill(args) => run_kill(&client, args).await,
    }
}

/// Run one control op and decode its Ok payload.
async fn request<T: serde::de::DeserializeOwned>(
    client: &DaemonClient,
    op: Op,
) -> Result<T, String> {
    client.request_as(op).await.map_err(|e| format!("{e:#}"))
}

/// Run an op whose Ok payload carries nothing.
async fn ack(client: &DaemonClient, op: Op) -> Result<(), String> {
    request::<serde_json::Value>(client, op).await.map(|_| ())
}

async fn list_sessions(
    client: &DaemonClient,
    repo_path: Option<String>,
) -> Result<Vec<TerminalSummary>, String> {
    request(client, Op::List { repo_path }).await
}

/// Resolve a user-supplied id against the live sessions, accepting a unique
/// prefix so agents don't have to echo full UUIDs back.
async fn resolve_session(client: &DaemonClient, query: &str) -> Result<TerminalSummary, String> {
    let sessions = list_sessions(client, None).await?;
    let id = match_id(sessions.iter().map(|s| s.id.0.as_str()), query)?;
    // `match_id` picked the id out of this very list, so the find always hits.
    Ok(sessions
        .into_iter()
        .find(|s| s.id.0 == id)
        .expect("match_id returns an id from the list it was given"))
}

/// Like [`resolve_session`], for the commands that only need the id.
async fn resolve_id(client: &DaemonClient, query: &str) -> Result<String, String> {
    resolve_session(client, query).await.map(|s| s.id.0)
}

/// Exact match wins; otherwise a prefix must be unique.
fn match_id<'a>(ids: impl Iterator<Item = &'a str>, query: &str) -> Result<String, String> {
    let mut matches = Vec::new();
    for id in ids {
        if id == query {
            return Ok(id.to_owned());
        }
        if id.starts_with(query) {
            matches.push(id.to_owned());
        }
    }
    match matches.len() {
        0 => Err(format!("No terminal session matches '{query}'.")),
        1 => Ok(matches.remove(0)),
        _ => Err(format!(
            "'{query}' is ambiguous; it matches: {}",
            matches.join(", ")
        )),
    }
}

async fn run_list(client: &DaemonClient, args: ListArgs) -> Result<(), String> {
    // Outside a repo (and without --repo/--all), fall back to every session
    // rather than erroring — an agent asking "what terminals exist?" should
    // always get an answer.
    let repo_filter = if args.all {
        None
    } else if args.repo.is_some() {
        Some(super::get_repo_path(&args.repo)?)
    } else {
        super::get_repo_path(&None).ok()
    };

    let sessions = list_sessions(client, repo_filter).await?;
    if args.json {
        print_json(&sessions);
        return Ok(());
    }
    if sessions.is_empty() {
        println!("No terminal sessions.");
        return Ok(());
    }
    let titles = work::title_index();
    for s in &sessions {
        let activity = s
            .status
            .running_command
            .as_deref()
            .or(s.status.title.as_deref())
            .unwrap_or("-");
        println!(
            "{}  {}  {}  {}  {}",
            s.id,
            s.status.phase,
            work::label_for(&titles, s.workspace_id.as_deref()),
            activity,
            s.cwd
        );
    }
    Ok(())
}

async fn run_start(client: &DaemonClient, args: StartArgs) -> Result<(), String> {
    // One filesystem resolution feeds all three answers: which working tree the
    // session belongs to, where its shell starts, and which workspace owns it.
    let start = resolve_cwd_arg(args.cwd.clone().or_else(|| args.repo.clone()))?;
    let location = router::locate(&start);
    let repo_path = match &args.repo {
        // An explicit --repo is kept verbatim, because `terminal list --repo`
        // filters on the string the session was started with.
        Some(repo) => repo.clone(),
        None => location.working_tree.to_string_lossy().into_owned(),
    };
    // The shell starts where --cwd asked, or at the repo root.
    let cwd = match &args.cwd {
        Some(_) => start.to_string_lossy().into_owned(),
        None => repo_path.clone(),
    };
    let terminal_id = args
        .id
        .unwrap_or_else(|| format!("cli-{}", new_id_suffix()));

    // Every session belongs to a workspace from birth — the router places it,
    // and `--workspace` names one explicitly (which attaches nothing: naming
    // where a shell goes is not saying what the workspace is about).
    let landing = router::land(&location, args.workspace.as_deref()).map_err(|e| e.to_string())?;

    let summary: TerminalSummary = request(
        client,
        Op::Start {
            terminal_id,
            repo_path,
            cwd,
            cols: args.cols,
            rows: args.rows,
            shell: args.shell,
            workspace_id: Some(landing.workspace.id.clone()),
        },
    )
    .await?;

    let verb = if landing.created {
        "new workspace"
    } else {
        "joined"
    };
    if args.json {
        // The landing rides along with the session, so an agent gets one answer
        // to "what did I just start, and where did it land?".
        let mut payload = serde_json::to_value(&summary).map_err(|e| e.to_string())?;
        payload["workspace"] = json!({
            "id": landing.workspace.id,
            "title": landing.workspace.display_title(),
            "created": landing.created,
        });
        print_json(&payload);
    } else {
        println!(
            "Started terminal {} in {} · {verb} \"{}\" ({}).",
            summary.id,
            summary.cwd,
            landing.workspace.display_title(),
            landing.workspace.id
        );
    }
    Ok(())
}

/// Which session am I in, and what is it working on?
///
/// The id comes from the environment the daemon spawned the shell with; the
/// workspace does not, because attribution changes under a running shell
/// (dragging a terminal onto another card is an `AssignWorkspace`). So the id
/// is remembered and the workspace is asked for, every time.
async fn run_whoami(client: &DaemonClient, args: WhoamiArgs) -> Result<(), String> {
    let query = match args.id {
        Some(id) => id,
        None => std::env::var(TERMINAL_ID_ENV)
            .ok()
            .filter(|id| !id.is_empty())
            .ok_or_else(|| {
                format!(
                    "Not inside a Review terminal (${TERMINAL_ID_ENV} is not set). \
                     Pass an id to ask about another session."
                )
            })?,
    };
    let summary = resolve_session(client, &query).await?;

    // The daemon never validates a workspace id, so one that is no longer in
    // the queue is an answerable state, not an error.
    let workspace = summary.workspace_id.as_deref().map(|id| {
        let title = work::get(id).ok().map(|ws| ws.display_title());
        (id.to_owned(), title)
    });

    if args.json {
        let mut payload = serde_json::to_value(&summary).map_err(|e| e.to_string())?;
        payload["workspace"] = match &workspace {
            Some((id, title)) => json!({ "id": id, "title": title }),
            None => serde_json::Value::Null,
        };
        print_json(&payload);
        return Ok(());
    }

    println!(
        "Terminal {} · {} · {}",
        summary.id, summary.status.phase, summary.cwd
    );
    match &workspace {
        Some((id, Some(title))) => println!("Workspace \"{title}\" ({id})."),
        Some((id, None)) => println!("Workspace {id} (no longer in the queue)."),
        None => println!("No workspace: this session is unattributed."),
    }
    Ok(())
}

/// Move sessions onto another workspace — the CLI's half of dragging a
/// terminal onto a queue card, and like the drag it writes nothing: the
/// workspace is only resolved, never touched.
async fn run_move(client: &DaemonClient, args: MoveArgs) -> Result<(), String> {
    let workspace = work::get(&args.workspace).map_err(|e| e.to_string())?;
    // One list snapshot resolves every target, so a bad id in the batch is
    // caught before anything moves.
    let sessions = list_sessions(client, None).await?;
    let ids = args
        .ids
        .iter()
        .map(|target| match_id(sessions.iter().map(|s| s.id.0.as_str()), target))
        .collect::<Result<Vec<_>, _>>()?;

    for id in ids {
        client
            .assign_workspace(&id, Some(workspace.id.clone()))
            .await
            .map_err(|e| format!("{e:#}"))?;
        println!(
            "Moved {id} to \"{}\" ({}).",
            workspace.display_title(),
            workspace.id
        );
    }
    Ok(())
}

/// What is on screen: the VT grid rendered by libghostty-vt, so it agrees with
/// the terminal cell for cell. For what has scrolled past it, see [`run_log`].
async fn run_peek(client: &DaemonClient, args: TargetArgs) -> Result<(), String> {
    let id = resolve_id(client, &args.id).await?;
    let text: String = request(client, Op::Peek { terminal_id: id }).await?;
    println!("{text}");
    Ok(())
}

/// What the session has printed — `docker logs` for a terminal.
///
/// A different answer from a different source than [`run_peek`]'s: the daemon's
/// scrollback ring, the raw PTY bytes a cold reattach replays, cooked into
/// lines here. That reaches back past the screen, at the cost of only
/// approximating anything that draws itself with cursor moves.
async fn run_log(client: &DaemonClient, args: LogArgs) -> Result<(), String> {
    let id = resolve_id(client, &args.target.id).await?;
    let replay: ReplayPayload = request(client, Op::Replay { terminal_id: id }).await?;
    let bytes = B64
        .decode(replay.data_b64.as_bytes())
        .map_err(|e| format!("Could not decode the session's scrollback: {e}"))?;
    let mut text = cook_stream(&bytes);
    // The blank rows a screen's unused height leaves at the end are padding
    // whether or not `-n` was passed.
    trim_trailing_blank_lines(&mut text);
    println!(
        "{}",
        match args.lines {
            Some(n) => tail(&text, n),
            None => text,
        }
    );
    Ok(())
}

/// Render a whole PTY byte stream to plain text with the same terminal
/// semantics `wait --match` applies (see [`append_cooked`]). Unbounded on
/// purpose: the caller asked for history, and the ring is already finite.
fn cook_stream(bytes: &[u8]) -> String {
    let mut text = String::new();
    let mut pending_cr = false;
    append_cooked(&mut text, &mut pending_cr, &String::from_utf8_lossy(bytes));
    text
}

/// The last `n` lines of `text`, or all of them if it is shorter.
fn tail(text: &str, n: usize) -> String {
    let lines: Vec<&str> = text.lines().collect();
    lines[lines.len().saturating_sub(n)..].join("\n")
}

async fn run_send(client: &DaemonClient, args: SendArgs) -> Result<(), String> {
    let mut bytes = Vec::new();
    if let Some(text) = &args.text {
        bytes.extend_from_slice(text.as_bytes());
    }
    for key in &args.keys {
        bytes.extend_from_slice(&encode_key(key)?);
    }
    if args.enter {
        bytes.push(b'\r');
    }
    if bytes.is_empty() {
        return Err("Nothing to send: pass TEXT, --key, or --enter.".to_owned());
    }

    let id = resolve_id(client, &args.target.id).await?;
    client.write(&id, &bytes).await.map_err(|e| e.to_string())?;
    if args.submit {
        // A newline arriving in the same write as the text is ambiguous to a
        // TUI with an open autocomplete popup (Claude Code's slash commands):
        // it reads as accepting the highlighted entry rather than submitting
        // what was typed. Letting the UI settle first disambiguates it.
        tokio::time::sleep(Duration::from_millis(args.settle_ms)).await;
        client.write(&id, b"\r").await.map_err(|e| e.to_string())?;
        println!(
            "Sent {} byte(s) to {id}, then Enter after {}ms.",
            bytes.len(),
            args.settle_ms
        );
    } else {
        println!("Sent {} byte(s) to {id}.", bytes.len());
    }
    Ok(())
}

async fn run_resize(client: &DaemonClient, args: ResizeArgs) -> Result<(), String> {
    let id = resolve_id(client, &args.target.id).await?;
    ack(
        client,
        Op::Resize {
            terminal_id: id.clone(),
            cols: args.cols,
            rows: args.rows,
        },
    )
    .await?;
    println!("Resized {id} to {}x{}.", args.cols, args.rows);
    Ok(())
}

async fn run_kill(client: &DaemonClient, args: KillArgs) -> Result<(), String> {
    // One list snapshot resolves every target — and validates them all before
    // anything is killed.
    let sessions = list_sessions(client, None).await?;
    let ids = args
        .ids
        .iter()
        .map(|target| match_id(sessions.iter().map(|s| s.id.0.as_str()), target))
        .collect::<Result<Vec<_>, _>>()?;
    for id in ids {
        ack(
            client,
            Op::Kill {
                terminal_id: id.clone(),
            },
        )
        .await?;
        println!("Killed {id}.");
    }
    Ok(())
}

/// Translate a named key to the bytes a terminal expects for it.
///
/// Legacy encoding only: a session that has negotiated the Kitty keyboard
/// protocol expects different sequences for some of these, and the CLI does
/// not track that per-session state (today only the frontend does, in
/// `kitty-keys.ts`). Fine for shells and TUIs in their default mode; if it
/// ever bites, the deeper fix is a daemon-side send-key op encoded against
/// the session's own negotiated mode.
fn encode_key(key: &str) -> Result<Vec<u8>, String> {
    let k = key.to_ascii_lowercase();
    if let Some(letter) = k.strip_prefix("ctrl-").or_else(|| k.strip_prefix("c-")) {
        return match letter.as_bytes() {
            [b] if b.is_ascii_alphabetic() => Ok(vec![b & 0x1f]),
            _ => Err(format!("Unsupported key '{key}' (ctrl- takes one letter).")),
        };
    }
    let bytes: &[u8] = match k.as_str() {
        "enter" | "return" | "cr" => b"\r",
        "tab" => b"\t",
        "escape" | "esc" => b"\x1b",
        "backspace" => b"\x7f",
        "space" => b" ",
        "up" => b"\x1b[A",
        "down" => b"\x1b[B",
        "left" => b"\x1b[D",
        "right" => b"\x1b[C",
        "home" => b"\x1b[H",
        "end" => b"\x1b[F",
        _ => {
            return Err(format!(
                "Unknown key '{key}' (try enter, tab, esc, backspace, space, \
                 up/down/left/right, home, end, ctrl-<letter>)."
            ))
        }
    };
    Ok(bytes.to_vec())
}

/// What a `wait` resolved to.
#[derive(Debug)]
enum WaitOutcome {
    /// The session reached the requested phase.
    Phase(SessionStatus),
    /// New output matched the regex; carries the matching line, cleaned of
    /// escape sequences.
    Matched(String),
    /// The session's child exited.
    Exited(Option<i32>),
}

async fn run_wait(client: &DaemonClient, args: WaitArgs) -> Result<(), String> {
    let until = args.effective_until();
    let until_exit = until == Some(UntilArg::Exit);
    let until_phase = until.and_then(UntilArg::phase);
    let matcher = match &args.match_output {
        Some(pattern) => {
            Some(Regex::new(pattern).map_err(|e| format!("Invalid --match regex: {e}"))?)
        }
        None => None,
    };

    let id = resolve_id(client, &args.target.id).await?;
    let outcome = tokio::time::timeout(
        Duration::from_secs(args.timeout),
        wait_for(client, &id, until_phase, matcher.as_ref(), !args.new_only),
    )
    .await
    .map_err(|_| format!("Timed out after {}s waiting on {id}.", args.timeout))??;

    let (payload, line) = match outcome {
        // An exit is a success only when it's what was asked for; otherwise
        // the condition can never be met, and a scripting agent needs the
        // failure.
        WaitOutcome::Exited(code) => {
            let code_text = code.map_or_else(|| "unknown".to_owned(), |c| c.to_string());
            if !until_exit {
                return Err(format!(
                    "Session {id} exited (code {code_text}) before the wait condition was met."
                ));
            }
            (
                json!({ "exited": true, "exitCode": code }),
                format!("Session {id} exited (code {code_text})."),
            )
        }
        WaitOutcome::Phase(status) => {
            let line = format!("Session {id} is now {}.", status.phase);
            (
                serde_json::to_value(&status).map_err(|e| e.to_string())?,
                line,
            )
        }
        WaitOutcome::Matched(text) => (json!({ "matched": text }), format!("Matched: {text}")),
    };
    if args.json {
        print_json(&payload);
    } else {
        println!("{line}");
    }
    Ok(())
}

/// Watch one session's stream until a condition holds.
///
/// Subscribes *before* checking the current phase, so a transition landing
/// between the two is seen either by the snapshot (it already happened) or by
/// a later status frame (it hadn't yet) — never missed. The snapshot is a
/// second `Op::List` after `resolve_id`'s, and deliberately so: reusing the
/// pre-subscribe list would reopen the race.
///
/// Output matching tests the current screen first (`check_screen`), then
/// watches the stream. The screen check is what closes the real failure mode —
/// the line printed a moment *before* the wait started, which a stream-only
/// match can never see and would answer with a timeout. It runs after
/// subscribing, on the same ordering as the phase snapshot, so a line landing
/// between the two is seen twice at worst and never missed. `--new-only` turns
/// it off for the rarer intent: the *next* occurrence, not the last one.
async fn wait_for(
    client: &DaemonClient,
    id: &str,
    until_phase: Option<Phase>,
    matcher: Option<&Regex>,
    check_screen: bool,
) -> Result<WaitOutcome, String> {
    let mut stream = client
        .open_stream(id)
        .await
        .map_err(|e| format!("Could not open the output stream for {id}: {e}"))?;

    if let Some(regex) = matcher.filter(|_| check_screen) {
        let screen: String = request(
            client,
            Op::Peek {
                terminal_id: id.to_owned(),
            },
        )
        .await?;
        if let Some(line) = matched_line(&screen, regex) {
            return Ok(WaitOutcome::Matched(line));
        }
    }

    // Already there? (List includes each session's current status.)
    if let Some(want) = until_phase {
        let sessions = list_sessions(client, None).await?;
        if let Some(current) = sessions.into_iter().find(|s| s.id.0 == id) {
            if current.status.phase == want {
                return Ok(WaitOutcome::Phase(current.status));
            }
        }
    }

    // Rolling window of cooked output for regex matching, bounded so a chatty
    // session can't grow it without limit. Big enough that a match spanning
    // two PTY chunks still lands inside one window.
    const MATCH_WINDOW: usize = 64 * 1024;
    let mut window = String::new();
    let mut pending_cr = false;

    while let Some(frame) = stream.recv().await {
        match frame {
            StreamFrame::Status(raw) => {
                let Ok(status) = serde_json::from_value::<SessionStatus>(raw) else {
                    continue;
                };
                if until_phase == Some(status.phase) {
                    return Ok(WaitOutcome::Phase(status));
                }
            }
            StreamFrame::Output { data, .. } => {
                let Some(regex) = matcher else { continue };
                append_cooked(
                    &mut window,
                    &mut pending_cr,
                    &String::from_utf8_lossy(&data),
                );
                if let Some(line) = matched_line(&window, regex) {
                    return Ok(WaitOutcome::Matched(line));
                }
                if window.len() > MATCH_WINDOW {
                    let mut cut = window.len() - MATCH_WINDOW / 2;
                    while !window.is_char_boundary(cut) {
                        cut += 1;
                    }
                    window.drain(..cut);
                }
            }
            // A resize is nothing a wait is waiting on.
            StreamFrame::Resized { .. } => {}
            StreamFrame::Exit { exit_code } => return Ok(WaitOutcome::Exited(exit_code)),
            StreamFrame::Error { message } => return Err(message),
        }
    }
    // The daemon closes a stream *after* its exit frame, so getting here
    // means the connection died, not the session.
    Err(format!("Lost the output stream for {id}."))
}

/// The whole line a pattern matched on, so a caller learns *what* matched
/// rather than only that something did.
fn matched_line(text: &str, regex: &Regex) -> Option<String> {
    let found = regex.find(text)?;
    let start = text[..found.end()].rfind('\n').map_or(0, |i| i + 1);
    let line = text[start..].lines().next().unwrap_or_default();
    Some(line.trim_end().to_owned())
}

/// Escape sequences a PTY byte stream carries that a regex should never see:
/// CSI, OSC (also unterminated, at a chunk boundary), DCS, and lone C1
/// escapes (the letter after ESC is part of the sequence, not text).
static ANSI: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r"(?x)
          \x1b\[[0-9;:?]*[ -/]*[@-~]                 # CSI … final byte
        | \x1b\][^\x07\x1b]*(?:\x07|\x1b\\)?         # OSC … BEL/ST
        | \x1bP[^\x1b]*(?:\x1b\\)?                   # DCS … ST
        | \x1b[@-Z^_]                                # other C1 escapes
        ",
    )
    .expect("static regex")
});

/// Append a chunk of PTY output to the match window with terminal semantics
/// applied: escape sequences and non-printing controls dropped, and a bare
/// carriage return *overwriting* the current line (progress bars, spinners)
/// rather than concatenating onto it — so line-shaped regexes see roughly
/// what a human sees. `pending_cr` carries a chunk-final `\r` into the next
/// call, where the following character decides between a newline (CRLF) and
/// an overwrite.
fn append_cooked(window: &mut String, pending_cr: &mut bool, raw: &str) {
    for c in ANSI.replace_all(raw, "").chars() {
        if std::mem::take(pending_cr) && c != '\n' {
            // Carriage return not followed by newline: rewind to line start.
            window.truncate(window.rfind('\n').map_or(0, |i| i + 1));
        }
        match c {
            '\r' => *pending_cr = true,
            '\n' | '\t' => window.push(c),
            c if !c.is_control() => window.push(c),
            _ => {}
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Parse an argv into the terminal action it names.
    fn action(argv: &[&str]) -> TerminalAction {
        use clap::Parser;
        let cli = crate::cli::Cli::try_parse_from(argv).unwrap();
        let Some(crate::cli::Commands::Terminal(t)) = cli.command else {
            panic!("expected the terminal subcommand");
        };
        t.action
    }

    #[test]
    fn match_id_prefers_exact_then_unique_prefix() {
        let ids = ["abc-123", "abd-456", "abc"];
        // Exact match wins even when it's also a prefix of another id.
        assert_eq!(match_id(ids.iter().copied(), "abc").unwrap(), "abc");
        assert_eq!(match_id(ids.iter().copied(), "abd").unwrap(), "abd-456");
        assert_eq!(match_id(ids.iter().copied(), "abc-").unwrap(), "abc-123");
        let err = match_id(ids.iter().copied(), "ab").unwrap_err();
        assert!(err.contains("ambiguous"), "{err}");
        assert!(match_id(ids.iter().copied(), "zzz").is_err());
    }

    #[test]
    fn encode_key_covers_the_documented_names() {
        assert_eq!(encode_key("enter").unwrap(), b"\r");
        assert_eq!(encode_key("Tab").unwrap(), b"\t");
        assert_eq!(encode_key("esc").unwrap(), b"\x1b");
        assert_eq!(encode_key("up").unwrap(), b"\x1b[A");
        assert_eq!(encode_key("ctrl-c").unwrap(), vec![0x03]);
        assert_eq!(encode_key("C-d").unwrap(), vec![0x04]);
        assert!(encode_key("ctrl-1").is_err());
        assert!(encode_key("f13").is_err());
    }

    /// Feed chunks through `append_cooked` as the stream loop would.
    fn cooked(chunks: &[&str]) -> String {
        let mut window = String::new();
        let mut pending_cr = false;
        for chunk in chunks {
            append_cooked(&mut window, &mut pending_cr, chunk);
        }
        window
    }

    #[test]
    fn cooked_output_drops_escapes_and_keeps_text() {
        // CSI colors, OSC title, CRLF line endings, erase-line.
        assert_eq!(
            cooked(&["\x1b]0;title\x07\x1b[1;32mhello\x1b[0m\r\nworld\x1b[2K"]),
            "hello\nworld"
        );
        // An OSC left unterminated by a chunk boundary is still dropped.
        assert_eq!(cooked(&["ok\x1b]133;A"]), "ok");
        // Tabs survive.
        assert_eq!(cooked(&["a\tb"]), "a\tb");
    }

    #[test]
    fn cooked_output_applies_carriage_return_overwrites() {
        // Progress-style output: each \r rewinds to the line start, so only
        // the final state remains — what a human sees on screen.
        assert_eq!(cooked(&["progress 1\rprogress 2\rdone\r\n"]), "done\n");
        // A chunk-final \r followed by \n is an ordinary CRLF...
        assert_eq!(cooked(&["abc\r", "\ndef"]), "abc\ndef");
        // ...but followed by text it overwrites, even across the boundary.
        assert_eq!(cooked(&["abc\r", "xy"]), "xy");
        // Earlier completed lines are never touched.
        assert_eq!(cooked(&["line1\r\nspin\rok\r\n"]), "line1\nok\n");
    }

    #[test]
    fn move_parses_ids_and_the_workspace_flag() {
        use clap::Parser;
        let TerminalAction::Move(args) = action(&[
            "review",
            "terminal",
            "move",
            "abc",
            "def",
            "--workspace",
            "ws-1",
        ]) else {
            panic!("expected move");
        };
        assert_eq!(args.ids, ["abc", "def"]);
        assert_eq!(args.workspace, "ws-1");
        // The workspace is what a move is *for*, so it is not optional.
        assert!(crate::cli::Cli::try_parse_from(["review", "terminal", "move", "abc"]).is_err());
    }

    #[test]
    fn tail_takes_the_end_of_the_history() {
        let text = "one\ntwo\nthree";
        assert_eq!(tail(text, 2), "two\nthree");
        // Fewer lines than asked for is all of them, not an error.
        assert_eq!(tail(text, 99), "one\ntwo\nthree");
        assert_eq!(tail("", 5), "");
    }

    #[test]
    fn cook_stream_renders_the_whole_replay() {
        // The same semantics as the match window, applied to raw bytes.
        let bytes = b"\x1b[32mbuilding\x1b[0m\r\n50%\r100%\r\ndone\r\n";
        assert_eq!(cook_stream(bytes), "building\n100%\ndone\n");
    }

    #[test]
    fn log_takes_an_optional_line_count() {
        let TerminalAction::Log(log) = action(&["review", "terminal", "log", "abc"]) else {
            panic!("expected log");
        };
        // No -n is the whole history, docker-logs style.
        assert_eq!(log.lines, None);
        assert_eq!(log.target.id, "abc");

        for argv in [
            ["review", "terminal", "log", "abc", "-n", "20"],
            ["review", "terminal", "log", "abc", "--lines", "20"],
        ] {
            let TerminalAction::Log(log) = action(&argv) else {
                panic!("expected log");
            };
            assert_eq!(log.lines, Some(20));
        }
    }

    #[test]
    fn bare_wait_means_back_at_a_prompt() {
        let TerminalAction::Wait(wait) = action(&["review", "terminal", "wait", "abc"]) else {
            panic!("expected wait");
        };
        // The flag is absent; `run_wait` is what fills it in.
        assert_eq!(wait.until, None);
        assert_eq!(wait.match_output, None);
        assert_eq!(wait.effective_until(), Some(UntilArg::WaitingForInput));

        // `prompt` is the same phase said the short way.
        for name in ["waiting-for-input", "prompt"] {
            let TerminalAction::Wait(wait) =
                action(&["review", "terminal", "wait", "abc", "--until", name])
            else {
                panic!("expected wait");
            };
            assert_eq!(wait.until, Some(UntilArg::WaitingForInput));
            assert_eq!(wait.effective_until(), Some(UntilArg::WaitingForInput));
        }

        // Asking for a pattern is asking for that, not for the prompt.
        let TerminalAction::Wait(wait) =
            action(&["review", "terminal", "wait", "abc", "--match", "done"])
        else {
            panic!("expected wait");
        };
        assert_eq!(wait.effective_until(), None);
    }

    #[test]
    fn new_only_is_a_modifier_on_match() {
        let TerminalAction::Wait(wait) = action(&[
            "review",
            "terminal",
            "wait",
            "abc",
            "--match",
            "ready",
            "--new-only",
        ]) else {
            panic!("expected wait");
        };
        assert!(wait.new_only);
        // The screen is checked unless it is turned off.
        let TerminalAction::Wait(wait) =
            action(&["review", "terminal", "wait", "abc", "--match", "ready"])
        else {
            panic!("expected wait");
        };
        assert!(!wait.new_only);
        // There is no output to be "new" relative to without a pattern.
        use clap::Parser;
        assert!(crate::cli::Cli::try_parse_from([
            "review",
            "terminal",
            "wait",
            "abc",
            "--until",
            "idle",
            "--new-only",
        ])
        .is_err());
    }

    #[test]
    fn send_submit_is_the_deliberate_alternative_to_enter() {
        use clap::Parser;
        let TerminalAction::Send(send) =
            action(&["review", "terminal", "send", "abc", "/x", "--submit"])
        else {
            panic!("expected send");
        };
        assert!(send.submit);
        assert_eq!(send.settle_ms, 500);

        // Two ways to press Enter is one too many.
        assert!(crate::cli::Cli::try_parse_from([
            "review", "terminal", "send", "abc", "hi", "--submit", "--enter",
        ])
        .is_err());
        // The delay only means anything as part of a submit.
        assert!(crate::cli::Cli::try_parse_from([
            "review",
            "terminal",
            "send",
            "abc",
            "hi",
            "--settle-ms",
            "100",
        ])
        .is_err());
    }

    #[test]
    fn send_and_wait_parse_the_flattened_target_id() {
        let TerminalAction::Send(send) =
            action(&["review", "terminal", "send", "abc", "hi there", "--enter"])
        else {
            panic!("expected send");
        };
        assert_eq!(send.target.id, "abc");
        assert_eq!(send.text.as_deref(), Some("hi there"));
        assert!(send.enter);
    }
}

/// Integration coverage against a real daemon. `serve` needs the `daemon`
/// feature, which the test matrix always enables alongside `cli`.
#[cfg(all(test, feature = "daemon"))]
mod daemon_tests {
    use super::*;
    use crate::daemon::test_support::{peek_until, start_op, Harness, TIMEOUT};

    /// Start a `/bin/sh` session rooted in the harness temp dir.
    async fn start_session(harness: &Harness, client: &DaemonClient, id: &str) {
        let _: TerminalSummary = request(client, start_op(id, harness.dir.path()))
            .await
            .unwrap();
    }

    /// Spawn `wait_for` as a task, give it time to subscribe, then type
    /// `line` into the session and return the wait's outcome.
    ///
    /// Always new-output-only (`check_screen: false`), because what these tests
    /// are about is the stream loop — the screen check has its own tests.
    async fn wait_after(
        client: &DaemonClient,
        id: &str,
        pattern: Option<&str>,
        line: &str,
    ) -> WaitOutcome {
        let regex = pattern.map(|p| Regex::new(p).unwrap());
        let waiter = tokio::spawn({
            let client = client.clone();
            let id = id.to_owned();
            async move { wait_for(&client, &id, None, regex.as_ref(), false).await }
        });
        tokio::time::sleep(Duration::from_millis(200)).await;
        client
            .write(id, format!("{line}\r").as_bytes())
            .await
            .unwrap();
        tokio::time::timeout(TIMEOUT, waiter)
            .await
            .unwrap()
            .unwrap()
            .unwrap()
    }

    #[tokio::test]
    async fn wait_matches_new_output() {
        let harness = Harness::start().await;
        let client = harness.client().await;
        start_session(&harness, &client, "t-match").await;

        // The pattern requires the terminator so no *prefix* of the marker can
        // satisfy it: the PTY echoes the typed line back in arbitrary chunks,
        // and `marker-[0-9]+` alone matched a split "marker-4" ahead of the
        // "2;" still in flight. The window is cumulative, so by the time the
        // ";" arrives the whole marker is in it.
        let outcome = wait_after(
            &client,
            "t-match",
            Some("marker-[0-9]+;"),
            "echo marker-42;",
        )
        .await;
        match outcome {
            WaitOutcome::Matched(line) => assert!(line.contains("marker-42"), "{line}"),
            other => panic!("expected a match, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn wait_until_exit_sees_the_shell_leave() {
        let harness = Harness::start().await;
        let client = harness.client().await;
        start_session(&harness, &client, "t-exit").await;

        let outcome = wait_after(&client, "t-exit", None, "exit 0").await;
        assert!(
            matches!(outcome, WaitOutcome::Exited(_)),
            "expected an exit, got {outcome:?}"
        );
    }

    /// The wait that used to be unanswerable: the output landed before anyone
    /// asked, so a stream-only match would run to timeout. It is the default
    /// now, and `--new-only` is what opts back out of it.
    #[tokio::test]
    async fn match_checks_the_screen_by_default() {
        let harness = Harness::start().await;
        let client = harness.client().await;
        start_session(&harness, &client, "t-screen").await;

        client
            .write("t-screen", b"echo already-here;\r")
            .await
            .unwrap();
        peek_until(&client, "t-screen", |screen| {
            screen.contains("already-here")
        })
        .await;

        let regex = Regex::new("already-here").unwrap();
        let outcome = tokio::time::timeout(
            TIMEOUT,
            wait_for(&client, "t-screen", None, Some(&regex), true),
        )
        .await
        .unwrap()
        .unwrap();
        match outcome {
            WaitOutcome::Matched(line) => assert!(line.contains("already-here"), "{line}"),
            other => panic!("expected a match from the screen, got {other:?}"),
        }
    }

    /// `--new-only` asks for the *next* occurrence, so what is already on
    /// screen is not an answer — but the same line printed again is.
    #[tokio::test]
    async fn new_only_waits_past_what_is_already_on_screen() {
        let harness = Harness::start().await;
        let client = harness.client().await;
        start_session(&harness, &client, "t-screen").await;

        // The marker is assembled by the command rather than typed, so the
        // PTY's echo of the line can't be mistaken for the line's output —
        // seeing it means the command really has run.
        const PRINT_MARKER: &str = "printf 'ready-%s\\n' now";
        client
            .write("t-screen", format!("{PRINT_MARKER}\r").as_bytes())
            .await
            .unwrap();
        peek_until(&client, "t-screen", |screen| screen.contains("ready-now")).await;
        // Let the prompt that follows it land too, so the wait below starts
        // against a quiet session.
        tokio::time::sleep(Duration::from_millis(200)).await;

        let regex = Regex::new("ready-now").unwrap();
        let timed_out = tokio::time::timeout(
            Duration::from_millis(500),
            wait_for(&client, "t-screen", None, Some(&regex), false),
        )
        .await;
        assert!(timed_out.is_err(), "{timed_out:?}");

        let outcome = wait_after(&client, "t-screen", Some("ready-now"), PRINT_MARKER).await;
        match outcome {
            WaitOutcome::Matched(line) => assert!(line.contains("ready-now"), "{line}"),
            other => panic!("expected the next occurrence to match, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn log_reaches_past_the_visible_screen() {
        let harness = Harness::start().await;
        let client = harness.client().await;
        start_session(&harness, &client, "t-screen").await;

        // More lines than the 24-row grid holds, so the early ones can only
        // come from the scrollback the replay carries.
        client
            .write("t-screen", b"for i in $(seq 1 60); do echo line-$i; done\r")
            .await
            .unwrap();
        peek_until(&client, "t-screen", |screen| screen.contains("line-60")).await;

        let replay: ReplayPayload = request(
            &client,
            Op::Replay {
                terminal_id: "t-screen".to_owned(),
            },
        )
        .await
        .unwrap();
        let mut history = cook_stream(&B64.decode(replay.data_b64.as_bytes()).unwrap());
        assert!(history.contains("line-1\n"), "{history}");
        assert!(history.contains("line-60"), "{history}");
        // The tail is the tail, whatever the grid happened to show. `run_log`
        // trims the padding first, so this does too.
        trim_trailing_blank_lines(&mut history);
        let last = tail(&history, 3);
        assert_eq!(last.lines().count(), 3, "{last}");
        assert!(last.contains("line-60"), "{last}");
        assert!(!last.contains("line-50"), "{last}");
    }

    #[tokio::test]
    async fn resolve_id_accepts_a_unique_prefix() {
        let harness = Harness::start().await;
        let client = harness.client().await;
        start_session(&harness, &client, "reviewer-1").await;
        start_session(&harness, &client, "builder-1").await;

        assert_eq!(resolve_id(&client, "rev").await.unwrap(), "reviewer-1");
        assert!(resolve_id(&client, "nope").await.is_err());
    }
}
