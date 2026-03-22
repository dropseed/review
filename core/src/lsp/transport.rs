//! LSP subprocess management and async I/O.
//!
//! Spawns a language server process and provides request/response correlation
//! over the stdio JSON-RPC transport.

use std::collections::HashMap;
use std::path::Path;
use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::Arc;

use anyhow::Context;
use log::{debug, error, warn};
use serde_json::Value;
use tokio::io::AsyncWriteExt;
use tokio::process::{Child, Command};
use tokio::sync::{mpsc, oneshot, Mutex};

use super::jsonrpc::{self, Message, RpcError};

/// A pending request awaiting a response.
type PendingMap = Arc<Mutex<HashMap<i64, oneshot::Sender<Result<Value, RpcError>>>>>;

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
            .stderr(std::process::Stdio::null())
            .kill_on_drop(true)
            .spawn()
            .with_context(|| format!("Failed to spawn LSP server: {command}"))?;

        let stdin = child.stdin.take().context("No stdin on child process")?;
        let stdout = child.stdout.take().context("No stdout on child process")?;

        let stdin = Arc::new(Mutex::new(stdin));
        let pending: PendingMap = Arc::new(Mutex::new(HashMap::new()));
        let (notification_tx, notification_rx) = mpsc::unbounded_channel();

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
                _read_task: read_task,
                _child: child,
            },
            notification_rx,
        ))
    }

    /// Send a JSON-RPC request and wait for the response.
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

        let result = rx.await.context("Response channel closed")?;
        result.map_err(|e| anyhow::anyhow!("{e}"))
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
