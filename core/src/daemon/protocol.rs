//! The daemon wire contract: hello, control request/response, stream frames.
//!
//! Every frame is length-prefixed by [`super::codec`]. A connection opens with a
//! single JSON [`Hello`] frame that picks its role for the rest of its life:
//!
//! - `{"kind":"control"}` — unary [`Request`]/[`Response`] pairs multiplexed by
//!   `id`. Many requests may be in flight at once; responses can come back in
//!   any order, so clients match on `id`.
//! - `{"kind":"stream","terminalId":"…"}` — a one-way daemon→client firehose of
//!   [`StreamFrame`]s for one session. Closing a stream connection never kills
//!   the session.
//! - `{"kind":"events"}` — a one-way daemon→client firehose of [`Event`]s about
//!   *every* session: the channel a client watches instead of polling
//!   [`Op::List`]. One per client is enough.
//!
//! All JSON is `camelCase`, matching the project's canonical wire contract.
//!
//! **Deliberate decoupling:** nothing here references `crate::terminal`, so the
//! client half (`daemon-client`) compiles without the `terminal` feature and its
//! PTY dependencies. Payloads that *are* terminal types on both ends —
//! `TerminalSummary`, `SessionStatus` — travel as `serde_json::Value` and are
//! deserialized by the caller, which already has those types.

use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Standard base64 engine for every bytes-over-JSON field on this wire
/// (`data_b64`) — one definition shared by the daemon, the desktop app, and
/// the CLI, so the encoding convention can't drift between them.
pub const B64: base64::engine::general_purpose::GeneralPurpose =
    base64::engine::general_purpose::STANDARD;

/// The version of this wire contract, reported by [`Op::Version`] alongside
/// the build identity.
///
/// The desktop app attaches to a daemon whose protocol matches even when its
/// build identity differs — that is what lets sessions survive an app update.
///
/// **From v3 on, do not bump this for an addition.** A client says what it
/// needs by *name*, in [`features`], and attaches to any daemon at protocol
/// `>= 3` that reports every name it requires ([`VersionInfo::features`]).
/// Bumping the integer instead would make every older daemon unattachable —
/// which means killing its running sessions — for a change most clients do not
/// even use. The integer is now reserved for a change that genuinely breaks
/// the frames themselves (a reshaped envelope, a different codec); the honest
/// way to express anything else is a new feature name that old daemons simply
/// do not list.
///
/// History: 2 added [`StreamFrame::Resized`]. 3 added the [`Hello::Events`]
/// channel, `scrollback` on [`Op::Peek`], [`Op::PeekMany`], and
/// [`VersionInfo::features`] — and with it the feature-name rule above.
pub const PROTOCOL_VERSION: u32 = 3;

/// The capability names a daemon reports in [`VersionInfo::features`], and the
/// vocabulary a client uses to say what it needs.
///
/// One name per capability, added alongside it and never removed or reused: a
/// name that has ever meant something must keep meaning it, because an old
/// client's whole attach decision is whether the daemon still lists it.
pub mod features {
    /// The [`Hello::Events`] channel: session lifecycle pushed, not polled.
    pub const EVENTS: &str = "events";
    /// [`Op::Peek`] honours its `scrollback` field (history above the viewport).
    pub const PEEK_SCROLLBACK: &str = "peek-scrollback";
    /// [`Op::PeekMany`]: one round trip for many sessions' screens.
    pub const PEEK_MANY: &str = "peek-many";

    /// Everything this build serves — what a daemon reports.
    pub const ALL: &[&str] = &[EVENTS, PEEK_SCROLLBACK, PEEK_MANY];
}

// ============================================================
// Hello
// ============================================================

/// The first frame on every connection: which role this connection plays.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum Hello {
    /// Unary request/response channel.
    Control,
    /// Live output stream for one terminal session.
    Stream { terminal_id: String },
    /// Live [`Event`] stream for *every* session on this daemon.
    Events,
}

// ============================================================
// Control channel
// ============================================================

/// A control request. `op` is flattened, so the wire shape is
/// `{"id":7,"op":"kill","terminalId":"…"}`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Request {
    pub id: u64,
    #[serde(flatten)]
    pub op: Op,
}

/// Everything the daemon can be asked to do. Mirrors the [`SessionManager`]
/// surface plus daemon lifecycle ops.
///
/// [`SessionManager`]: crate::terminal::SessionManager
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "op", rename_all = "snake_case", rename_all_fields = "camelCase")]
pub enum Op {
    /// Spawn a session. Ok payload: `TerminalSummary`.
    ///
    /// `workspace_id` is the workspace this session belongs to, decided by the
    /// caller's router (`work::router`). The daemon only carries it: it never
    /// reads or writes `work.json`, so there is exactly one writer of the queue
    /// and attribution can't drift from a second source of truth.
    Start {
        terminal_id: String,
        repo_path: String,
        cwd: String,
        cols: u16,
        rows: u16,
        shell: Option<String>,
        workspace_id: Option<String>,
    },
    /// Write stdin bytes, base64-encoded (the control channel is JSON, and PTY
    /// input is arbitrary bytes). Ok payload: `null`.
    Write {
        terminal_id: String,
        data_b64: String,
    },
    /// Resize the PTY. Ok payload: `null`.
    Resize {
        terminal_id: String,
        cols: u16,
        rows: u16,
    },
    /// Move a session to another workspace (or to none). Ok payload: `null`.
    AssignWorkspace {
        terminal_id: String,
        workspace_id: Option<String>,
    },
    /// Terminate a session. Ok payload: `null`.
    Kill { terminal_id: String },
    /// Live sessions, optionally filtered to one repo. Ok payload:
    /// `[TerminalSummary]`.
    List { repo_path: Option<String> },
    /// Cold-reattach scrollback. Ok payload: `{dataB64, cursor, status}`.
    Replay { terminal_id: String },
    /// Plain-text screen snapshot, rendered by the session's VT engine. Ok
    /// payload: a string.
    ///
    /// `scrollback` is how many rows of history immediately *above* the
    /// viewport to prepend: `0` is the visible screen alone (what every daemon
    /// has always answered), and `u32::MAX` is everything the engine still
    /// retains. It is `#[serde(default)]` so a v2 client's
    /// `{"op":"peek","terminalId":"…"}` still parses — absent is `0`, which
    /// means what it always did.
    Peek {
        terminal_id: String,
        #[serde(default)]
        scrollback: u32,
    },
    /// Many sessions' visible screens in one round trip — what a grid of
    /// terminal cards polls instead of one [`Op::Peek`] per card. Ok payload:
    /// `{"<id>": "<screen>"}`.
    ///
    /// An id this daemon does not know (or cannot render right now) is simply
    /// absent from the map rather than failing the whole request: the caller is
    /// asking about a *set* of sessions, and one of them having just exited is
    /// the normal case, not an error.
    PeekMany { terminal_ids: Vec<String> },
    /// Capability probe. Ok payload: `true`.
    Available,
    /// Who the daemon is and what wire it speaks, for the desktop's
    /// attach-vs-respawn decision. Ok payload: a [`VersionInfo`].
    Version,
    /// Kill every session but keep serving. Ok payload: `null`.
    ShutdownAllSessions,
    /// Kill every session and exit the daemon process. Ok payload: `null`,
    /// written before the process winds down.
    Quit,
}

/// A control response, matched to its request by `id`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Response {
    pub id: u64,
    pub result: OpResult,
}

/// The outcome of one [`Op`]. Adjacently tagged (rather than internal) because
/// an Ok payload may be any JSON value, including a bool or an array.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "status", content = "value", rename_all = "snake_case")]
pub enum OpResult {
    Ok(Value),
    Err(String),
}

/// The `version` Ok payload: who the daemon is, and what wire it speaks.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VersionInfo {
    /// The daemon's build identity (`version+hash`, see
    /// [`super::build_identity`]), captured at its own startup.
    pub identity: String,
    /// The [`PROTOCOL_VERSION`] the daemon serves. `None` when talking to a
    /// daemon from before the protocol was versioned — which is itself a
    /// protocol mismatch.
    pub protocol: Option<u32>,
    /// The capability names this daemon serves — see [`features`] and the
    /// attach rule on [`PROTOCOL_VERSION`]. Empty for any daemon built before
    /// v3, which is exactly right: it lists nothing, so it satisfies no
    /// requirement.
    #[serde(default)]
    pub features: Vec<String>,
}

impl VersionInfo {
    /// Parse either shape of the payload: daemons from before the protocol was
    /// versioned answered with a bare identity string.
    pub fn from_payload(value: Value) -> Result<Self> {
        match value {
            Value::String(identity) => Ok(Self {
                identity,
                protocol: None,
                features: Vec::new(),
            }),
            other => serde_json::from_value(other).context("unexpected version payload"),
        }
    }

    /// Which of `required` this daemon does *not* serve, in the order asked —
    /// what a client names when it explains why it will not attach.
    pub fn missing_features<'a>(&self, required: &[&'a str]) -> Vec<&'a str> {
        required
            .iter()
            .filter(|name| !self.features.iter().any(|served| served == *name))
            .copied()
            .collect()
    }

    /// Whether this daemon serves every name in `required` — the feature half
    /// of a client's attach decision. Vacuously true for an empty requirement.
    pub fn has_features(&self, required: &[&str]) -> bool {
        self.missing_features(required).is_empty()
    }

    /// How to name this daemon's wire in a sentence: "protocol 3", or "an
    /// unversioned protocol" for one from before [`Self::protocol`] existed.
    pub fn describe_protocol(&self) -> String {
        match self.protocol {
            Some(version) => format!("protocol {version}"),
            None => "an unversioned protocol".to_owned(),
        }
    }
}

// ============================================================
// Events channel
// ============================================================

/// A daemon→client frame on the [`Hello::Events`] connection: something
/// happened to *some* session.
///
/// **The invariant this channel exists to provide:** a client that takes one
/// [`Op::List`] *after* opening its events connection, and then applies every
/// frame in order, holds exactly the list `Op::List` would return at any later
/// moment. So everything the daemon does that changes the list — or a listed
/// session's status, size, or workspace — emits here.
///
/// One JSON object per frame, length-prefixed by [`super::codec`] like
/// everything else. No tag byte: unlike [`StreamFrame`] there is no hot path to
/// keep out of a JSON encoder, and being plain JSON is what lets the Axum
/// bridge forward each frame to a browser verbatim.
///
/// The same decoupling rule as [`StreamFrame::Status`] applies: payloads that
/// are `crate::terminal` types travel as [`Value`] so this module stays free of
/// the PTY half of the crate.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "event",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum Event {
    /// A session was started — by this client or any other. The payload is a
    /// `TerminalSummary`, the same object [`Op::List`] returns.
    Started { session: Value },
    /// A session's status changed. The payload is a `SessionStatus` — the same
    /// object that session's own [`StreamFrame::Status`] carries.
    Status { status: Value },
    /// A session's PTY was resized. Only real changes: a resize to the size the
    /// PTY already has is a no-op everywhere, including here.
    Resized {
        terminal_id: String,
        cols: u16,
        rows: u16,
    },
    /// A session was moved to another workspace, or off every workspace.
    WorkspaceAssigned {
        terminal_id: String,
        workspace_id: Option<String>,
    },
    /// A session's child exited. Always followed by [`Event::Removed`] for the
    /// same id: `Op::List` hides an exited session from the moment it exits,
    /// well before the poller reaps it, so exiting *is* leaving the list.
    Exited {
        terminal_id: String,
        exit_code: Option<i32>,
    },
    /// A session is no longer listed by [`Op::List`] — killed, shut down with
    /// the rest, or exited on its own.
    Removed { terminal_id: String },
    /// **This subscriber** fell behind and the daemon dropped events for it, so
    /// the invariant above no longer holds: re-take [`Op::List`]. The connection
    /// stays open and keeps delivering — a client that is merely slow for a
    /// moment should resync, not reconnect.
    Lagged,
}

impl Event {
    /// Encode this event's body (the length prefix is added by the codec).
    ///
    /// Serialization of these bodies cannot fail, so a failure degrades to an
    /// empty body — which [`Event::decode`] rejects — rather than taking the
    /// daemon's event pump down with it.
    pub fn encode(&self) -> Vec<u8> {
        serde_json::to_vec(self).unwrap_or_default()
    }

    /// Decode a frame body produced by [`Event::encode`].
    pub fn decode(body: &[u8]) -> Result<Self> {
        serde_json::from_slice(body).context("bad event frame")
    }
}

/// The `replay` Ok payload: base64 scrollback, the byte cursor those bytes end
/// at, and the session's current status.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplayPayload {
    pub data_b64: String,
    pub cursor: u64,
    /// A `SessionStatus` as JSON; see the module docs on decoupling.
    pub status: Value,
}

// ============================================================
// Stream channel
// ============================================================

/// Tag byte for a raw-output frame: `[0x00][u64 BE seq][bytes]`.
pub const TAG_OUTPUT: u8 = 0x00;
/// Tag byte for a status frame: `[0x01][JSON SessionStatus]`.
pub const TAG_STATUS: u8 = 0x01;
/// Tag byte for an exit frame: `[0x02][JSON {exitCode}]`.
pub const TAG_EXIT: u8 = 0x02;
/// Tag byte for an error frame: `[0x03][JSON {error}]`.
pub const TAG_ERROR: u8 = 0x03;
/// Tag byte for a resized frame: `[0x04][JSON {cols, rows}]`.
pub const TAG_RESIZED: u8 = 0x04;

/// A daemon→client frame on a stream connection.
///
/// Output stays raw bytes with a fixed 9-byte header — no base64 and no JSON on
/// the hot path. Everything else is rare enough to be JSON.
#[derive(Debug, Clone, PartialEq)]
pub enum StreamFrame {
    /// Raw PTY output tagged with the scrollback byte cursor it ends at.
    Output { seq: u64, data: Vec<u8> },
    /// A status transition, as a `SessionStatus` JSON object.
    Status(Value),
    /// The PTY was resized — by any client; the daemon does not say which. Every
    /// attached client shares the one grid, so each needs to re-render at the
    /// new size.
    Resized { cols: u16, rows: u16 },
    /// The session's child exited; the daemon closes the connection after this.
    Exit { exit_code: Option<i32> },
    /// The stream could not be established (e.g. unknown terminal). Terminal —
    /// the daemon closes the connection after this.
    Error { message: String },
}

/// JSON body of [`StreamFrame::Exit`].
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExitBody {
    exit_code: Option<i32>,
}

/// JSON body of [`StreamFrame::Resized`].
#[derive(Serialize, Deserialize)]
struct ResizedBody {
    cols: u16,
    rows: u16,
}

/// JSON body of [`StreamFrame::Error`].
#[derive(Serialize, Deserialize)]
struct ErrorBody {
    error: String,
}

impl StreamFrame {
    /// Encode this frame's body (the length prefix is added by the codec).
    pub fn encode(&self) -> Vec<u8> {
        match self {
            Self::Output { seq, data } => {
                let mut out = Vec::with_capacity(9 + data.len());
                out.push(TAG_OUTPUT);
                out.extend_from_slice(&seq.to_be_bytes());
                out.extend_from_slice(data);
                out
            }
            Self::Status(status) => tagged_json(TAG_STATUS, status),
            Self::Resized { cols, rows } => tagged_json(
                TAG_RESIZED,
                &ResizedBody {
                    cols: *cols,
                    rows: *rows,
                },
            ),
            Self::Exit { exit_code } => tagged_json(
                TAG_EXIT,
                &ExitBody {
                    exit_code: *exit_code,
                },
            ),
            Self::Error { message } => tagged_json(
                TAG_ERROR,
                &ErrorBody {
                    error: message.clone(),
                },
            ),
        }
    }

    /// Decode a frame body produced by [`StreamFrame::encode`].
    pub fn decode(body: &[u8]) -> Result<Self> {
        let (&tag, rest) = body
            .split_first()
            .context("stream frame is empty (no tag byte)")?;
        match tag {
            TAG_OUTPUT => {
                let (header, data) = rest
                    .split_at_checked(8)
                    .context("output frame is missing its 8-byte seq header")?;
                let seq = u64::from_be_bytes(header.try_into().expect("split_at_checked gave 8"));
                Ok(Self::Output {
                    seq,
                    data: data.to_vec(),
                })
            }
            TAG_STATUS => Ok(Self::Status(
                serde_json::from_slice(rest).context("bad status frame")?,
            )),
            TAG_RESIZED => {
                let body: ResizedBody =
                    serde_json::from_slice(rest).context("bad resized frame")?;
                Ok(Self::Resized {
                    cols: body.cols,
                    rows: body.rows,
                })
            }
            TAG_EXIT => {
                let body: ExitBody = serde_json::from_slice(rest).context("bad exit frame")?;
                Ok(Self::Exit {
                    exit_code: body.exit_code,
                })
            }
            TAG_ERROR => {
                let body: ErrorBody = serde_json::from_slice(rest).context("bad error frame")?;
                Ok(Self::Error {
                    message: body.error,
                })
            }
            other => bail!("unknown stream frame tag {other:#04x}"),
        }
    }
}

/// Encode a whole output frame — length prefix included — as
/// `[u32 len][TAG_OUTPUT][u64 seq][data]` in one buffer.
///
/// Output is the only hot path on this wire: one frame per PTY chunk, thousands
/// per second under a chatty build. Going through [`StreamFrame::encode`] and
/// [`super::codec::write_frame`] costs two allocations, two copies of the
/// payload and two syscalls; this costs one of each, and the caller just
/// `write_all`s the result. (`write_vectored` would save the syscall but keep
/// both allocations, and tokio's `AsyncWrite` only forwards it when the sink
/// opts in.) The bytes are identical either way — see the round-trip test — so
/// [`StreamFrame::decode`] reads them unchanged.
pub fn encode_output_framed(seq: u64, data: &[u8]) -> std::io::Result<Vec<u8>> {
    let body_len = 9 + data.len();
    let header = super::codec::frame_header(body_len)?;
    let mut out = Vec::with_capacity(4 + body_len);
    out.extend_from_slice(&header);
    out.push(TAG_OUTPUT);
    out.extend_from_slice(&seq.to_be_bytes());
    out.extend_from_slice(data);
    Ok(out)
}

/// `[tag][JSON value]`. Serialization of these bodies cannot fail, so a failure
/// degrades to an empty body rather than panicking on the hot path.
fn tagged_json<T: Serialize>(tag: u8, value: &T) -> Vec<u8> {
    let json = serde_json::to_vec(value).unwrap_or_default();
    let mut out = Vec::with_capacity(1 + json.len());
    out.push(tag);
    out.extend_from_slice(&json);
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn hello_variants_are_tagged_and_camel_case() {
        let control = serde_json::to_value(Hello::Control).unwrap();
        assert_eq!(control, json!({"kind": "control"}));

        let stream = serde_json::to_value(Hello::Stream {
            terminal_id: "t1".into(),
        })
        .unwrap();
        assert_eq!(stream, json!({"kind": "stream", "terminalId": "t1"}));

        let events = serde_json::to_value(Hello::Events).unwrap();
        assert_eq!(events, json!({"kind": "events"}));
        assert_eq!(
            serde_json::from_value::<Hello>(events).unwrap(),
            Hello::Events
        );

        // And both parse back.
        assert_eq!(
            serde_json::from_value::<Hello>(stream).unwrap(),
            Hello::Stream {
                terminal_id: "t1".into()
            }
        );
        assert!(serde_json::from_str::<Hello>(r#"{"kind":"bogus"}"#).is_err());
    }

    #[test]
    fn request_flattens_op_with_camel_case_fields() {
        let request = Request {
            id: 7,
            op: Op::Start {
                terminal_id: "t1".into(),
                repo_path: "/repo".into(),
                cwd: "/repo/sub".into(),
                cols: 120,
                rows: 40,
                shell: Some("/bin/sh".into()),
                workspace_id: Some("0a1b2c3d".into()),
            },
        };
        let value = serde_json::to_value(&request).unwrap();
        assert_eq!(value["id"], 7);
        assert_eq!(value["op"], "start");
        assert_eq!(value["terminalId"], "t1");
        assert_eq!(value["repoPath"], "/repo");
        assert_eq!(value["cols"], 120);
        assert_eq!(value["workspaceId"], "0a1b2c3d");
        assert!(value.get("terminal_id").is_none());

        assert_eq!(serde_json::from_value::<Request>(value).unwrap(), request);
    }

    #[test]
    fn unit_ops_are_bare_tags() {
        let value = serde_json::to_value(Request {
            id: 1,
            op: Op::ShutdownAllSessions,
        })
        .unwrap();
        assert_eq!(value, json!({"id": 1, "op": "shutdown_all_sessions"}));

        let value = serde_json::to_value(Request {
            id: 2,
            op: Op::Quit,
        })
        .unwrap();
        assert_eq!(value, json!({"id": 2, "op": "quit"}));
    }

    #[test]
    fn list_carries_an_optional_repo_path() {
        let all = serde_json::to_value(Request {
            id: 3,
            op: Op::List { repo_path: None },
        })
        .unwrap();
        assert_eq!(all, json!({"id": 3, "op": "list", "repoPath": null}));

        let scoped: Request =
            serde_json::from_str(r#"{"id":4,"op":"list","repoPath":"/repo"}"#).unwrap();
        assert_eq!(
            scoped.op,
            Op::List {
                repo_path: Some("/repo".into())
            }
        );
    }

    #[test]
    fn responses_round_trip_both_outcomes() {
        let ok = Response {
            id: 9,
            result: OpResult::Ok(json!([1, 2, 3])),
        };
        let value = serde_json::to_value(&ok).unwrap();
        assert_eq!(value["result"]["status"], "ok");
        assert_eq!(value["result"]["value"], json!([1, 2, 3]));
        assert_eq!(serde_json::from_value::<Response>(value).unwrap(), ok);

        let err = Response {
            id: 10,
            result: OpResult::Err("no such terminal t9".into()),
        };
        let value = serde_json::to_value(&err).unwrap();
        assert_eq!(value["result"]["status"], "err");
        assert_eq!(value["result"]["value"], "no such terminal t9");
        assert_eq!(serde_json::from_value::<Response>(value).unwrap(), err);
    }

    /// Both shapes of the version payload parse: today's object, and the bare
    /// identity string every daemon reported before the protocol was versioned
    /// — which must read as "no protocol", not an error, so the app respawns
    /// such a daemon instead of failing to decide.
    #[test]
    fn version_payload_parses_both_generations() {
        let current = VersionInfo::from_payload(json!({
            "identity": "0.0.130+aabbccdd00112233",
            "protocol": 1,
        }))
        .unwrap();
        assert_eq!(current.identity, "0.0.130+aabbccdd00112233");
        assert_eq!(current.protocol, Some(1));
        // A daemon from before feature names lists none, so it satisfies no
        // requirement — which is the answer that keeps the attach rule honest.
        assert!(current.features.is_empty());
        assert!(!current.has_features(&[features::EVENTS]));

        assert_eq!(current.describe_protocol(), "protocol 1");

        let legacy = VersionInfo::from_payload(json!("0.0.124+deadbeef00000000")).unwrap();
        assert_eq!(legacy.identity, "0.0.124+deadbeef00000000");
        assert_eq!(legacy.protocol, None);
        assert_eq!(legacy.describe_protocol(), "an unversioned protocol");

        assert!(VersionInfo::from_payload(json!(42)).is_err());
    }

    #[test]
    fn version_payload_carries_feature_names() {
        let served = VersionInfo {
            identity: "0.0.163+aabbccdd00112233".into(),
            protocol: Some(PROTOCOL_VERSION),
            features: features::ALL.iter().map(|s| (*s).to_owned()).collect(),
        };
        let value = serde_json::to_value(&served).unwrap();
        assert_eq!(
            value["features"],
            json!(["events", "peek-scrollback", "peek-many"])
        );

        let parsed = VersionInfo::from_payload(value).unwrap();
        assert_eq!(parsed, served);
        assert!(parsed.has_features(&[features::EVENTS, features::PEEK_MANY]));
        assert!(parsed.has_features(&[]), "no requirement is satisfiable");
        assert!(!parsed.has_features(&["time-travel"]));

        // What is missing comes back in the order asked, so a client can name
        // exactly the capabilities it wanted and did not get.
        assert!(parsed.missing_features(&[features::EVENTS]).is_empty());
        assert_eq!(
            parsed.missing_features(&["time-travel", features::EVENTS, "telepathy"]),
            vec!["time-travel", "telepathy"]
        );
    }

    /// A v2 client sends `peek` with no `scrollback` key at all; that has to
    /// keep meaning "the visible screen", not fail to parse.
    #[test]
    fn peek_scrollback_defaults_to_the_viewport() {
        let legacy: Request =
            serde_json::from_str(r#"{"id":1,"op":"peek","terminalId":"t1"}"#).unwrap();
        assert_eq!(
            legacy.op,
            Op::Peek {
                terminal_id: "t1".into(),
                scrollback: 0,
            }
        );

        let with_history = Request {
            id: 2,
            op: Op::Peek {
                terminal_id: "t1".into(),
                scrollback: 500,
            },
        };
        let value = serde_json::to_value(&with_history).unwrap();
        assert_eq!(value["scrollback"], 500);
        assert_eq!(
            serde_json::from_value::<Request>(value).unwrap(),
            with_history
        );
    }

    #[test]
    fn peek_many_carries_a_list_of_ids() {
        let request = Request {
            id: 3,
            op: Op::PeekMany {
                terminal_ids: vec!["t1".into(), "t2".into()],
            },
        };
        let value = serde_json::to_value(&request).unwrap();
        assert_eq!(value["op"], "peek_many");
        assert_eq!(value["terminalIds"], json!(["t1", "t2"]));
        assert_eq!(serde_json::from_value::<Request>(value).unwrap(), request);
    }

    /// Encode then decode, asserting the event survives — and that its JSON is
    /// the documented shape, since the Axum bridge forwards these bytes to a
    /// browser verbatim.
    fn assert_event_round_trips(event: &Event, expected: Value) {
        let encoded = event.encode();
        assert_eq!(
            serde_json::from_slice::<Value>(&encoded).unwrap(),
            expected,
            "event JSON drifted from the documented shape"
        );
        assert_eq!(&Event::decode(&encoded).unwrap(), event);
    }

    #[test]
    fn events_round_trip_in_their_documented_shapes() {
        assert_event_round_trips(
            &Event::Started {
                session: json!({"id": "t1", "repoPath": "/repo"}),
            },
            json!({"event": "started", "session": {"id": "t1", "repoPath": "/repo"}}),
        );
        assert_event_round_trips(
            &Event::Status {
                status: json!({"id": "t1", "phase": "idle"}),
            },
            json!({"event": "status", "status": {"id": "t1", "phase": "idle"}}),
        );
        assert_event_round_trips(
            &Event::Resized {
                terminal_id: "t1".into(),
                cols: 141,
                rows: 52,
            },
            json!({"event": "resized", "terminalId": "t1", "cols": 141, "rows": 52}),
        );
        assert_event_round_trips(
            &Event::WorkspaceAssigned {
                terminal_id: "t1".into(),
                workspace_id: Some("0a1b2c3d".into()),
            },
            json!({"event": "workspaceAssigned", "terminalId": "t1", "workspaceId": "0a1b2c3d"}),
        );
        assert_event_round_trips(
            &Event::WorkspaceAssigned {
                terminal_id: "t1".into(),
                workspace_id: None,
            },
            json!({"event": "workspaceAssigned", "terminalId": "t1", "workspaceId": null}),
        );
        assert_event_round_trips(
            &Event::Exited {
                terminal_id: "t1".into(),
                exit_code: Some(3),
            },
            json!({"event": "exited", "terminalId": "t1", "exitCode": 3}),
        );
        assert_event_round_trips(
            &Event::Exited {
                terminal_id: "t1".into(),
                exit_code: None,
            },
            json!({"event": "exited", "terminalId": "t1", "exitCode": null}),
        );
        assert_event_round_trips(
            &Event::Removed {
                terminal_id: "t1".into(),
            },
            json!({"event": "removed", "terminalId": "t1"}),
        );
        assert_event_round_trips(&Event::Lagged, json!({"event": "lagged"}));
    }

    #[test]
    fn malformed_event_frames_error() {
        assert!(Event::decode(&[]).is_err(), "empty frame");
        assert!(Event::decode(b"{").is_err(), "invalid JSON body");
        assert!(
            Event::decode(br#"{"event":"teleported"}"#).is_err(),
            "unknown event name"
        );
    }

    /// Encode then decode, asserting the frame survives byte-for-byte.
    fn assert_frame_round_trips(frame: &StreamFrame) {
        let encoded = frame.encode();
        assert_eq!(&StreamFrame::decode(&encoded).unwrap(), frame);
    }

    #[test]
    fn output_frames_round_trip_binary_payloads() {
        let frame = StreamFrame::Output {
            seq: 0x0102_0304_0506_0708,
            data: vec![0x00, 0xff, 0x1b, b'[', b'0', b'm', 0x00],
        };
        let encoded = frame.encode();
        assert_eq!(encoded[0], TAG_OUTPUT);
        assert_eq!(&encoded[1..9], &[1, 2, 3, 4, 5, 6, 7, 8]);
        assert_frame_round_trips(&frame);
    }

    #[test]
    fn empty_output_frame_is_header_only() {
        let frame = StreamFrame::Output {
            seq: 42,
            data: Vec::new(),
        };
        assert_eq!(frame.encode().len(), 9);
        assert_frame_round_trips(&frame);
    }

    /// The output fast path must be byte-identical to `write_frame(encode())`,
    /// or the daemon and the client would disagree about the wire.
    #[test]
    fn the_framed_output_fast_path_matches_the_general_path() {
        for (seq, data) in [
            (0x0102_0304_0506_0708_u64, &[0x00, 0xff, 0x1b, b'['][..]),
            (0, &[][..]),
        ] {
            let framed = encode_output_framed(seq, data).unwrap();

            // A big-endian length prefix, then exactly the body `encode` builds.
            let len = u32::from_be_bytes(framed[..4].try_into().unwrap()) as usize;
            assert_eq!(len, framed.len() - 4, "length prefix must cover the body");
            let body = &framed[4..];
            let frame = StreamFrame::Output {
                seq,
                data: data.to_vec(),
            };
            assert_eq!(body, frame.encode(), "fast path diverged from encode()");
            assert_eq!(StreamFrame::decode(body).unwrap(), frame);
        }
    }

    #[test]
    fn status_exit_and_error_frames_round_trip() {
        assert_frame_round_trips(&StreamFrame::Status(
            json!({"id": "t1", "phase": "idle", "shellIntegrationActive": false}),
        ));
        assert_frame_round_trips(&StreamFrame::Exit { exit_code: Some(3) });
        assert_frame_round_trips(&StreamFrame::Exit { exit_code: None });
        assert_frame_round_trips(&StreamFrame::Resized {
            cols: 141,
            rows: 52,
        });
        assert_frame_round_trips(&StreamFrame::Error {
            message: "no such terminal t9".into(),
        });

        // The JSON bodies use the documented camelCase keys.
        let exit = StreamFrame::Exit { exit_code: Some(3) }.encode();
        assert_eq!(exit[0], TAG_EXIT);
        assert_eq!(
            serde_json::from_slice::<Value>(&exit[1..]).unwrap(),
            json!({"exitCode": 3})
        );
        let error = StreamFrame::Error {
            message: "boom".into(),
        }
        .encode();
        assert_eq!(error[0], TAG_ERROR);
        assert_eq!(
            serde_json::from_slice::<Value>(&error[1..]).unwrap(),
            json!({"error": "boom"})
        );
    }

    #[test]
    fn malformed_stream_frames_error() {
        assert!(StreamFrame::decode(&[]).is_err(), "empty frame");
        assert!(
            StreamFrame::decode(&[TAG_OUTPUT, 0, 0, 0]).is_err(),
            "short seq header"
        );
        assert!(
            StreamFrame::decode(&[TAG_STATUS, b'{']).is_err(),
            "invalid JSON body"
        );
        assert!(StreamFrame::decode(&[0x7f]).is_err(), "unknown tag");
    }
}
