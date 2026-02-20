//! Custom axum extractors for common request parameters.

use super::error::ApiError;
use crate::desktop::commands;
use axum::extract::FromRequestParts;
use axum::http::request::Parts;
use review::sources::traits::Comparison;
use serde::Deserialize;

/// Extracts a repo path from the `?repo=` query parameter,
/// falling back to the current repo if not provided.
pub struct RepoPath(pub String);

#[derive(Deserialize)]
struct RepoQuery {
    repo: Option<String>,
}

impl<S: Send + Sync> FromRequestParts<S> for RepoPath {
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, _state: &S) -> Result<Self, Self::Rejection> {
        let query: axum::extract::Query<RepoQuery> = axum::extract::Query::try_from_uri(&parts.uri)
            .map_err(|e| ApiError::BadRequest(format!("Invalid query: {e}")))?;

        match query.0.repo {
            Some(repo) => Ok(RepoPath(repo)),
            None => commands::get_current_repo().map(RepoPath).map_err(|e| {
                ApiError::BadRequest(format!("No repo specified and none found: {e}"))
            }),
        }
    }
}

/// Parse a `base..head` string into a Comparison.
pub fn parse_comparison(s: &str) -> Result<Comparison, ApiError> {
    let decoded = urlencoding::decode(s)
        .map_err(|e| ApiError::BadRequest(format!("Invalid encoding: {e}")))?;
    let (base, head) = decoded.split_once("..").ok_or_else(|| {
        ApiError::BadRequest(format!(
            "Invalid comparison format '{decoded}': expected 'base..head'"
        ))
    })?;
    if base.is_empty() || head.is_empty() {
        return Err(ApiError::BadRequest(format!(
            "Invalid comparison format '{decoded}': expected 'base..head'"
        )));
    }
    Ok(Comparison::new(base.to_string(), head.to_string()))
}
