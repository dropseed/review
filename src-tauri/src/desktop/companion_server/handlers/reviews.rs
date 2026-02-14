use axum::Json;
use review::review::state::ReviewSummary;
use review::review::storage::GlobalReviewSummary;
use review::sources::traits::FileEntry;
use serde::Deserialize;

use crate::desktop::commands;
use crate::desktop::companion_server::error::ApiError;
use crate::desktop::companion_server::extractors::RepoPath;

#[derive(Deserialize)]
pub(in crate::desktop::companion_server) struct ReviewsQuery {
    repo: Option<String>,
}

/// GET /reviews — lists reviews for a specific repo if ?repo= provided, otherwise global
pub async fn list_reviews(
    axum::extract::Query(q): axum::extract::Query<ReviewsQuery>,
) -> Result<Json<serde_json::Value>, ApiError> {
    // We return different types depending on whether ?repo= is provided,
    // so we use serde_json::Value here to unify the return type.
    match q.repo {
        Some(repo) => {
            let reviews: Vec<ReviewSummary> =
                commands::list_saved_reviews(repo).map_err(ApiError::Internal)?;
            Ok(Json(serde_json::to_value(reviews).unwrap()))
        }
        None => {
            let reviews: Vec<GlobalReviewSummary> =
                commands::list_all_reviews_global().map_err(ApiError::Internal)?;
            Ok(Json(serde_json::to_value(reviews).unwrap()))
        }
    }
}

/// GET /directories/*path?repo=
pub async fn list_directory(
    RepoPath(repo): RepoPath,
    axum::extract::Path(dir_path): axum::extract::Path<String>,
) -> Result<Json<Vec<FileEntry>>, ApiError> {
    let entries =
        commands::list_directory_contents_sync(repo, dir_path).map_err(ApiError::Internal)?;
    Ok(Json(entries))
}
