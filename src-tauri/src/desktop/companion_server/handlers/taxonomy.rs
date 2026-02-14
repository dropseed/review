use axum::Json;
use review::trust::patterns::TrustCategory;
use serde::Deserialize;

use crate::desktop::commands;

#[derive(Deserialize)]
pub(in crate::desktop::companion_server) struct TaxonomyQuery {
    repo: Option<String>,
}

pub async fn get_taxonomy(
    axum::extract::Query(q): axum::extract::Query<TaxonomyQuery>,
) -> Json<Vec<TrustCategory>> {
    let taxonomy = match q.repo {
        Some(repo) => commands::get_trust_taxonomy_with_custom(repo),
        None => commands::get_trust_taxonomy(),
    };
    Json(taxonomy)
}
