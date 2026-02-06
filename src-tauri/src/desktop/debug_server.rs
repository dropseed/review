//! Debug HTTP server for external automation/testing.
//! Only active in debug builds. Listens on localhost:3333.

use super::commands;
use review::diff::parser::DiffHunk;
use review::review::state::ReviewState;
use review::sources::traits::Comparison;
use serde::{Deserialize, Serialize};
use std::io::Cursor;
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use tiny_http::{Header, Request, Response, Server};

static SERVER_RUNNING: AtomicBool = AtomicBool::new(false);

const PORT: u16 = 3333;

/// Start the debug server in a background thread.
/// Only starts if not already running.
pub fn start() {
    if SERVER_RUNNING.swap(true, Ordering::SeqCst) {
        eprintln!("[debug_server] Already running");
        return;
    }

    thread::spawn(|| {
        if let Err(e) = run_server() {
            eprintln!("[debug_server] Server error: {e}");
        }
        SERVER_RUNNING.store(false, Ordering::SeqCst);
    });
}

fn run_server() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let addr = format!("127.0.0.1:{PORT}");
    let server = Server::http(&addr).map_err(|e| format!("Failed to bind: {e}"))?;

    eprintln!("[debug_server] Listening on http://{addr}");

    for request in server.incoming_requests() {
        if let Err(e) = handle_request(request) {
            eprintln!("[debug_server] Request error: {e}");
        }
    }

    Ok(())
}

fn handle_request(mut request: Request) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    // Extract URL parts into owned strings to avoid borrow issues
    let url = request.url().to_owned();
    let path = url.split('?').next().unwrap_or("/").to_owned();
    let query = url.split('?').nth(1).unwrap_or("").to_owned();
    let method = request.method().as_str().to_owned();

    eprintln!("[debug_server] {method} {path} (query: {query})");

    // Handle CORS preflight
    if method == "OPTIONS" {
        let response = Response::from_string("")
            .with_header(cors_header())
            .with_header(
                Header::from_bytes(
                    &b"Access-Control-Allow-Methods"[..],
                    &b"GET, POST, DELETE, OPTIONS"[..],
                )
                .unwrap(),
            )
            .with_header(
                Header::from_bytes(&b"Access-Control-Allow-Headers"[..], &b"Content-Type"[..])
                    .unwrap(),
            );
        request.respond(response)?;
        return Ok(());
    }

    // Read body for POST/DELETE requests
    let body = if method == "POST" || method == "DELETE" {
        let mut body = String::new();
        request.as_reader().read_to_string(&mut body).ok();
        Some(body)
    } else {
        None
    };

    let response = match (method.as_str(), path.as_str()) {
        // Health check
        ("GET", "/health") => json_response(&HealthResponse { ok: true }),

        // Repository info
        ("GET", "/repo") => handle_get_repo(),
        ("GET", "/branches") => handle_get_branches(&query),
        ("GET", "/default-branch") => handle_get_default_branch(&query),
        ("GET", "/current-branch") => handle_get_current_branch(&query),

        // Remote info
        ("GET", "/remote-info") => handle_get_remote_info(&query),

        // Git status
        ("GET", "/status") => handle_get_status(&query),
        ("GET", "/status/raw") => handle_get_status_raw(&query),

        // Commits
        ("GET", "/commits") => handle_list_commits(&query),
        ("GET", "/commit") => handle_get_commit_detail(&query),

        // Files and content
        ("GET", "/files") => handle_list_files(&query),
        ("GET", "/file") => handle_get_file(&query),
        ("GET", "/directory") => handle_list_directory(&query),

        // Review state
        ("GET", "/state") => handle_get_state(&query),
        ("POST", "/state") => handle_save_state(&query, body.as_deref()),
        ("DELETE", "/state") => handle_delete_state(&query),

        // Saved reviews list
        ("GET", "/reviews") => handle_list_reviews(&query),

        // Current comparison
        ("GET", "/comparison") => handle_get_comparison(&query),
        ("POST", "/comparison") => handle_set_comparison(&query, body.as_deref()),

        // Trust taxonomy
        ("GET", "/taxonomy") => handle_get_taxonomy(&query),

        // Move detection
        ("POST", "/detect-moves") => handle_detect_moves(body.as_deref()),

        // GitHub
        ("GET", "/github/available") => handle_github_available(&query),
        ("GET", "/github/prs") => handle_github_prs(&query),

        _ => {
            let body = r#"{"error": "Not found"}"#;
            Response::from_string(body)
                .with_status_code(404)
                .with_header(content_type_json())
                .with_header(cors_header())
        }
    };

    request.respond(response)?;
    Ok(())
}

// --- Response helpers ---

fn content_type_json() -> Header {
    Header::from_bytes(&b"Content-Type"[..], &b"application/json"[..]).unwrap()
}

fn cors_header() -> Header {
    Header::from_bytes(&b"Access-Control-Allow-Origin"[..], &b"*"[..]).unwrap()
}

fn json_response<T: Serialize>(data: &T) -> Response<Cursor<Vec<u8>>> {
    match serde_json::to_string_pretty(data) {
        Ok(json) => Response::from_string(json)
            .with_header(content_type_json())
            .with_header(cors_header()),
        Err(e) => error_response(500, &format!("Serialization error: {e}")),
    }
}

fn error_response(status: u16, message: &str) -> Response<Cursor<Vec<u8>>> {
    let body = serde_json::json!({ "error": message }).to_string();
    Response::from_string(body)
        .with_status_code(status)
        .with_header(content_type_json())
        .with_header(cors_header())
}

// --- Query parsing ---

fn parse_query(query: &str) -> std::collections::HashMap<String, String> {
    query
        .split('&')
        .filter(|s| !s.is_empty())
        .filter_map(|pair| {
            let mut parts = pair.splitn(2, '=');
            let key = parts.next()?;
            let value = parts.next().unwrap_or("");
            Some((
                urlencoding::decode(key).ok()?.into_owned(),
                urlencoding::decode(value).ok()?.into_owned(),
            ))
        })
        .collect()
}

fn get_comparison_from_query(
    params: &std::collections::HashMap<String, String>,
) -> Option<Comparison> {
    let old = params.get("old")?.clone();
    let new = params.get("new")?.clone();
    let working_tree = params.get("workingTree").is_some_and(|v| v == "true");

    // Check for optional PR params
    let github_pr = params
        .get("prNumber")
        .and_then(|n| n.parse::<u32>().ok())
        .map(|number| {
            let title = params.get("prTitle").cloned().unwrap_or_default();
            review::sources::github::GitHubPrRef {
                number,
                title,
                head_ref_name: new.clone(),
                base_ref_name: old.clone(),
                body: None,
            }
        });

    // Build the key the same way the frontend does
    let key = if github_pr.is_some() {
        format!("pr-{}", github_pr.as_ref().unwrap().number)
    } else {
        format!("{old}..{new}")
    };

    Some(Comparison {
        old,
        new,
        working_tree,
        key,
        github_pr,
    })
}

// --- Response types ---

#[derive(Serialize)]
struct HealthResponse {
    ok: bool,
}

#[derive(Serialize)]
struct RepoResponse {
    path: String,
}

// --- Handlers ---

fn handle_get_repo() -> Response<Cursor<Vec<u8>>> {
    match commands::get_current_repo() {
        Ok(path) => json_response(&RepoResponse { path }),
        Err(e) => error_response(500, &e),
    }
}

fn handle_get_branches(query: &str) -> Response<Cursor<Vec<u8>>> {
    let params = parse_query(query);
    let repo_path = match params.get("repo") {
        Some(p) => p.clone(),
        None => match commands::get_current_repo() {
            Ok(p) => p,
            Err(e) => {
                return error_response(400, &format!("No repo specified and none found: {e}"))
            }
        },
    };

    match commands::list_branches(repo_path) {
        Ok(branches) => json_response(&branches),
        Err(e) => error_response(500, &e),
    }
}

fn handle_list_files(query: &str) -> Response<Cursor<Vec<u8>>> {
    let params = parse_query(query);

    let repo_path = match params.get("repo") {
        Some(p) => p.clone(),
        None => match commands::get_current_repo() {
            Ok(p) => p,
            Err(e) => {
                return error_response(400, &format!("No repo specified and none found: {e}"))
            }
        },
    };

    let Some(comparison) = get_comparison_from_query(&params) else {
        return error_response(400, "Missing comparison params (old, new)");
    };

    match commands::list_files_sync(repo_path, comparison) {
        Ok(files) => json_response(&files),
        Err(e) => error_response(500, &e),
    }
}

fn handle_get_state(query: &str) -> Response<Cursor<Vec<u8>>> {
    let params = parse_query(query);

    let repo_path = match params.get("repo") {
        Some(p) => p.clone(),
        None => match commands::get_current_repo() {
            Ok(p) => p,
            Err(e) => {
                return error_response(400, &format!("No repo specified and none found: {e}"))
            }
        },
    };

    let Some(comparison) = get_comparison_from_query(&params) else {
        return error_response(400, "Missing comparison params (old, new)");
    };

    match commands::load_review_state(repo_path, comparison) {
        Ok(state) => json_response(&state),
        Err(e) => error_response(500, &e),
    }
}

fn handle_get_status(query: &str) -> Response<Cursor<Vec<u8>>> {
    let params = parse_query(query);

    let repo_path = match params.get("repo") {
        Some(p) => p.clone(),
        None => match commands::get_current_repo() {
            Ok(p) => p,
            Err(e) => {
                return error_response(400, &format!("No repo specified and none found: {e}"))
            }
        },
    };

    match commands::get_git_status(repo_path) {
        Ok(status) => json_response(&status),
        Err(e) => error_response(500, &e),
    }
}

fn handle_get_file(query: &str) -> Response<Cursor<Vec<u8>>> {
    let params = parse_query(query);

    let repo_path = match params.get("repo") {
        Some(p) => p.clone(),
        None => match commands::get_current_repo() {
            Ok(p) => p,
            Err(e) => {
                return error_response(400, &format!("No repo specified and none found: {e}"))
            }
        },
    };

    let file_path = match params.get("path") {
        Some(p) => p.clone(),
        None => return error_response(400, "Missing 'path' parameter"),
    };

    let Some(comparison) = get_comparison_from_query(&params) else {
        return error_response(400, "Missing comparison params (old, new)");
    };

    match commands::get_file_content_sync(repo_path, file_path, comparison) {
        Ok(content) => json_response(&content),
        Err(e) => error_response(500, &e),
    }
}

fn handle_list_directory(query: &str) -> Response<Cursor<Vec<u8>>> {
    let params = parse_query(query);
    let repo_path = match get_repo_path(&params) {
        Ok(p) => p,
        Err(e) => return e,
    };

    let dir_path = match params.get("path") {
        Some(p) => p.clone(),
        None => return error_response(400, "Missing 'path' parameter"),
    };

    match commands::list_directory_contents_sync(repo_path, dir_path) {
        Ok(entries) => json_response(&entries),
        Err(e) => error_response(500, &e),
    }
}

fn handle_get_taxonomy(query: &str) -> Response<Cursor<Vec<u8>>> {
    let params = parse_query(query);

    let repo_path = params.get("repo").cloned();

    let taxonomy = if let Some(repo) = repo_path {
        commands::get_trust_taxonomy_with_custom(repo)
    } else {
        commands::get_trust_taxonomy()
    };

    json_response(&taxonomy)
}

fn handle_get_default_branch(query: &str) -> Response<Cursor<Vec<u8>>> {
    let params = parse_query(query);
    let repo_path = match get_repo_path(&params) {
        Ok(p) => p,
        Err(e) => return e,
    };

    match commands::get_default_branch(repo_path) {
        Ok(branch) => json_response(&BranchResponse { branch }),
        Err(e) => error_response(500, &e),
    }
}

fn handle_get_current_branch(query: &str) -> Response<Cursor<Vec<u8>>> {
    let params = parse_query(query);
    let repo_path = match get_repo_path(&params) {
        Ok(p) => p,
        Err(e) => return e,
    };

    match commands::get_current_branch(repo_path) {
        Ok(branch) => json_response(&BranchResponse { branch }),
        Err(e) => error_response(500, &e),
    }
}

fn handle_get_remote_info(query: &str) -> Response<Cursor<Vec<u8>>> {
    let params = parse_query(query);
    let repo_path = match get_repo_path(&params) {
        Ok(p) => p,
        Err(e) => return e,
    };

    match commands::get_remote_info(repo_path) {
        Ok(info) => json_response(&info),
        Err(e) => error_response(500, &e),
    }
}

fn handle_get_status_raw(query: &str) -> Response<Cursor<Vec<u8>>> {
    let params = parse_query(query);
    let repo_path = match get_repo_path(&params) {
        Ok(p) => p,
        Err(e) => return e,
    };

    match commands::get_git_status_raw(repo_path) {
        Ok(raw) => json_response(&RawStatusResponse { raw }),
        Err(e) => error_response(500, &e),
    }
}

fn handle_list_commits(query: &str) -> Response<Cursor<Vec<u8>>> {
    let params = parse_query(query);
    let repo_path = match get_repo_path(&params) {
        Ok(p) => p,
        Err(e) => return e,
    };

    let limit = params.get("limit").and_then(|v| v.parse::<usize>().ok());
    let branch = params.get("branch").cloned();

    match commands::list_commits(repo_path, limit, branch) {
        Ok(commits) => json_response(&commits),
        Err(e) => error_response(500, &e),
    }
}

fn handle_get_commit_detail(query: &str) -> Response<Cursor<Vec<u8>>> {
    let params = parse_query(query);
    let repo_path = match get_repo_path(&params) {
        Ok(p) => p,
        Err(e) => return e,
    };

    let Some(hash) = params.get("hash") else {
        return error_response(400, "Missing 'hash' parameter");
    };

    match commands::get_commit_detail(repo_path, hash.clone()) {
        Ok(detail) => json_response(&detail),
        Err(e) => error_response(500, &e),
    }
}

fn handle_save_state(query: &str, body: Option<&str>) -> Response<Cursor<Vec<u8>>> {
    let params = parse_query(query);
    let repo_path = match get_repo_path(&params) {
        Ok(p) => p,
        Err(e) => return e,
    };

    let Some(body) = body else {
        return error_response(400, "Missing request body");
    };

    let state: ReviewState = match serde_json::from_str(body) {
        Ok(s) => s,
        Err(e) => return error_response(400, &format!("Invalid JSON: {e}")),
    };

    match commands::save_review_state(repo_path, state) {
        Ok(()) => json_response(&SuccessResponse { success: true }),
        Err(e) => error_response(500, &e),
    }
}

fn handle_delete_state(query: &str) -> Response<Cursor<Vec<u8>>> {
    let params = parse_query(query);
    let repo_path = match get_repo_path(&params) {
        Ok(p) => p,
        Err(e) => return e,
    };

    let Some(comparison) = get_comparison_from_query(&params) else {
        return error_response(400, "Missing comparison params (old, new)");
    };

    match commands::delete_review(repo_path, comparison) {
        Ok(()) => json_response(&SuccessResponse { success: true }),
        Err(e) => error_response(500, &e),
    }
}

fn handle_list_reviews(query: &str) -> Response<Cursor<Vec<u8>>> {
    let params = parse_query(query);
    let repo_path = match get_repo_path(&params) {
        Ok(p) => p,
        Err(e) => return e,
    };

    match commands::list_saved_reviews(repo_path) {
        Ok(reviews) => json_response(&reviews),
        Err(e) => error_response(500, &e),
    }
}

fn handle_get_comparison(query: &str) -> Response<Cursor<Vec<u8>>> {
    let params = parse_query(query);
    let repo_path = match get_repo_path(&params) {
        Ok(p) => p,
        Err(e) => return e,
    };

    match commands::get_current_comparison(repo_path) {
        Ok(comparison) => json_response(&ComparisonResponse { comparison }),
        Err(e) => error_response(500, &e),
    }
}

fn handle_set_comparison(query: &str, body: Option<&str>) -> Response<Cursor<Vec<u8>>> {
    let params = parse_query(query);
    let repo_path = match get_repo_path(&params) {
        Ok(p) => p,
        Err(e) => return e,
    };

    let Some(body) = body else {
        return error_response(400, "Missing request body");
    };

    let request: SetComparisonRequest = match serde_json::from_str(body) {
        Ok(r) => r,
        Err(e) => return error_response(400, &format!("Invalid JSON: {e}")),
    };

    match commands::set_current_comparison(repo_path, request.comparison) {
        Ok(()) => json_response(&SuccessResponse { success: true }),
        Err(e) => error_response(500, &e),
    }
}

#[derive(Deserialize)]
struct DetectMovesRequest {
    hunks: Vec<DiffHunk>,
}

#[derive(Deserialize)]
struct SetComparisonRequest {
    comparison: Comparison,
}

fn handle_detect_moves(body: Option<&str>) -> Response<Cursor<Vec<u8>>> {
    let Some(body) = body else {
        return error_response(400, "Missing request body");
    };

    let request: DetectMovesRequest = match serde_json::from_str(body) {
        Ok(r) => r,
        Err(e) => return error_response(400, &format!("Invalid JSON: {e}")),
    };

    let result = commands::detect_hunks_move_pairs(request.hunks);
    json_response(&result)
}

fn handle_github_available(query: &str) -> Response<Cursor<Vec<u8>>> {
    let params = parse_query(query);
    let repo_path = match get_repo_path(&params) {
        Ok(p) => p,
        Err(e) => return e,
    };

    let available = commands::check_github_available(repo_path);
    json_response(&AvailableResponse { available })
}

fn handle_github_prs(query: &str) -> Response<Cursor<Vec<u8>>> {
    let params = parse_query(query);
    let repo_path = match get_repo_path(&params) {
        Ok(p) => p,
        Err(e) => return e,
    };

    match commands::list_pull_requests(repo_path) {
        Ok(prs) => json_response(&prs),
        Err(e) => error_response(500, &e),
    }
}

// Helper to get repo path from params or default
fn get_repo_path(
    params: &std::collections::HashMap<String, String>,
) -> Result<String, Response<Cursor<Vec<u8>>>> {
    match params.get("repo") {
        Some(p) => Ok(p.clone()),
        None => match commands::get_current_repo() {
            Ok(p) => Ok(p),
            Err(e) => Err(error_response(
                400,
                &format!("No repo specified and none found: {e}"),
            )),
        },
    }
}

// Additional response types
#[derive(Serialize)]
struct AvailableResponse {
    available: bool,
}

#[derive(Serialize)]
struct BranchResponse {
    branch: String,
}

#[derive(Serialize)]
struct RawStatusResponse {
    raw: String,
}

#[derive(Serialize)]
struct SuccessResponse {
    success: bool,
}

#[derive(Serialize)]
struct ComparisonResponse {
    comparison: Option<Comparison>,
}
