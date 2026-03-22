//! High-level LSP client.
//!
//! Wraps the transport layer with typed LSP protocol operations.

use std::collections::HashSet;
use std::path::{Path, PathBuf};

use anyhow::Context;
use log::{debug, info};
use lsp_types::{
    ClientCapabilities, DidOpenTextDocumentParams, GotoDefinitionParams, GotoDefinitionResponse,
    Hover, HoverParams, InitializeParams, InitializeResult, Location, Position, ReferenceContext,
    ReferenceParams, TextDocumentIdentifier, TextDocumentItem, TextDocumentPositionParams, Uri,
};
use serde_json::Value;
use tokio::sync::Mutex;

use super::transport::LspTransport;

/// A high-level LSP client for a single language server.
pub struct LspClient {
    transport: LspTransport,
    root_uri: Uri,
    /// Files that have been opened via didOpen (keyed by URI string).
    opened_files: Mutex<HashSet<String>>,
}

impl LspClient {
    /// Start a language server process and complete the LSP handshake.
    pub async fn start(command: &str, args: &[&str], root_path: &Path) -> anyhow::Result<Self> {
        info!(
            "[lsp client] starting {} {} for {}",
            command,
            args.join(" "),
            root_path.display()
        );

        let (transport, _notification_rx) = LspTransport::spawn(command, args, root_path)?;
        let root_uri = path_to_uri(root_path)?;

        // Drop the notification receiver — we don't consume notifications yet.
        // The unbounded channel sender in the read loop will detect the drop
        // and stop forwarding (no memory leak).
        drop(_notification_rx);

        let client = Self {
            transport,
            root_uri: root_uri.clone(),
            opened_files: Mutex::new(HashSet::new()),
        };

        // Send initialize request
        let init_params = InitializeParams {
            root_uri: Some(root_uri),
            capabilities: ClientCapabilities::default(),
            ..Default::default()
        };

        let result = client
            .transport
            .send_request("initialize", serde_json::to_value(init_params)?)
            .await
            .context("LSP initialize failed")?;

        let _init_result: InitializeResult = serde_json::from_value(result)?;
        debug!("[lsp client] initialized successfully");

        // Send initialized notification
        client
            .transport
            .send_notification("initialized", serde_json::json!({}))
            .await?;

        Ok(client)
    }

    /// Ensure a file is opened in the LSP session via didOpen.
    /// Reads content from disk and sends the notification if not already open.
    async fn ensure_open(&self, file_path: &Path, uri: &Uri) -> anyhow::Result<()> {
        let uri_str = uri.as_str().to_owned();
        {
            let mut opened = self.opened_files.lock().await;
            if !opened.insert(uri_str.clone()) {
                return Ok(()); // Already open
            }
        }

        let content = std::fs::read_to_string(file_path).unwrap_or_default();
        let ext = file_path.extension().and_then(|e| e.to_str()).unwrap_or("");
        let lang_id = super::registry::language_id_for_extension(ext).to_owned();

        let params = DidOpenTextDocumentParams {
            text_document: TextDocumentItem::new(uri.clone(), lang_id, 0, content),
        };

        if let Err(e) = self
            .transport
            .send_notification("textDocument/didOpen", serde_json::to_value(params)?)
            .await
        {
            // Roll back on failure
            let mut opened = self.opened_files.lock().await;
            opened.remove(&uri_str);
            return Err(e);
        }

        Ok(())
    }

    /// Go to definition at a position in a file.
    pub async fn goto_definition(
        &self,
        file_path: &Path,
        line: u32,
        character: u32,
    ) -> anyhow::Result<Vec<Location>> {
        let uri = path_to_uri(file_path)?;
        self.ensure_open(file_path, &uri).await?;

        let params = GotoDefinitionParams {
            text_document_position_params: TextDocumentPositionParams {
                text_document: TextDocumentIdentifier::new(uri),
                position: Position::new(line, character),
            },
            work_done_progress_params: Default::default(),
            partial_result_params: Default::default(),
        };

        let result = self
            .transport
            .send_request("textDocument/definition", serde_json::to_value(params)?)
            .await?;

        parse_definition_response(result)
    }

    /// Get hover information at a position.
    pub async fn hover(
        &self,
        file_path: &Path,
        line: u32,
        character: u32,
    ) -> anyhow::Result<Option<Hover>> {
        let uri = path_to_uri(file_path)?;
        self.ensure_open(file_path, &uri).await?;

        let params = HoverParams {
            text_document_position_params: TextDocumentPositionParams {
                text_document: TextDocumentIdentifier::new(uri),
                position: Position::new(line, character),
            },
            work_done_progress_params: Default::default(),
        };

        let result = self
            .transport
            .send_request("textDocument/hover", serde_json::to_value(params)?)
            .await?;

        if result.is_null() {
            return Ok(None);
        }

        Ok(Some(serde_json::from_value(result)?))
    }

    /// Find all references to a symbol at a position.
    pub async fn references(
        &self,
        file_path: &Path,
        line: u32,
        character: u32,
    ) -> anyhow::Result<Vec<Location>> {
        let uri = path_to_uri(file_path)?;
        self.ensure_open(file_path, &uri).await?;

        let params = ReferenceParams {
            text_document_position: TextDocumentPositionParams {
                text_document: TextDocumentIdentifier::new(uri),
                position: Position::new(line, character),
            },
            context: ReferenceContext {
                include_declaration: false,
            },
            work_done_progress_params: Default::default(),
            partial_result_params: Default::default(),
        };

        let result = self
            .transport
            .send_request("textDocument/references", serde_json::to_value(params)?)
            .await?;

        if result.is_null() {
            return Ok(Vec::new());
        }

        Ok(serde_json::from_value(result)?)
    }

    /// Send shutdown request and exit notification.
    pub async fn shutdown(&self) -> anyhow::Result<()> {
        info!("[lsp client] shutting down");
        let _ = self.transport.send_request("shutdown", Value::Null).await;
        let _ = self.transport.send_notification("exit", Value::Null).await;
        Ok(())
    }

    /// Check if the server process is still alive.
    pub fn is_alive(&self) -> bool {
        self.transport.is_alive()
    }

    /// Get the root URI this client was initialized with.
    pub fn root_uri(&self) -> &Uri {
        &self.root_uri
    }
}

/// Convert LSP Locations to SymbolDefinitions relative to a repo path.
pub fn locations_to_definitions(
    locations: &[Location],
    repo_path: &std::path::Path,
) -> Vec<crate::symbols::SymbolDefinition> {
    locations
        .iter()
        .filter_map(|loc| {
            let path = uri_to_path(&loc.uri)?;
            let is_external = !path.starts_with(repo_path);
            let display_path = if is_external {
                path.to_string_lossy().to_string()
            } else {
                path.strip_prefix(repo_path)
                    .unwrap_or(&path)
                    .to_string_lossy()
                    .to_string()
            };
            Some(crate::symbols::SymbolDefinition {
                file_path: display_path,
                name: String::new(),
                kind: crate::symbols::SymbolKind::Function,
                start_line: loc.range.start.line + 1,
                end_line: loc.range.end.line + 1,
                is_external,
            })
        })
        .collect()
}

/// Convert a file path to a `file://` URI.
fn path_to_uri(path: &Path) -> anyhow::Result<Uri> {
    let abs = if path.is_absolute() {
        path.to_path_buf()
    } else {
        std::env::current_dir()?.join(path)
    };

    let uri_str = format!("file://{}", abs.display());
    uri_str
        .parse::<Uri>()
        .map_err(|e| anyhow::anyhow!("Invalid URI for path {}: {e}", abs.display()))
}

/// Convert a `file://` URI to a file path.
pub fn uri_to_path(uri: &Uri) -> Option<PathBuf> {
    let s = uri.as_str();
    let path_str = s.strip_prefix("file://")?;
    let decoded = urlencoding::decode(path_str).ok()?;
    Some(PathBuf::from(decoded.as_ref()))
}

/// Parse a textDocument/definition response into a list of Locations.
fn parse_definition_response(value: Value) -> anyhow::Result<Vec<Location>> {
    if value.is_null() {
        return Ok(Vec::new());
    }

    match serde_json::from_value::<GotoDefinitionResponse>(value) {
        Ok(response) => {
            let locations = match response {
                GotoDefinitionResponse::Scalar(loc) => vec![loc],
                GotoDefinitionResponse::Array(locs) => locs,
                GotoDefinitionResponse::Link(links) => links
                    .into_iter()
                    .map(|link| Location {
                        uri: link.target_uri,
                        range: link.target_selection_range,
                    })
                    .collect(),
            };
            Ok(locations)
        }
        Err(_) => Ok(Vec::new()),
    }
}
