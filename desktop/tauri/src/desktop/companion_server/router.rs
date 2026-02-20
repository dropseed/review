//! Router construction with all route groups.

use axum::routing::{get, post};
use axum::Router;
use tower_http::cors::CorsLayer;

use super::handlers::{actions, comparisons, git, github, guide, health, reviews, taxonomy};
use super::middleware::{auth, log_request};
use super::state::SharedState;

/// Build the complete router with all REST routes.
pub fn build_router(state: SharedState) -> Router {
    Router::new()
        // --- System ---
        .route("/health", get(health::health))
        .route("/info", get(health::info))
        // --- Git ---
        .route("/git/repo", get(git::get_repo))
        .route("/git/branches", get(git::list_branches))
        .route("/git/branch/default", get(git::get_default_branch))
        .route("/git/branch/current", get(git::get_current_branch))
        .route("/git/status", get(git::get_status))
        .route("/git/status/raw", get(git::get_status_raw))
        .route("/git/remote", get(git::get_remote_info))
        .route("/git/commits", get(git::list_commits))
        .route("/git/commits/{hash}", get(git::get_commit_detail_path))
        // --- Comparisons ---
        .route("/comparisons/{comp}/files", get(comparisons::list_files))
        .route(
            "/comparisons/{comp}/files/{*path}",
            get(comparisons::get_file),
        )
        .route(
            "/comparisons/{comp}/diff/shortstat",
            get(comparisons::diff_shortstat),
        )
        .route(
            "/comparisons/{comp}/hunks",
            post(comparisons::get_all_hunks),
        )
        // --- Review state ---
        .route(
            "/comparisons/{comp}/review",
            get(comparisons::get_review)
                .put(comparisons::save_review)
                .delete(comparisons::delete_review),
        )
        // --- Reviews listing ---
        .route("/reviews", get(reviews::list_reviews))
        // --- Directories ---
        .route("/directories/{*path}", get(reviews::list_directory))
        // --- Taxonomy ---
        .route("/taxonomy", get(taxonomy::get_taxonomy))
        // --- GitHub ---
        .route("/github/available", get(github::check_available))
        .route("/github/prs", get(github::list_prs))
        // --- Actions ---
        .route("/actions/detect-moves", post(actions::detect_moves))
        // --- Guide generation ---
        .route(
            "/comparisons/{comp}/guide/groups",
            post(guide::generate_groups),
        )
        // --- Middleware ---
        .layer(axum::middleware::from_fn(log_request))
        .layer(axum::middleware::from_fn_with_state(state.clone(), auth))
        .layer(CorsLayer::permissive())
        .with_state(state)
}
