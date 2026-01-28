//! Sync server for iOS companion app.
//!
//! Provides HTTP/WebSocket API for remote access to review state.
//! Designed to work over Tailscale VPN for secure access.

use super::commands;
use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        Path, State,
    },
    http::{header, HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, patch},
    Json, Router,
};
use compare::review::state::ReviewState;
use compare::sources::traits::Comparison;
use futures::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tokio::sync::{broadcast, RwLock};
use tower_http::cors::{Any, CorsLayer};

/// Default port for sync server
pub const DEFAULT_PORT: u16 = 17950;

/// Server running flag
static SERVER_RUNNING: AtomicBool = AtomicBool::new(false);

/// Global server state (accessible for registering repos and tray updates)
pub static SERVER_STATE: std::sync::OnceLock<ServerState> = std::sync::OnceLock::new();

/// Shared server state
#[derive(Clone)]
pub struct ServerState {
    /// Bearer token for authentication
    auth_token: Arc<String>,
    /// Known repository paths
    known_repos: Arc<RwLock<Vec<String>>>,
    /// Connected clients (client_id -> connection info)
    clients: Arc<RwLock<HashMap<String, ClientInfo>>>,
    /// Broadcast channel for state changes
    event_tx: broadcast::Sender<ServerEvent>,
}

#[derive(Clone, Debug, Serialize)]
pub struct ClientInfo {
    pub id: String,
    pub connected_at: String,
    pub last_active: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum ServerEvent {
    #[serde(rename = "state_changed")]
    StateChanged {
        repo: String,
        comparison_key: String,
        version: u64,
    },
    #[serde(rename = "client_connected")]
    ClientConnected { client_id: String },
    #[serde(rename = "client_disconnected")]
    ClientDisconnected { client_id: String },
}

/// Server configuration
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ServerConfig {
    pub enabled: bool,
    pub port: u16,
    pub auth_token: String,
}

impl Default for ServerConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            port: DEFAULT_PORT,
            auth_token: generate_auth_token(),
        }
    }
}

/// Generate a random authentication token
pub fn generate_auth_token() -> String {
    use rand::Rng;
    let mut rng = rand::thread_rng();
    let bytes: [u8; 24] = rng.gen();
    base64::Engine::encode(&base64::engine::general_purpose::URL_SAFE_NO_PAD, bytes)
}

/// Start the sync server
pub async fn start(config: ServerConfig) -> Result<(), String> {
    if SERVER_RUNNING.swap(true, Ordering::SeqCst) {
        return Err("Sync server already running".to_string());
    }

    let (event_tx, _) = broadcast::channel(100);

    let state = ServerState {
        auth_token: Arc::new(config.auth_token),
        known_repos: Arc::new(RwLock::new(Vec::new())),
        clients: Arc::new(RwLock::new(HashMap::new())),
        event_tx,
    };

    // Store state globally for repo registration
    let _ = SERVER_STATE.set(state.clone());

    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    let app = Router::new()
        // Health check
        .route("/api/health", get(health_check))
        // Repository management
        .route("/api/repos", get(list_repos))
        .route("/api/repos/:repo_id", get(get_repo_info))
        // Comparisons/reviews
        .route("/api/comparisons/:repo_id", get(list_comparisons))
        // Review state
        .route("/api/state/:repo_id/:comparison_key", get(get_state))
        .route("/api/state/:repo_id/:comparison_key", patch(update_state))
        // Diff data
        .route("/api/diff/:repo_id/:comparison_key", get(get_diff))
        .route(
            "/api/diff/:repo_id/:comparison_key/:file_path",
            get(get_file_diff),
        )
        // Taxonomy
        .route("/api/taxonomy", get(get_taxonomy))
        .route("/api/taxonomy/:repo_id", get(get_taxonomy_with_custom))
        // WebSocket for real-time events
        .route("/api/events", get(websocket_handler))
        // Server info
        .route("/api/server/info", get(server_info))
        .route("/api/server/clients", get(list_clients))
        .layer(cors)
        .with_state(state);

    let addr = SocketAddr::from(([0, 0, 0, 0], config.port));
    log::info!("[sync_server] Starting on http://{}", addr);

    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .map_err(|e| format!("Failed to bind: {}", e))?;

    axum::serve(listener, app)
        .await
        .map_err(|e| format!("Server error: {}", e))?;

    SERVER_RUNNING.store(false, Ordering::SeqCst);
    Ok(())
}

/// Stop the sync server
pub fn stop() {
    SERVER_RUNNING.store(false, Ordering::SeqCst);
}

/// Check if server is running
pub fn is_running() -> bool {
    SERVER_RUNNING.load(Ordering::SeqCst)
}

/// Get the current number of connected clients
pub fn get_client_count() -> usize {
    if let Some(state) = SERVER_STATE.get() {
        // Use try_read to avoid blocking
        if let Ok(clients) = state.clients.try_read() {
            return clients.len();
        }
    }
    0
}

// --- Auth middleware ---

fn check_auth(headers: &HeaderMap, expected_token: &str) -> Result<(), Response> {
    let auth_header = headers
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok());

    match auth_header {
        Some(value) if value.starts_with("Bearer ") => {
            let token = &value[7..];
            if token == expected_token {
                Ok(())
            } else {
                Err((
                    StatusCode::UNAUTHORIZED,
                    Json(ErrorResponse::new("Invalid token")),
                )
                    .into_response())
            }
        }
        _ => Err((
            StatusCode::UNAUTHORIZED,
            Json(ErrorResponse::new(
                "Missing or invalid Authorization header",
            )),
        )
            .into_response()),
    }
}

// --- Response types ---

#[derive(Serialize)]
struct HealthResponse {
    ok: bool,
    version: &'static str,
}

#[derive(Serialize)]
struct ErrorResponse {
    error: String,
}

impl ErrorResponse {
    fn new(msg: &str) -> Self {
        Self {
            error: msg.to_string(),
        }
    }
}

#[derive(Serialize)]
struct RepoInfo {
    id: String,
    path: String,
    name: String,
}

#[derive(Serialize)]
struct ComparisonInfo {
    key: String,
    old: String,
    new: String,
    working_tree: bool,
    staged_only: bool,
    updated_at: String,
}

#[derive(Serialize)]
struct StateResponse {
    state: ReviewState,
}

#[derive(Serialize)]
struct ConflictResponse {
    error: String,
    current_version: u64,
    current_state: ReviewState,
}

#[derive(Deserialize)]
struct UpdateStateRequest {
    state: ReviewState,
    expected_version: u64,
}

#[derive(Serialize)]
struct DiffResponse {
    files: Vec<compare::sources::traits::FileEntry>,
}

#[derive(Serialize)]
struct FileDiffResponse {
    content: super::commands::FileContent,
}

#[derive(Serialize)]
struct ServerInfoResponse {
    version: &'static str,
    port: u16,
    uptime_secs: u64,
    client_count: usize,
}

// --- Handlers ---

async fn health_check() -> impl IntoResponse {
    Json(HealthResponse {
        ok: true,
        version: env!("CARGO_PKG_VERSION"),
    })
}

async fn list_repos(
    State(state): State<ServerState>,
    headers: HeaderMap,
) -> Result<impl IntoResponse, Response> {
    check_auth(&headers, &state.auth_token)?;

    let repos = state.known_repos.read().await;
    let repo_infos: Vec<RepoInfo> = repos
        .iter()
        .map(|path| {
            let name = std::path::Path::new(path)
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("unknown")
                .to_string();
            let id = base64::Engine::encode(
                &base64::engine::general_purpose::URL_SAFE_NO_PAD,
                path.as_bytes(),
            );
            RepoInfo {
                id,
                path: path.clone(),
                name,
            }
        })
        .collect();

    Ok(Json(repo_infos))
}

async fn get_repo_info(
    State(state): State<ServerState>,
    headers: HeaderMap,
    Path(repo_id): Path<String>,
) -> Result<impl IntoResponse, Response> {
    check_auth(&headers, &state.auth_token)?;

    let path = decode_repo_id(&repo_id)?;

    let name = std::path::Path::new(&path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("unknown")
        .to_string();

    Ok(Json(RepoInfo {
        id: repo_id,
        path,
        name,
    }))
}

async fn list_comparisons(
    State(state): State<ServerState>,
    headers: HeaderMap,
    Path(repo_id): Path<String>,
) -> Result<impl IntoResponse, Response> {
    check_auth(&headers, &state.auth_token)?;

    let repo_path = decode_repo_id(&repo_id)?;

    let reviews = commands::list_saved_reviews(repo_path).map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse::new(&e)),
        )
            .into_response()
    })?;

    let comparisons: Vec<ComparisonInfo> = reviews
        .into_iter()
        .map(|r| ComparisonInfo {
            key: r.comparison.key.clone(),
            old: r.comparison.old,
            new: r.comparison.new,
            working_tree: r.comparison.working_tree,
            staged_only: r.comparison.staged_only,
            updated_at: r.updated_at,
        })
        .collect();

    Ok(Json(comparisons))
}

async fn get_state(
    State(state): State<ServerState>,
    headers: HeaderMap,
    Path((repo_id, comparison_key)): Path<(String, String)>,
) -> Result<impl IntoResponse, Response> {
    check_auth(&headers, &state.auth_token)?;

    let repo_path = decode_repo_id(&repo_id)?;
    let comparison = decode_comparison_key(&comparison_key)?;

    let review_state = commands::load_review_state(repo_path, comparison).map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse::new(&e)),
        )
            .into_response()
    })?;

    Ok(Json(StateResponse {
        state: review_state,
    }))
}

async fn update_state(
    State(state): State<ServerState>,
    headers: HeaderMap,
    Path((repo_id, comparison_key)): Path<(String, String)>,
    Json(request): Json<UpdateStateRequest>,
) -> Result<impl IntoResponse, Response> {
    check_auth(&headers, &state.auth_token)?;

    let repo_path = decode_repo_id(&repo_id)?;
    let comparison = decode_comparison_key(&comparison_key)?;

    // Load current state to check version
    let current_state = commands::load_review_state(repo_path.clone(), comparison.clone())
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse::new(&e)),
            )
                .into_response()
        })?;

    // Version conflict check
    if current_state.version != request.expected_version {
        return Err((
            StatusCode::CONFLICT,
            Json(ConflictResponse {
                error: "Version mismatch - state was modified".to_string(),
                current_version: current_state.version,
                current_state,
            }),
        )
            .into_response());
    }

    // Save the new state
    commands::save_review_state(repo_path.clone(), request.state.clone()).map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse::new(&e)),
        )
            .into_response()
    })?;

    // Reload to get the new version
    let updated_state =
        commands::load_review_state(repo_path, comparison.clone()).map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse::new(&e)),
            )
                .into_response()
        })?;

    // Broadcast state change event
    let _ = state.event_tx.send(ServerEvent::StateChanged {
        repo: repo_id,
        comparison_key,
        version: updated_state.version,
    });

    Ok(Json(StateResponse {
        state: updated_state,
    }))
}

async fn get_diff(
    State(state): State<ServerState>,
    headers: HeaderMap,
    Path((repo_id, comparison_key)): Path<(String, String)>,
) -> Result<impl IntoResponse, Response> {
    check_auth(&headers, &state.auth_token)?;

    let repo_path = decode_repo_id(&repo_id)?;
    let comparison = decode_comparison_key(&comparison_key)?;

    let files = commands::list_files(repo_path, comparison).map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse::new(&e)),
        )
            .into_response()
    })?;

    Ok(Json(DiffResponse { files }))
}

async fn get_file_diff(
    State(state): State<ServerState>,
    headers: HeaderMap,
    Path((repo_id, comparison_key, file_path)): Path<(String, String, String)>,
) -> Result<impl IntoResponse, Response> {
    check_auth(&headers, &state.auth_token)?;

    let repo_path = decode_repo_id(&repo_id)?;
    let comparison = decode_comparison_key(&comparison_key)?;
    let file_path = urlencoding::decode(&file_path)
        .map_err(|_| {
            (
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse::new("Invalid file path")),
            )
                .into_response()
        })?
        .into_owned();

    let content = commands::get_file_content(repo_path, file_path, comparison).map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse::new(&e)),
        )
            .into_response()
    })?;

    Ok(Json(FileDiffResponse { content }))
}

async fn get_taxonomy(
    State(state): State<ServerState>,
    headers: HeaderMap,
) -> Result<impl IntoResponse, Response> {
    check_auth(&headers, &state.auth_token)?;

    let taxonomy = commands::get_trust_taxonomy();
    Ok(Json(taxonomy))
}

async fn get_taxonomy_with_custom(
    State(state): State<ServerState>,
    headers: HeaderMap,
    Path(repo_id): Path<String>,
) -> Result<impl IntoResponse, Response> {
    check_auth(&headers, &state.auth_token)?;

    let repo_path = decode_repo_id(&repo_id)?;
    let taxonomy = commands::get_trust_taxonomy_with_custom(repo_path);
    Ok(Json(taxonomy))
}

async fn server_info(
    State(state): State<ServerState>,
    headers: HeaderMap,
) -> Result<impl IntoResponse, Response> {
    check_auth(&headers, &state.auth_token)?;

    let clients = state.clients.read().await;

    Ok(Json(ServerInfoResponse {
        version: env!("CARGO_PKG_VERSION"),
        port: DEFAULT_PORT,
        uptime_secs: 0, // TODO: track uptime
        client_count: clients.len(),
    }))
}

async fn list_clients(
    State(state): State<ServerState>,
    headers: HeaderMap,
) -> Result<impl IntoResponse, Response> {
    check_auth(&headers, &state.auth_token)?;

    let clients = state.clients.read().await;
    let client_list: Vec<ClientInfo> = clients.values().cloned().collect();

    Ok(Json(client_list))
}

async fn websocket_handler(
    State(state): State<ServerState>,
    headers: HeaderMap,
    ws: WebSocketUpgrade,
) -> Result<impl IntoResponse, Response> {
    // WebSocket can't send Authorization header from browsers, so we check the
    // Sec-WebSocket-Protocol header for "bearer-TOKEN" format
    let protocol_header = headers
        .get("sec-websocket-protocol")
        .and_then(|v| v.to_str().ok());

    let is_authed = match protocol_header {
        Some(protocols) => {
            // Protocols are comma-separated; find one that starts with "bearer-"
            protocols.split(',').any(|p| {
                let p = p.trim();
                if let Some(token) = p.strip_prefix("bearer-") {
                    token == state.auth_token.as_str()
                } else {
                    false
                }
            })
        }
        None => {
            // Fall back to checking Authorization header (for non-browser clients)
            check_auth(&headers, &state.auth_token).is_ok()
        }
    };

    if !is_authed {
        return Err((
            StatusCode::UNAUTHORIZED,
            Json(ErrorResponse::new("Invalid or missing authentication")),
        )
            .into_response());
    }

    // Echo back the accepted subprotocol so the client knows auth succeeded
    let response = if let Some(protocols) = protocol_header {
        let accepted = protocols
            .split(',')
            .find(|p| p.trim().starts_with("bearer-"))
            .map(|p| p.trim().to_string());
        if let Some(proto) = accepted {
            ws.protocols([proto])
                .on_upgrade(move |socket| handle_websocket(socket, state))
        } else {
            ws.on_upgrade(move |socket| handle_websocket(socket, state))
        }
    } else {
        ws.on_upgrade(move |socket| handle_websocket(socket, state))
    };

    Ok(response)
}

async fn handle_websocket(socket: WebSocket, state: ServerState) {
    let client_id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();

    // Register client
    {
        let mut clients = state.clients.write().await;
        clients.insert(
            client_id.clone(),
            ClientInfo {
                id: client_id.clone(),
                connected_at: now.clone(),
                last_active: now,
            },
        );
    }

    // Notify others
    let _ = state.event_tx.send(ServerEvent::ClientConnected {
        client_id: client_id.clone(),
    });

    log::info!("[sync_server] WebSocket client connected: {}", client_id);

    let (mut sender, mut receiver) = socket.split();
    let mut event_rx = state.event_tx.subscribe();

    // Send events to client
    let send_client_id = client_id.clone();
    let send_task = tokio::spawn(async move {
        while let Ok(event) = event_rx.recv().await {
            let msg = match serde_json::to_string(&event) {
                Ok(json) => Message::Text(json.into()),
                Err(_) => continue,
            };
            if sender.send(msg).await.is_err() {
                break;
            }
        }
        log::info!(
            "[sync_server] WebSocket send task ended: {}",
            send_client_id
        );
    });

    // Handle incoming messages (ping/pong, close)
    let recv_client_id = client_id.clone();
    let recv_state = state.clone();
    let recv_task = tokio::spawn(async move {
        while let Some(result) = receiver.next().await {
            match result {
                Ok(Message::Ping(_data)) => {
                    // Update last active
                    let mut clients = recv_state.clients.write().await;
                    if let Some(client) = clients.get_mut(&recv_client_id) {
                        client.last_active = chrono::Utc::now().to_rfc3339();
                    }
                    drop(clients);
                }
                Ok(Message::Close(_)) => break,
                Err(_) => break,
                _ => {}
            }
        }
        log::info!(
            "[sync_server] WebSocket recv task ended: {}",
            recv_client_id
        );
    });

    // Wait for either task to finish
    tokio::select! {
        _ = send_task => {},
        _ = recv_task => {},
    }

    // Cleanup
    {
        let mut clients = state.clients.write().await;
        clients.remove(&client_id);
    }

    let _ = state.event_tx.send(ServerEvent::ClientDisconnected {
        client_id: client_id.clone(),
    });

    log::info!("[sync_server] WebSocket client disconnected: {}", client_id);
}

// --- Helpers ---

fn decode_repo_id(repo_id: &str) -> Result<String, Response> {
    base64::Engine::decode(&base64::engine::general_purpose::URL_SAFE_NO_PAD, repo_id)
        .map_err(|_| {
            (
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse::new("Invalid repo ID")),
            )
                .into_response()
        })
        .and_then(|bytes| {
            String::from_utf8(bytes).map_err(|_| {
                (
                    StatusCode::BAD_REQUEST,
                    Json(ErrorResponse::new("Invalid repo ID")),
                )
                    .into_response()
            })
        })
}

fn decode_comparison_key(key: &str) -> Result<Comparison, Response> {
    let decoded = urlencoding::decode(key)
        .map_err(|_| {
            (
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse::new("Invalid comparison key")),
            )
                .into_response()
        })?
        .into_owned();

    // Parse comparison key format: "old..new" or "old..new+working-tree" or "old..new+staged"
    let (base_key, modifiers) = if let Some(idx) = decoded.find('+') {
        (&decoded[..idx], Some(&decoded[idx + 1..]))
    } else {
        (decoded.as_str(), None)
    };

    let parts: Vec<&str> = base_key.split("..").collect();
    if parts.len() != 2 {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse::new("Invalid comparison key format")),
        )
            .into_response());
    }

    let working_tree = modifiers == Some("working-tree");
    let staged_only = modifiers == Some("staged");

    Ok(Comparison {
        old: parts[0].to_string(),
        new: parts[1].to_string(),
        working_tree,
        staged_only,
        key: decoded,
    })
}

/// Register a repository as known (call when opening a repo)
pub async fn register_repo(state: &ServerState, repo_path: String) {
    let mut repos = state.known_repos.write().await;
    if !repos.contains(&repo_path) {
        repos.push(repo_path);
    }
}

/// Register a repository using the global server state
/// Returns true if registered, false if server not running
pub fn register_repo_global(repo_path: String) -> bool {
    if let Some(state) = SERVER_STATE.get() {
        // Use try_write to avoid requiring a tokio runtime context
        // (this function may be called from the main thread)
        if let Ok(mut repos) = state.known_repos.try_write() {
            if !repos.contains(&repo_path) {
                log::info!("[sync_server] Registering repo: {}", repo_path);
                repos.push(repo_path);
            }
        }
        true
    } else {
        false
    }
}

/// Broadcast a state change event
pub fn broadcast_state_change(
    state: &ServerState,
    repo_id: String,
    comparison_key: String,
    version: u64,
) {
    let _ = state.event_tx.send(ServerEvent::StateChanged {
        repo: repo_id,
        comparison_key,
        version,
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::HeaderValue;

    // --- Comparison key parsing tests ---

    #[test]
    fn test_decode_comparison_key() {
        let key = "main..feature-branch";
        let comparison = decode_comparison_key(key).unwrap();
        assert_eq!(comparison.old, "main");
        assert_eq!(comparison.new, "feature-branch");
        assert!(!comparison.working_tree);
        assert!(!comparison.staged_only);
    }

    #[test]
    fn test_decode_comparison_key_working_tree() {
        let key = "main..HEAD%2Bworking-tree";
        let comparison = decode_comparison_key(key).unwrap();
        assert_eq!(comparison.old, "main");
        assert_eq!(comparison.new, "HEAD");
        assert!(comparison.working_tree);
        assert!(!comparison.staged_only);
    }

    #[test]
    fn test_decode_comparison_key_staged_only() {
        let key = "HEAD..HEAD%2Bstaged";
        let comparison = decode_comparison_key(key).unwrap();
        assert_eq!(comparison.old, "HEAD");
        assert_eq!(comparison.new, "HEAD");
        assert!(!comparison.working_tree);
        assert!(comparison.staged_only);
    }

    #[test]
    fn test_decode_comparison_key_with_slashes() {
        let key = "origin%2Fmain..feature%2Ftest";
        let comparison = decode_comparison_key(key).unwrap();
        assert_eq!(comparison.old, "origin/main");
        assert_eq!(comparison.new, "feature/test");
    }

    #[test]
    fn test_decode_comparison_key_invalid() {
        // Missing ".." separator
        let result = decode_comparison_key("main-feature");
        assert!(result.is_err());
    }

    #[test]
    fn test_decode_comparison_key_empty_refs() {
        let key = "..feature";
        let comparison = decode_comparison_key(key).unwrap();
        assert_eq!(comparison.old, "");
        assert_eq!(comparison.new, "feature");
    }

    // --- Repo ID encoding/decoding tests ---

    #[test]
    fn test_decode_repo_id_valid() {
        // Encode "/Users/test/repo" -> base64 URL-safe
        let path = "/Users/test/repo";
        let encoded = base64::Engine::encode(
            &base64::engine::general_purpose::URL_SAFE_NO_PAD,
            path.as_bytes(),
        );

        let decoded = decode_repo_id(&encoded).unwrap();
        assert_eq!(decoded, path);
    }

    #[test]
    fn test_decode_repo_id_invalid_base64() {
        let result = decode_repo_id("not!valid@base64");
        assert!(result.is_err());
    }

    #[test]
    fn test_decode_repo_id_invalid_utf8() {
        // Create base64 of invalid UTF-8 bytes
        let invalid_bytes = vec![0xff, 0xfe, 0x00, 0x01];
        let encoded = base64::Engine::encode(
            &base64::engine::general_purpose::URL_SAFE_NO_PAD,
            &invalid_bytes,
        );
        let result = decode_repo_id(&encoded);
        assert!(result.is_err());
    }

    // --- Auth token tests ---

    #[test]
    fn test_generate_auth_token() {
        let token = generate_auth_token();
        assert!(!token.is_empty());
        assert!(token.len() >= 20);
    }

    #[test]
    fn test_generate_auth_token_uniqueness() {
        let token1 = generate_auth_token();
        let token2 = generate_auth_token();
        assert_ne!(token1, token2);
    }

    #[test]
    fn test_generate_auth_token_url_safe() {
        let token = generate_auth_token();
        // URL-safe base64 should only contain alphanumerics, dash, and underscore
        assert!(token
            .chars()
            .all(|c| c.is_alphanumeric() || c == '-' || c == '_'));
    }

    // --- Auth header validation tests ---

    #[test]
    fn test_check_auth_valid() {
        let mut headers = HeaderMap::new();
        headers.insert(
            header::AUTHORIZATION,
            HeaderValue::from_static("Bearer test-token-123"),
        );

        let result = check_auth(&headers, "test-token-123");
        assert!(result.is_ok());
    }

    #[test]
    fn test_check_auth_wrong_token() {
        let mut headers = HeaderMap::new();
        headers.insert(
            header::AUTHORIZATION,
            HeaderValue::from_static("Bearer wrong-token"),
        );

        let result = check_auth(&headers, "correct-token");
        assert!(result.is_err());
    }

    #[test]
    fn test_check_auth_missing_header() {
        let headers = HeaderMap::new();

        let result = check_auth(&headers, "any-token");
        assert!(result.is_err());
    }

    #[test]
    fn test_check_auth_malformed_bearer() {
        let mut headers = HeaderMap::new();
        headers.insert(
            header::AUTHORIZATION,
            HeaderValue::from_static("Basic not-bearer"),
        );

        let result = check_auth(&headers, "token");
        assert!(result.is_err());
    }

    #[test]
    fn test_check_auth_empty_bearer() {
        let mut headers = HeaderMap::new();
        headers.insert(header::AUTHORIZATION, HeaderValue::from_static("Bearer "));

        let result = check_auth(&headers, "token");
        assert!(result.is_err());
    }

    // --- Server config tests ---

    #[test]
    fn test_server_config_default() {
        let config = ServerConfig::default();
        assert!(!config.enabled);
        assert_eq!(config.port, DEFAULT_PORT);
        assert!(!config.auth_token.is_empty());
    }

    // --- Server event serialization tests ---

    #[test]
    fn test_server_event_state_changed_serialization() {
        let event = ServerEvent::StateChanged {
            repo: "repo-id".to_string(),
            comparison_key: "main..feature".to_string(),
            version: 5,
        };

        let json = serde_json::to_string(&event).unwrap();
        assert!(json.contains("\"type\":\"state_changed\""));
        assert!(json.contains("\"repo\":\"repo-id\""));
        assert!(json.contains("\"version\":5"));
    }

    #[test]
    fn test_server_event_client_connected_serialization() {
        let event = ServerEvent::ClientConnected {
            client_id: "client-123".to_string(),
        };

        let json = serde_json::to_string(&event).unwrap();
        assert!(json.contains("\"type\":\"client_connected\""));
        assert!(json.contains("\"client_id\":\"client-123\""));
    }

    #[test]
    fn test_server_event_deserialization() {
        let json = r#"{"type":"state_changed","repo":"test","comparison_key":"a..b","version":10}"#;
        let event: ServerEvent = serde_json::from_str(json).unwrap();

        match event {
            ServerEvent::StateChanged {
                repo,
                comparison_key,
                version,
            } => {
                assert_eq!(repo, "test");
                assert_eq!(comparison_key, "a..b");
                assert_eq!(version, 10);
            }
            _ => panic!("Wrong event type"),
        }
    }

    // --- Server running state tests ---

    #[test]
    fn test_server_running_initial_state() {
        // Reset state for test isolation (in real tests we'd want proper setup/teardown)
        SERVER_RUNNING.store(false, Ordering::SeqCst);
        assert!(!is_running());
    }

    // --- Client info tests ---

    #[test]
    fn test_client_info_serialization() {
        let info = ClientInfo {
            id: "client-1".to_string(),
            connected_at: "2024-01-15T10:00:00Z".to_string(),
            last_active: "2024-01-15T10:05:00Z".to_string(),
        };

        let json = serde_json::to_string(&info).unwrap();
        assert!(json.contains("\"id\":\"client-1\""));
        assert!(json.contains("\"connected_at\":\"2024-01-15T10:00:00Z\""));
        assert!(json.contains("\"last_active\":\"2024-01-15T10:05:00Z\""));
    }
}
