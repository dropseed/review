//! LSP subprocess management and async I/O.
//!
//! Spawns a language server process and provides request/response correlation
//! over the stdio JSON-RPC transport.

use std::collections::HashMap;
use std::path::Path;
use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::Arc;

use anyhow::Context;
use log::{debug, error};
use serde_json::Value;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::{mpsc, oneshot, Mutex};

use super::jsonrpc::{self, Message, RpcError};

/// A pending request awaiting a response.
type PendingMap = Arc<Mutex<HashMap<i64, oneshot::Sender<Result<Value, RpcError>>>>>;

/// How long to wait for a response before giving up, so a hung or
/// still-indexing server can never block the UI indefinitely.
const REQUEST_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(20);

/// Last N stderr lines kept for diagnostics when a server fails to start.
const STDERR_BUFFER_LINES: usize = 40;

/// The low-level LSP transport: manages a subprocess, routes responses, and
/// forwards server notifications.
pub struct LspTransport {
    /// Stdin writer for sending messages to the server.
    stdin: Arc<Mutex<tokio::process::ChildStdin>>,
    /// Map of pending request IDs to response channels.
    pending: PendingMap,
    /// Auto-incrementing request ID counter.
    next_id: AtomicI64,
    /// Channel for server-initiated notifications.
    notification_tx: mpsc::UnboundedSender<Message>,
    /// Rolling buffer of the server's most recent stderr lines. A broken
    /// server (e.g. a rust-analyzer rustup shim with no component installed)
    /// explains itself here before exiting.
    stderr: Arc<Mutex<Vec<String>>>,
    /// Handle to the read loop task (kept alive).
    _read_task: tokio::task::JoinHandle<()>,
    /// The child process (kept alive — dropping kills the server).
    _child: Child,
}

impl LspTransport {
    /// Spawn a language server process and start the read loop.
    ///
    /// Returns the transport and a receiver for server notifications.
    pub fn spawn(
        command: &str,
        args: &[&str],
        cwd: &Path,
    ) -> anyhow::Result<(Self, mpsc::UnboundedReceiver<Message>)> {
        debug!(
            "[lsp transport] spawning: {} {} in {}",
            command,
            args.join(" "),
            cwd.display()
        );

        let mut child = Command::new(command)
            .args(args)
            .current_dir(cwd)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .kill_on_drop(true)
            .spawn()
            .with_context(|| format!("Failed to spawn LSP server: {command}"))?;

        let stdin = child.stdin.take().context("No stdin on child process")?;
        let stdout = child.stdout.take().context("No stdout on child process")?;
        let stderr = child.stderr.take().context("No stderr on child process")?;

        let stdin = Arc::new(Mutex::new(stdin));
        let pending: PendingMap = Arc::new(Mutex::new(HashMap::new()));
        let (notification_tx, notification_rx) = mpsc::unbounded_channel();

        // Drain stderr into a rolling buffer so a server that dies on startup
        // can explain why (see `recent_stderr`).
        let stderr_buf: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
        let stderr_buf_clone = stderr_buf.clone();
        tokio::spawn(async move {
            let mut lines = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let mut buf = stderr_buf_clone.lock().await;
                buf.push(line);
                if buf.len() > STDERR_BUFFER_LINES {
                    let overflow = buf.len() - STDERR_BUFFER_LINES;
                    buf.drain(0..overflow);
                }
            }
        });

        let pending_clone = pending.clone();
        let notification_tx_clone = notification_tx.clone();
        let stdin_for_read = stdin.clone();

        let read_task = tokio::spawn(async move {
            let mut reader = jsonrpc::MessageReader::new(stdout);
            loop {
                match reader.next_message().await {
                    Ok(Some(msg)) => match msg {
                        Message::Response { id, result, error } => {
                            let mut map = pending_clone.lock().await;
                            if let Some(tx) = map.remove(&id) {
                                let response = match error {
                                    Some(e) => Err(e),
                                    None => Ok(result.unwrap_or(Value::Null)),
                                };
                                let _ = tx.send(response);
                            }
                        }
                        Message::Notification { .. } => {
                            // Silently discard if no receiver is listening
                            let _ = notification_tx_clone.send(msg);
                        }
                        Message::Request { id, method, .. } => {
                            debug!("[lsp transport] server request: {method} (id={id})");
                            let response = Message::Response {
                                id,
                                result: Some(serde_json::Value::Null),
                                error: None,
                            };
                            let bytes = jsonrpc::serialize_message(&response);
                            let stdin_clone = stdin_for_read.clone();
                            tokio::spawn(async move {
                                let mut w = stdin_clone.lock().await;
                                let _ = w.write_all(&bytes).await;
                                let _ = w.flush().await;
                            });
                        }
                    },
                    Ok(None) => {
                        debug!("[lsp transport] stdout EOF — server exited");
                        break;
                    }
                    Err(e) => {
                        error!("[lsp transport] read error: {e}");
                        break;
                    }
                }
            }
            // Drain pending requests on exit
            let mut map = pending_clone.lock().await;
            for (_, tx) in map.drain() {
                let _ = tx.send(Err(RpcError {
                    code: -32099,
                    message: "Server exited".to_owned(),
                    data: None,
                }));
            }
        });

        Ok((
            Self {
                stdin,
                pending,
                next_id: AtomicI64::new(1),
                notification_tx,
                stderr: stderr_buf,
                _read_task: read_task,
                _child: child,
            },
            notification_rx,
        ))
    }

    /// The server's most recent stderr output, if any. Empty when the server
    /// printed nothing (or hasn't flushed yet).
    pub async fn recent_stderr(&self) -> String {
        self.stderr.lock().await.join("\n")
    }

    /// Send a JSON-RPC request and wait for the response (bounded by
    /// `REQUEST_TIMEOUT`).
    pub async fn send_request(&self, method: &str, params: Value) -> anyhow::Result<Value> {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);

        let (tx, rx) = oneshot::channel();
        {
            let mut map = self.pending.lock().await;
            map.insert(id, tx);
        }

        let msg = Message::Request {
            id,
            method: method.to_owned(),
            params,
        };
        let bytes = jsonrpc::serialize_message(&msg);

        {
            let mut stdin = self.stdin.lock().await;
            stdin.write_all(&bytes).await?;
            stdin.flush().await?;
        }

        match tokio::time::timeout(REQUEST_TIMEOUT, rx).await {
            Ok(received) => {
                let result = received.context("Response channel closed")?;
                result.map_err(|e| anyhow::anyhow!("{e}"))
            }
            Err(_) => {
                // Stop tracking the abandoned request so the map doesn't grow.
                self.pending.lock().await.remove(&id);
                anyhow::bail!(
                    "LSP request '{method}' timed out after {}s",
                    REQUEST_TIMEOUT.as_secs()
                )
            }
        }
    }

    /// Send a JSON-RPC notification (no response expected).
    pub async fn send_notification(&self, method: &str, params: Value) -> anyhow::Result<()> {
        let msg = Message::Notification {
            method: method.to_owned(),
            params,
        };
        let bytes = jsonrpc::serialize_message(&msg);

        let mut stdin = self.stdin.lock().await;
        stdin.write_all(&bytes).await?;
        stdin.flush().await?;
        Ok(())
    }

    /// Check if the notification channel is still open (server is alive).
    pub fn is_alive(&self) -> bool {
        !self.notification_tx.is_closed()
    }
}
