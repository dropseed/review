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
/// The compatibility contract is therefore this number, not the binary:
/// **bump it whenever anything on this wire changes** — an op added, removed,
/// or reshaped; a payload or stream frame changed; a semantic an existing op
/// relies on. An unbumped change means an updated app silently driving a
/// daemon that disagrees about the wire.
/// History: 2 added [`StreamFrame::Resized`].
pub const PROTOCOL_VERSION: u32 = 2;

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
    /// Plain-text screen snapshot. Ok payload: a string.
    Peek { terminal_id: String },
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
}

impl VersionInfo {
    /// Parse either shape of the payload: daemons from before the protocol was
    /// versioned answered with a bare identity string.
    pub fn from_payload(value: Value) -> Result<Self> {
        match value {
            Value::String(identity) => Ok(Self {
                identity,
                protocol: None,
            }),
            other => serde_json::from_value(other).context("unexpected version payload"),
        }
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

        let legacy = VersionInfo::from_payload(json!("0.0.124+deadbeef00000000")).unwrap();
        assert_eq!(legacy.identity, "0.0.124+deadbeef00000000");
        assert_eq!(legacy.protocol, None);

        assert!(VersionInfo::from_payload(json!(42)).is_err());
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
