use axum::Json;
use review::diff::parser::DiffHunk;
use serde::Deserialize;

use crate::desktop::commands::{self, DetectMovePairsResponse};

#[derive(Deserialize)]
pub(in crate::desktop::companion_server) struct DetectMovesRequest {
    hunks: Vec<DiffHunk>,
}

pub async fn detect_moves(Json(body): Json<DetectMovesRequest>) -> Json<DetectMovePairsResponse> {
    let result = commands::detect_hunks_move_pairs(body.hunks);
    Json(result)
}
