use axum::Json;
use review::trust::patterns::TrustCategory;

use crate::desktop::commands;

pub async fn get_taxonomy() -> Json<Vec<TrustCategory>> {
    Json(commands::get_trust_taxonomy())
}
